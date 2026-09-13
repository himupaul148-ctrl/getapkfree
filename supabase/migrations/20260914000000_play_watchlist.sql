-- Step 1 of the scheduled Play Store metadata automation layer (see the
-- Phase 4 audit's own design): the admin-curated, finite set of packages a
-- future scheduled job is allowed to check. This migration creates the
-- table only — no scheduled job, no CLI wiring, no admin UI, and no
-- GitHub Actions workflow exist yet, and this migration inserts no rows
-- of its own.
--
-- Why a new table rather than deriving the watchlist from `apps` where
-- source_type = 'external': deriving from `apps` can only ever cover
-- packages that already exist locally. It can never represent a candidate
-- *new* app — a package not yet in `apps` that an admin wants tracked for
-- a future 'new_app' proposal — because by definition there is no `apps`
-- row to derive that from. A dedicated table is required for that half of
-- the design regardless, and it keeps `apps` itself exactly as it is,
-- the same reasoning already written into
-- 20260913000000_play_import_proposals.sql for why proposals get their
-- own table rather than shadow columns.
--
-- This table is deliberately never consulted by anything yet. A future
-- scheduled job is expected to read only `enabled = true` rows here, feed
-- each package_name/play_url into the existing, unchanged
-- proposeForPackage() (lib/metadata/play-proposal-store.ts), and write
-- last_checked_at/last_success_at/last_failure_at/last_error back onto the
-- matching row — never onto `apps`, `versions`, or Storage.
create table if not exists public.play_watchlist (
  id                uuid primary key default gen_random_uuid(),

  -- The package this watchlist entry tracks. Unique: a package is either
  -- watched or not, there is no meaning to two entries for the same one.
  package_name      text not null unique,

  -- The exact play.google.com app-details URL to fetch for this package —
  -- same shape scripts/import-play-metadata.mjs already validates via
  -- lib/metadata/play-url.ts's parsePlayUrl(). No SQL-level shape check is
  -- imposed here: there is no established convention in this schema for
  -- validating a URL's structure in a CHECK constraint (grep of
  -- 20260903000000_baseline_schema.sql and every later migration turns up
  -- none), and a regex CHECK reimplementing what parsePlayUrl() already
  -- does correctly in TypeScript would only be a second, weaker copy of
  -- that logic that could drift from it. URL validation stays in
  -- application code, exactly where it already lives.
  play_url          text not null,

  -- An admin can pause checking a package without deleting its history —
  -- a disabled entry is simply skipped by a future scheduled run.
  enabled           boolean not null default true,

  -- Observability for a future admin UI, updated by whatever job actually
  -- performs a check. All null until the first run ever touches this row.
  last_checked_at   timestamptz null,
  last_success_at   timestamptz null,
  last_failure_at   timestamptz null,
  last_error        text null,

  created_at        timestamptz not null default now(),

  -- Which admin added this entry, for the audit trail. Nullable: a row
  -- backfilled by a script rather than the (not-yet-built) admin UI has no
  -- admin user to attribute. No ON DELETE clause, matching
  -- play_import_proposals.decided_by's own style — a deleted admin account
  -- leaves this column referencing a row that no longer exists rather than
  -- silently rewriting watchlist history.
  added_by          uuid null references public.users(id)
);


-- ==================================================================== RLS
-- Same authorization boundary as every other admin-writable table in this
-- schema (see "admins manage apps" / "admins manage versions" in
-- 20260903000000_baseline_schema.sql, and "admins manage play import
-- proposals" in 20260913000000_play_import_proposals.sql): is_admin()
-- gates all access, and there is no anon policy at all. A watchlist entry
-- is never public data — an unauthenticated reader has no read path to
-- this table whatsoever.
alter table public.play_watchlist enable row level security;

drop policy if exists "admins manage play watchlist" on public.play_watchlist;
create policy "admins manage play watchlist" on public.play_watchlist
  for all to authenticated
  using (is_admin())
  with check (is_admin());
