-- =====================================================================
-- GetApkFree — baseline of the EXISTING production `public` schema
-- Captured 2026-09-03 from project ref haaydcfabzroclgpjdsq
-- =====================================================================
--
-- WHAT THIS IS
--   A point-in-time description of the schema that is ALREADY LIVE in
--   production. It exists so the database structure is recoverable from
--   git, which it previously was not: production carried 23 applied
--   migrations, none of which were ever committed to this repository.
--
-- DO NOT APPLY THIS TO PRODUCTION.
--   Every object below already exists there. This file is a record, not
--   a change. Running `supabase db push` against production with this
--   file present is the one action that could damage the live database.
--   If the Supabase CLI is ever wired up to this project, register the
--   baseline as already-applied first:
--
--       supabase migration repair --status applied 20260903000000
--
-- WHAT IT IS FOR
--   Rebuilding an empty database — a local dev instance, a staging
--   branch, or a recovery — to match production's structure. It is
--   written to be safely re-runnable against such a database: tables use
--   IF NOT EXISTS and policies are dropped before being recreated.
--
-- WHAT IT DELIBERATELY OMITS
--   * All row data. No apps, versions, posts, downloads or users.
--   * The `auth`, `storage` and `realtime` schemas, which Supabase owns
--     and manages. Only the two places where `public` genuinely depends
--     on them are included: the users.id -> auth.users(id) foreign key,
--     and the trigger on auth.users. Storage buckets and their policies
--     are recorded at the end, guarded, because the application cannot
--     function without them.
--   * Secrets of every kind. No keys, tokens, passwords or connection
--     strings appear in this file.
--
-- PROVENANCE
--   Read out of the live catalog (pg_class, pg_constraint, pg_indexes,
--   pg_policies, pg_proc, pg_trigger) via read-only SELECTs. It reflects
--   what production actually contains, not what any migration intended.
-- =====================================================================


-- ---------------------------------------------------------------- extensions
-- Provisioned by Supabase in the `extensions` schema on a new project;
-- listed here so a non-Supabase Postgres can be brought up to parity.
--   pg_stat_statements 1.11, pgcrypto 1.3, uuid-ossp 1.1,
--   supabase_vault 0.3.1, plpgsql 1.0
-- gen_random_uuid() comes from pgcrypto and is used as a column default
-- throughout, so it must exist before the tables below.
create extension if not exists pgcrypto with schema extensions;


-- ================================================================== tables

-- Admin allow-list, consulted by handle_new_user() when an account is
-- created. RLS is enabled with NO policies, so anon and authenticated
-- can never read or write it; only the service role reaches it.
create table if not exists public.admin_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- Mirror of auth.users carrying profile and role. Rows are inserted by
-- the on_auth_user_created trigger, never by the client directly.
create table if not exists public.users (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text unique,
  username               text unique,
  created_at             timestamptz not null default now(),
  avatar_url             text,
  theme                  text not null default 'dark',
  notify_app_updates     boolean not null default true,
  notify_security_alerts boolean not null default true,
  is_admin               boolean not null default false,
  constraint users_theme_check check (theme = any (array['dark','light','system']))
);

-- The catalogue. `source_type` splits builds we link from F-Droid from
-- external listings that live on the publisher's own store page; the
-- check constraint keeps the two shapes from being mixed.
create table if not exists public.apps (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  package_name   text not null unique,
  category       text,
  description    text,
  icon_url       text,
  developer_name text,
  created_at     timestamptz not null default now(),
  download_count integer not null default 0,
  screenshots    text[] not null default '{}'::text[],
  rating         numeric(2,1),
  rating_count   integer not null default 0,
  source_type    text not null default 'fdroid',
  external_url   text,
  hosted_locally boolean not null default true,
  manual_fields  text[] not null default '{}'::text[],
  constraint apps_source_type_check check (source_type = any (array['fdroid','external'])),
  constraint apps_source_shape_check check (
    ((source_type = 'external') and (external_url is not null) and (hosted_locally = false))
    or
    ((source_type = 'fdroid') and (external_url is null) and (hosted_locally = true))
  )
);

-- One row per build. `published` is what makes a build publicly visible;
-- RLS below hides everything else from anonymous readers.
create table if not exists public.versions (
  id                  uuid primary key default gen_random_uuid(),
  app_id              uuid not null references public.apps(id) on delete cascade,
  version_name        text not null,
  version_code        integer not null,
  file_url            text,
  file_size           bigint,
  min_android_version text,
  changelog           text,
  scan_status         text not null default 'pending',
  published           boolean not null default false,
  uploaded_at         timestamptz not null default now(),
  scanned_at          timestamptz,
  permissions         text[] not null default '{}'::text[],
  download_count      integer not null default 0,
  constraint versions_scan_status_check
    check (scan_status = any (array['pending','clean','flagged','failed','external'])),
  constraint versions_app_id_version_code_key unique (app_id, version_code)
);

-- Download log. user_id is nullable so anonymous downloads are recorded
-- too, and is SET NULL on account deletion so the aggregate survives
-- while the personal link does not.
create table if not exists public.downloads (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete set null,
  version_id    uuid not null references public.versions(id) on delete cascade,
  downloaded_at timestamptz not null default now()
);

create table if not exists public.favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  app_id     uuid not null references public.apps(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_user_id_app_id_key unique (user_id, app_id)
);

-- Blog. `description` is the search snippet, capped so it cannot overrun
-- a meta description. related_app_ids is a text[] of app uuids and is
-- deliberately not a foreign key: a deleted app should drop out of a
-- post's sidebar rather than block the delete.
create table if not exists public.blog_posts (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  title              text not null,
  description        text not null,
  content            text not null default ''::text,
  featured_image_url text,
  author             text not null default 'GetApkFree Team'::text,
  category           text not null,
  related_app_ids    text[] not null default '{}'::text[],
  published          boolean not null default false,
  view_count         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint blog_posts_category_check
    check (category = any (array['privacy','productivity','gaming','tools','guides','news'])),
  constraint blog_posts_description_length check (char_length(description) <= 200)
);


-- ================================================================= indexes
-- Primary key and unique indexes are created implicitly by the
-- constraints above; only the supporting indexes are listed here.

create index if not exists idx_apps_category       on public.apps using btree (category);
create index if not exists idx_apps_created_at     on public.apps using btree (created_at desc);
create index if not exists idx_apps_download_count on public.apps using btree (download_count desc);
create index if not exists apps_source_type_idx    on public.apps using btree (source_type);

create index if not exists idx_versions_app_id         on public.versions using btree (app_id);
create index if not exists idx_versions_download_count on public.versions using btree (download_count desc);
-- Serves "newest published build for this app", the catalogue's hot path.
create index if not exists idx_versions_published      on public.versions using btree (app_id, published, version_code desc);

create index if not exists idx_downloads_user_id     on public.downloads using btree (user_id);
create index if not exists idx_downloads_version_id  on public.downloads using btree (version_id);
create index if not exists idx_downloads_user_recent on public.downloads using btree (user_id, downloaded_at desc);

create index if not exists idx_favorites_app_id      on public.favorites using btree (app_id);
create index if not exists idx_favorites_user_id     on public.favorites using btree (user_id);
create index if not exists idx_favorites_user_recent on public.favorites using btree (user_id, created_at desc);

create index if not exists blog_posts_category_idx         on public.blog_posts using btree (category);
create index if not exists blog_posts_published_created_idx on public.blog_posts using btree (published, created_at desc);


-- =============================================================== functions
-- Defined after the tables because the SQL-language functions below are
-- parsed at creation time and reference them.

-- The single source of truth for admin status. SECURITY DEFINER so it
-- can read public.users regardless of the caller's own row policies,
-- with search_path pinned so it cannot be redirected by a caller.
-- EXECUTE is deliberately NOT granted to anon (see grants below): an
-- RLS policy that ORs this against a public predicate would otherwise
-- fail outright for anonymous readers.
create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select u.is_admin from public.users u where u.id = (select auth.uid())),
    false
  );
$function$;

create or replace function public.is_username_available(candidate text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select not exists (
    select 1 from public.users
     where username = lower(regexp_replace(trim(candidate), '[^a-zA-Z0-9_]', '', 'g'))
  );
$function$;

create or replace function public.increment_blog_view(post_slug text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  update blog_posts
     set view_count = view_count + 1
   where slug = post_slug and published = true;
$function$;

create or replace function public.set_updated_at()
 returns trigger
 language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- Keeps versions.download_count and apps.download_count in step with the
-- downloads log, so the counter and the event log cannot drift apart.
create or replace function public.bump_download_count()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.versions
     set download_count = download_count + 1
   where id = new.version_id;

  update public.apps a
     set download_count = a.download_count + 1
    from public.versions v
   where v.id = new.version_id
     and a.id = v.app_id;

  return new;
end;
$function$;

-- Creates the public.users row for a new auth account, deriving a unique
-- username and granting admin if the address is on the allow-list.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  desired    text;
  final_name text;
  suffix     int := 0;
begin
  desired := coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''),
                      split_part(new.email, '@', 1));
  desired := lower(regexp_replace(desired, '[^a-zA-Z0-9_]', '', 'g'));
  if desired = '' then
    desired := 'user';
  end if;

  final_name := desired;
  while exists (select 1 from public.users where username = final_name) loop
    suffix := suffix + 1;
    final_name := desired || suffix::text;
  end loop;

  insert into public.users (id, email, username, is_admin)
  values (
    new.id,
    new.email,
    final_name,
    exists (select 1 from public.admin_emails a where lower(a.email) = lower(new.email))
  )
  on conflict (id) do nothing;

  return new;
end;
$function$;


-- ------------------------------------------------------- function grants
-- Mirrors production exactly. The revocations matter: bump_download_count
-- and handle_new_user are trigger bodies and must not be callable
-- directly, and is_admin is withheld from anon.
revoke all on function public.bump_download_count() from public, anon, authenticated;
revoke all on function public.handle_new_user()     from public, anon, authenticated;
revoke all on function public.is_admin()            from public, anon;

grant execute on function public.is_admin()                        to authenticated, service_role;
grant execute on function public.is_username_available(text)       to anon, authenticated, service_role;
grant execute on function public.increment_blog_view(text)         to anon, authenticated, service_role;
grant execute on function public.bump_download_count()             to service_role;
grant execute on function public.handle_new_user()                 to service_role;


-- ================================================================ triggers

drop trigger if exists blog_posts_set_updated_at on public.blog_posts;
create trigger blog_posts_set_updated_at
  before update on public.blog_posts
  for each row execute function public.set_updated_at();

drop trigger if exists downloads_bump_count on public.downloads;
create trigger downloads_bump_count
  after insert on public.downloads
  for each row execute function public.bump_download_count();

-- Lives on auth.users, which Supabase owns. Included because public.users
-- is never populated without it.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ==================================================================== RLS
-- Enabled on all seven tables. RLS is the real authorization boundary in
-- this project: the anon key is public by design, so anything not
-- protected by a policy below is protected by nothing.

alter table public.admin_emails enable row level security;
alter table public.users        enable row level security;
alter table public.apps         enable row level security;
alter table public.versions     enable row level security;
alter table public.downloads    enable row level security;
alter table public.favorites    enable row level security;
alter table public.blog_posts   enable row level security;

-- admin_emails intentionally has NO policies. RLS with no policy denies
-- every role that is subject to it, leaving the table reachable only by
-- the service role. Do not add a policy here without meaning to.

-- ---- users -------------------------------------------------------------
drop policy if exists "users can read own profile" on public.users;
create policy "users can read own profile" on public.users
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "users can insert own profile" on public.users;
create policy "users can insert own profile" on public.users
  for insert to authenticated
  with check ((select auth.uid()) = id);

-- The is_admin comparison is what stops a user promoting themselves by
-- PATCHing their own profile row.
drop policy if exists "users can update own profile" on public.users;
create policy "users can update own profile" on public.users
  for update to authenticated
  using ((select auth.uid()) = id)
  with check (
    ((select auth.uid()) = id)
    and (is_admin = (select u.is_admin from public.users u where u.id = (select auth.uid())))
  );

-- ---- apps --------------------------------------------------------------
drop policy if exists "apps are publicly readable" on public.apps;
create policy "apps are publicly readable" on public.apps
  for select to anon, authenticated
  using (true);

drop policy if exists "admins manage apps" on public.apps;
create policy "admins manage apps" on public.apps
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---- versions ----------------------------------------------------------
-- Split by role rather than expressed as one OR: Postgres does not
-- guarantee short-circuit evaluation, and anon has no EXECUTE on
-- is_admin(), so a combined predicate fails for anonymous readers.
drop policy if exists "published versions are publicly readable" on public.versions;
create policy "published versions are publicly readable" on public.versions
  for select to anon, authenticated
  using (published = true);

drop policy if exists "admins read every version" on public.versions;
create policy "admins read every version" on public.versions
  for select to authenticated
  using (is_admin());

drop policy if exists "admins manage versions" on public.versions;
create policy "admins manage versions" on public.versions
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---- downloads ---------------------------------------------------------
drop policy if exists "anyone can log a download" on public.downloads;
create policy "anyone can log a download" on public.downloads
  for insert to anon, authenticated
  with check ((user_id is null) or (user_id = (select auth.uid())));

drop policy if exists "users can read own downloads" on public.downloads;
create policy "users can read own downloads" on public.downloads
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---- favorites ---------------------------------------------------------
drop policy if exists "users can read own favorites" on public.favorites;
create policy "users can read own favorites" on public.favorites
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "users can add own favorites" on public.favorites;
create policy "users can add own favorites" on public.favorites
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "users can remove own favorites" on public.favorites;
create policy "users can remove own favorites" on public.favorites
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---- blog_posts --------------------------------------------------------
-- Same role split as versions, and for the same reason.
drop policy if exists "published posts are publicly readable" on public.blog_posts;
create policy "published posts are publicly readable" on public.blog_posts
  for select to anon, authenticated
  using (published = true);

drop policy if exists "admins read every post" on public.blog_posts;
create policy "admins read every post" on public.blog_posts
  for select to authenticated
  using (is_admin());

drop policy if exists "admins write posts" on public.blog_posts;
create policy "admins write posts" on public.blog_posts
  for all to authenticated
  using (is_admin())
  with check (is_admin());


-- ================================================================ storage
-- Buckets and their object policies. Recorded because the application
-- cannot function without them and nothing else in the repo describes
-- them. Guarded so this section is inert on a plain Postgres that has no
-- storage schema.
--
-- Production also contains a bucket literally named `.env.local`. It is
-- empty, unreferenced by any code, and was almost certainly created by
-- accident. It is deliberately NOT recreated here.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent; skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('apks', 'apks', true, 104857600,
     array['application/vnd.android.package-archive','application/octet-stream']),
    ('app-images', 'app-images', true, 5242880,
     array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml']),
    ('blog-images', 'blog-images', true, 5242880,
     array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])
  on conflict (id) do nothing;
end
$$;

-- Public read, admin-only write, per bucket. Uploads are additionally
-- funnelled through server routes in the application so the service-role
-- key never reaches the browser.
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;

  drop policy if exists "apks are publicly readable" on storage.objects;
  create policy "apks are publicly readable" on storage.objects
    for select to anon, authenticated using (bucket_id = 'apks');

  drop policy if exists "admins upload apks" on storage.objects;
  create policy "admins upload apks" on storage.objects
    for insert to authenticated with check ((bucket_id = 'apks') and is_admin());

  drop policy if exists "admins update apks" on storage.objects;
  create policy "admins update apks" on storage.objects
    for update to authenticated
    using ((bucket_id = 'apks') and is_admin())
    with check ((bucket_id = 'apks') and is_admin());

  drop policy if exists "admins delete apks" on storage.objects;
  create policy "admins delete apks" on storage.objects
    for delete to authenticated using ((bucket_id = 'apks') and is_admin());

  drop policy if exists "app images are publicly readable" on storage.objects;
  create policy "app images are publicly readable" on storage.objects
    for select using (bucket_id = 'app-images');

  drop policy if exists "admins upload app images" on storage.objects;
  create policy "admins upload app images" on storage.objects
    for insert with check ((bucket_id = 'app-images') and is_admin());

  drop policy if exists "admins update app images" on storage.objects;
  create policy "admins update app images" on storage.objects
    for update
    using ((bucket_id = 'app-images') and is_admin())
    with check ((bucket_id = 'app-images') and is_admin());

  drop policy if exists "admins delete app images" on storage.objects;
  create policy "admins delete app images" on storage.objects
    for delete using ((bucket_id = 'app-images') and is_admin());

  drop policy if exists "blog images are publicly readable" on storage.objects;
  create policy "blog images are publicly readable" on storage.objects
    for select using (bucket_id = 'blog-images');

  drop policy if exists "admins upload blog images" on storage.objects;
  create policy "admins upload blog images" on storage.objects
    for insert with check ((bucket_id = 'blog-images') and is_admin());

  drop policy if exists "admins update blog images" on storage.objects;
  create policy "admins update blog images" on storage.objects
    for update
    using ((bucket_id = 'blog-images') and is_admin())
    with check ((bucket_id = 'blog-images') and is_admin());

  drop policy if exists "admins delete blog images" on storage.objects;
  create policy "admins delete blog images" on storage.objects
    for delete using ((bucket_id = 'blog-images') and is_admin());
end
$$;

-- =============================================== end of baseline schema ===
