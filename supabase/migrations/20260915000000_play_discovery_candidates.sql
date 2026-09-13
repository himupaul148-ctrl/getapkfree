-- Step 1 of the Daily New-App Discovery system (see the discovery audit's
-- own design): the DISCOVERY layer's own table, kept strictly separate
-- from METADATA VERIFICATION (the existing fromPlay()/classifyProposal())
-- and from the PUBLIC LISTING layer (play_import_proposals /
-- createExternalAppFromPlay()). This migration creates the table only —
-- no GitHub API calls, no Play URL extraction, no discovery candidates,
-- no proposals, no GitHub Actions workflow, and no admin UI exist yet,
-- and this migration inserts no rows of its own.
--
-- Why a new table rather than reusing play_watchlist: a watchlist row is
-- an admin-curated statement "check this specific package regularly" —
-- it always already has a known package_name and play_url. A discovery
-- candidate is the opposite: "something that might be a new app", found
-- from an external source (GitHub, HN) before any package_name or Play
-- URL is even known, let alone verified. Conflating the two would force
-- play_watchlist's columns to become nullable for a purpose it was never
-- designed for, and would blur an admin-authorized entry with an
-- unverified, machine-found one — the same reasoning
-- 20260913000000_play_import_proposals.sql and
-- 20260914000000_play_watchlist.sql already gave for not shadowing
-- `apps` with speculative/scheduling columns.
--
-- A discovery candidate becoming a real play_import_proposals row still
-- goes through the exact same, unmodified proposeForPackage() every other
-- proposal source already uses (lib/metadata/play-proposal-store.ts) —
-- this table only ever records what was found and what happened to it, it
-- never becomes a second way to create or shape a proposal.
create table if not exists public.play_discovery_candidates (
  id                 uuid primary key default gen_random_uuid(),

  -- Where this candidate was found. A plain CHECK constraint, matching
  -- this schema's existing convention for a small, closed set of string
  -- values (see apps.source_type's own check in
  -- 20260903000000_baseline_schema.sql, and play_import_proposals.status/
  -- proposal_type). Only the two sources the discovery audit actually
  -- recommends — GitHub's public Search API and Hacker News's public
  -- Algolia API — are listed; no other source is invented here.
  source             text not null,

  -- The source's own identifier for this candidate — e.g. a GitHub repo's
  -- "owner/repo" full name, or an HN item id. Combined with `source` into
  -- the UNIQUE constraint below: the one and only real dedup guard against
  -- rediscovering the same repo/post on a later run.
  source_ref         text not null,

  -- Display-only label (repo name, HN title). Never used for matching or
  -- deduplication — source_ref is.
  candidate_name     text null,

  -- Set once (if ever) a play.google.com URL is extracted from the
  -- candidate's own content (README, repo homepage field, release notes).
  -- Null until then — a candidate with no resolvable Play link never
  -- reaches Play verification at all.
  resolved_play_url  text null,

  -- Set once (if ever) resolved_play_url has been parsed into a package
  -- id. Still not verified against Play at this point — that is a
  -- separate, later step (the existing fromPlay()/classifyProposal()),
  -- never performed by anything in this migration or this table alone.
  package_name       text null,

  -- 'found'                       — just discovered, nothing checked yet.
  -- 'disqualified_no_play_link'   — no play.google.com URL could be
  --                                 extracted from the candidate's content.
  -- 'disqualified_low_quality'    — failed the discovery pipeline's own
  --                                 cheap quality gate before ever
  --                                 reaching Play (e.g. no license, no
  --                                 dated release, too few stars).
  -- 'disqualified_exists'         — a resolved Play URL was checked and
  --                                 the package already exists in `apps`
  --                                 (or is F-Droid-owned), so there is
  --                                 nothing new to propose.
  -- 'verified'                    — passed live Play verification
  --                                 (classifyProposal() returned
  --                                 kind: 'new_app') but has not yet been
  --                                 handed to proposeForPackage().
  -- 'proposed'                    — proposeForPackage() was called and a
  --                                 real play_import_proposals row exists
  --                                 (see proposal_id below). Terminal.
  -- 'error'                       — an unexpected failure occurred while
  --                                 processing this candidate (e.g. a
  --                                 network or database error), distinct
  --                                 from a deliberate disqualification.
  status             text not null default 'found',

  -- Advisory ranking only, used to order same-day candidates when more
  -- pass the quality gate than the daily cap allows. Never a substitute
  -- for the disqualification statuses above, and never consulted by
  -- proposeForPackage() or anything in the existing proposal system.
  score              numeric null,

  -- Set only once this candidate has actually produced a real proposal.
  -- ON DELETE SET NULL, mirroring play_import_proposals.app_id's own
  -- style in 20260913000000_play_import_proposals.sql: if the proposal
  -- row it points to were ever gone, this candidate's own discovery
  -- history (source, source_ref, status, score, timestamps) is still
  -- worth keeping — it would just stop pointing at a row that no longer
  -- exists.
  proposal_id        uuid null references public.play_import_proposals(id) on delete set null,

  discovered_at      timestamptz not null default now(),

  -- Set whenever this candidate was last actually processed (a
  -- disqualification check, a Play verification attempt, or a propose
  -- call) — distinct from discovered_at, which never changes after the
  -- row is first inserted.
  checked_at         timestamptz null,

  constraint play_discovery_candidates_source_check
    check (source = any (array['github', 'hn'])),

  constraint play_discovery_candidates_status_check
    check (status = any (array[
      'found',
      'disqualified_no_play_link',
      'disqualified_low_quality',
      'disqualified_exists',
      'verified',
      'proposed',
      'error'
    ])),

  constraint play_discovery_candidates_source_ref_unique
    unique (source, source_ref)
);


-- ==================================================================== RLS
-- Same authorization boundary as every other admin-writable table in this
-- schema (see "admins manage apps"/"admins manage versions" in
-- 20260903000000_baseline_schema.sql, "admins manage play import
-- proposals" in 20260913000000_play_import_proposals.sql, and "admins
-- manage play watchlist" in 20260914000000_play_watchlist.sql):
-- is_admin() gates all access, and there is no anon policy at all. A
-- discovery candidate is never public data — an unauthenticated reader has
-- no read path to this table whatsoever.
alter table public.play_discovery_candidates enable row level security;

drop policy if exists "admins manage play discovery candidates" on public.play_discovery_candidates;
create policy "admins manage play discovery candidates" on public.play_discovery_candidates
  for all to authenticated
  using (is_admin())
  with check (is_admin());
