-- Phase 4a of the Play Store metadata import workflow: the durable review
-- queue Phase 4's admin approval UI will read from and write to. This
-- migration creates the table only — no CLI --propose mode, no
-- approve/reject API routes, and no admin UI exist yet, and this migration
-- inserts no rows of its own.
--
-- Why a new table rather than shadow columns on `apps`: a proposal holds a
-- *speculative future* value fetched from Play, which is a fundamentally
-- different thing from `apps`' own current, authoritative row — conflating
-- the two in the same row (e.g. a `proposed_name` column sitting next to
-- `name`) would blur "what is true now" with "what someone is suggesting",
-- and would need one extra column per overridable field besides. A separate
-- table keeps `apps`/`versions` exactly as they are.
--
-- Every write derived from an approved proposal must still go through the
-- exact same functions Phase 2 already uses (createExternalAppFromPlay,
-- applyPermittedChanges in lib/metadata/play-apply.ts) — this table only
-- queues and records decisions, it never becomes a second source of truth
-- for what `apps`/`versions` actually contain.
create table if not exists public.play_import_proposals (
  id                uuid primary key default gen_random_uuid(),

  -- 'new_app' — the package is not in `apps` yet; approving creates a
  --   metadata-only external app row with zero versions (see
  --   lib/metadata/play-apply.ts's own doc comment for why no version is
  --   ever invented).
  -- 'metadata_update' — the package already has an app row; this proposes
  --   changing some of its display fields to match what Play currently
  --   shows.
  proposal_type     text not null,

  -- The package this proposal is about. Not unique on its own — the same
  -- package can accumulate a history of proposals over time (pending,
  -- then applied, then a later metadata_update once Play's listing
  -- changes again) — see the partial unique index below for what actually
  -- must stay unique.
  package_name      text not null,

  -- The exact play.google.com app-details URL this proposal was fetched
  -- from — the same URL fromPlay() (lib/metadata/fetchers.ts) was given,
  -- kept so an admin reviewing this proposal can go look at the live page
  -- themselves before deciding.
  play_url          text not null,

  -- Set for 'metadata_update' proposals. Null for a 'new_app' proposal
  -- until (and unless) it is approved — there is no app row to reference
  -- before then. ON DELETE SET NULL: if the app is later deleted, the
  -- proposal's own history is still worth keeping for the audit trail:
  -- it just stops pointing at a row that no longer exists.
  app_id            uuid null references public.apps(id) on delete set null,

  -- What fromPlay() returned at proposal-creation time, for display only.
  -- The approve route must never treat this as ground truth for the write
  -- itself — Play's own numbers (ratings, counts) drift within minutes,
  -- so approval always re-fetches and re-diffs against the *live* apps
  -- row before writing anything, exactly the way lib/metadata/play-apply.ts
  -- already insists on for every write it performs.
  proposed_fields   jsonb not null,

  -- What was stored in `apps` at proposal-creation time, kept purely so
  -- the review UI can render an accurate old -> new diff without a second
  -- round trip. Null for a 'new_app' proposal, which has no prior stored
  -- state to show.
  previous_fields   jsonb null,

  -- 'pending'     — awaiting admin review, the only state a fresh proposal
  --                 starts in.
  -- 'approved'    — an admin has decided to accept it; distinct from
  --                 'applied' so a write that fails after the decision is
  --                 recorded is visibly different from a decision never
  --                 made at all.
  -- 'rejected'    — an admin declined it. Terminal.
  -- 'applied'     — the write actually landed in apps/versions. Terminal.
  -- 'expired'     — too old to trust the snapshot in proposed_fields;
  --                 never applied. Terminal.
  -- 'superseded'  — a fresher proposal for the same package+type replaced
  --                 this one before it was ever decided. Terminal.
  status            text not null default 'pending',

  created_at        timestamptz not null default now(),

  -- Set together, whichever way the decision goes.
  decided_at        timestamptz null,
  decided_by        uuid null references public.users(id),

  -- Only meaningful when status = 'rejected' — the reason an admin gave,
  -- so a later reviewer (or the same one) can see why without having to
  -- remember or re-derive it.
  rejection_reason  text null,

  -- Set only once the underlying apps/versions write actually completes.
  applied_at        timestamptz null,

  constraint play_import_proposals_proposal_type_check
    check (proposal_type = any (array['new_app', 'metadata_update'])),

  constraint play_import_proposals_status_check
    check (status = any (array[
      'pending',
      'approved',
      'rejected',
      'applied',
      'expired',
      'superseded'
    ]))
);


-- At most one PENDING proposal per (package, type) at a time — this is the
-- actual duplicate-proposal guard, enforced by Postgres itself rather than
-- application code alone. A plain UNIQUE constraint can't express "unique
-- only among rows matching a condition"; a partial index can. A later
-- proposal for the same package+type is expected to mark this one
-- 'superseded' first (Phase 4c's job, not this migration's) rather than
-- ever colliding with it.
create unique index if not exists play_import_proposals_pending_unique
  on public.play_import_proposals (package_name, proposal_type)
  where (status = 'pending');


-- ==================================================================== RLS
-- Same authorization boundary as every other admin-writable table in this
-- schema (see "admins manage apps" / "admins manage versions" in
-- 20260903000000_baseline_schema.sql): is_admin() gates all access, and
-- there is no anon policy at all. Proposals are never public data — an
-- unauthenticated reader has no read path to this table whatsoever, unlike
-- apps/versions which are deliberately readable (subject to `published`)
-- by anon.
alter table public.play_import_proposals enable row level security;

drop policy if exists "admins manage play import proposals" on public.play_import_proposals;
create policy "admins manage play import proposals" on public.play_import_proposals
  for all to authenticated
  using (is_admin())
  with check (is_admin());
