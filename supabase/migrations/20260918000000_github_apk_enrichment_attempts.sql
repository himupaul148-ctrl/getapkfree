-- Automatic GitHub APK enrichment (see the read-only audit this migration
-- implements): a small, admin-only bookkeeping table so the scheduled
-- enrichment job (scripts/enrich-github-apks.mjs, run by
-- .github/workflows/play-apk-enrichment.yml) has somewhere to record what
-- it decided for every approved, GitHub-discovered app it looked at.
--
-- Why a new table rather than a column on `apps` or reusing
-- play_discovery_candidates: this table holds "what the automatic importer
-- last decided", a fundamentally different thing from `apps`' own current,
-- authoritative row — the exact same reasoning
-- 20260913000000_play_import_proposals.sql and
-- 20260915000000_play_discovery_candidates.sql already gave for not
-- shadowing `apps` with speculative/process-bookkeeping columns, and for
-- not conflating "a discovery candidate was found" with a different later
-- concern. This table never becomes a second source of truth for
-- apps/versions — lib/apk/github-release-import.ts (UNCHANGED by this
-- migration) remains the only thing that ever writes to those.
--
-- One row per app (UNIQUE(app_id)): the importer only ever cares about the
-- MOST RECENT decision for a given app, never a full history — the exact
-- same "one current row, not a log" choice play_discovery_candidates makes
-- for a repo's own discovery status.
create table if not exists public.github_apk_enrichment_attempts (
  id                 uuid primary key default gen_random_uuid(),

  app_id             uuid not null references public.apps(id) on delete cascade,

  -- Mirrors lib/apk/github-release-import.ts's own GithubApkImportResult
  -- status union exactly (that module is NOT modified by this migration or
  -- anything built on top of it) — every value the existing, already-shipped
  -- importGithubApkForApp() can already return, nothing invented here.
  status             text not null,

  -- Human-readable detail for an admin — e.g. an import_failed reason, or
  -- the mismatched package name. Never a raw stack trace or a secret: the
  -- importer's own returned messages are already scrubbed to plain,
  -- user-facing text (see github-release-import.ts's own describeDiscoveryError
  -- and error-message handling), and this column only ever stores exactly
  -- what that function returned.
  message            text null,

  -- "owner/repo" this attempt actually checked, when one was resolved.
  -- Null only for the one status that never got far enough to resolve a
  -- repo at all (no_github_source).
  owner_repo         text null,

  -- Set only for a successful imported_unpublished outcome. ON DELETE SET
  -- NULL: if the version were ever deleted, this row's own attempt history
  -- (status, message, timestamps) is still worth keeping — it would just
  -- stop pointing at a row that no longer exists, mirroring
  -- play_discovery_candidates.proposal_id's own ON DELETE SET NULL choice.
  version_id         uuid null references public.versions(id) on delete set null,

  -- How many times the scheduled job has attempted this app. Starts at 1 on
  -- the first recorded attempt; the store module's recordAttempt()
  -- increments this on every later call for the same app_id rather than
  -- ever inserting a second row.
  attempt_count      integer not null default 1,

  -- Updated on every recordAttempt() call — the retry/cooldown clock the
  -- selection query's 24h window (lib/apk/github-apk-enrichment-store.ts)
  -- is measured against.
  last_attempted_at  timestamptz not null default now(),

  created_at         timestamptz not null default now(),

  constraint github_apk_enrichment_attempts_status_check
    check (status = any (array[
      'no_github_source',
      'github_repo_not_found',
      'no_release',
      'no_apk_asset',
      'multiple_apk_assets',
      'package_mismatch',
      'import_failed',
      'already_has_version',
      'imported_unpublished'
    ])),

  -- The actual "one row per app" guard — also what recordAttempt()'s
  -- insert-then-recover-on-conflict logic keys off of, the same race-safe
  -- idiom lib/apk/save-build.ts's findOrCreateApp() already uses for
  -- apps.package_name.
  constraint github_apk_enrichment_attempts_app_id_key unique (app_id)
);

-- app_id already has a unique index from the constraint above (Postgres
-- creates one automatically) — no separate index needed for it.
create index if not exists idx_github_apk_enrichment_attempts_status
  on public.github_apk_enrichment_attempts (status);

create index if not exists idx_github_apk_enrichment_attempts_last_attempted_at
  on public.github_apk_enrichment_attempts (last_attempted_at);


-- ==================================================================== RLS
-- Same authorization boundary as its siblings (play_import_proposals,
-- play_discovery_candidates): is_admin() gates all access, and there is no
-- anon policy at all. An enrichment attempt is never public data — an
-- unauthenticated reader has no read path to this table whatsoever.
alter table public.github_apk_enrichment_attempts enable row level security;

drop policy if exists "admins manage github apk enrichment attempts" on public.github_apk_enrichment_attempts;
create policy "admins manage github apk enrichment attempts" on public.github_apk_enrichment_attempts
  for all to authenticated
  using (is_admin())
  with check (is_admin());
