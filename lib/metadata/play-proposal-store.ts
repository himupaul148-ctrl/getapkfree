/**
 * Phase 4c: the Supabase I/O layer for Play metadata proposals.
 *
 * Everything that decides WHAT to propose lives in
 * lib/metadata/play-proposals.ts (pure, no Supabase import at all). This
 * module only adds a real database connection around those decisions, and
 * it writes to exactly one table: public.play_import_proposals. It never
 * touches `apps`, `versions`, or Storage — there is no code path here that
 * could, since the only `.from(...)` calls in this file name
 * "apps" (read-only) and "play_import_proposals" (read + write).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertSafeProposalFields,
  buildProposalRow,
  classifyProposal,
  type CurrentAppRow,
  type ProposalRow,
  type ProposalStatus,
  type ProposalType,
} from "./play-proposals.ts";
import type { FetchedMetadata } from "./fetchers.ts";

function isUniqueViolation(
  error: { message?: string | null; code?: string | null } | null | undefined,
  constraint: string,
): boolean {
  if (!error) return false;
  return error.code === "23505" || Boolean(error.message?.includes(constraint));
}

/** Read-only — the same shape scripts/import-play-metadata.mjs's --apply mode already selects. */
export const CURRENT_APP_SELECT =
  "id, slug, package_name, name, description, icon_url, developer_name, category, rating, rating_count, manual_fields, source_type";

export async function findCurrentApp(
  supabase: SupabaseClient,
  packageName: string,
): Promise<CurrentAppRow | null> {
  const { data, error } = await supabase
    .from("apps")
    .select(CURRENT_APP_SELECT)
    .eq("package_name", packageName)
    .maybeSingle<CurrentAppRow>();
  if (error) throw error;
  return data;
}

async function findPendingProposal(
  supabase: SupabaseClient,
  packageName: string,
  proposalType: ProposalType,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("play_import_proposals")
    .select("id")
    .eq("package_name", packageName)
    .eq("proposal_type", proposalType)
    .eq("status", "pending")
    .maybeSingle<{ id: string }>();
  if (error) throw error;
  return data;
}

/**
 * Read-only lookup used by the discovery pipeline's duplicate-protection
 * check (lib/metadata/play-discovery-pipeline.ts): does ANY proposal —
 * regardless of status — already exist for this (package_name,
 * proposal_type)? Unlike findPendingProposal() above, this deliberately
 * also matches a 'rejected'/'applied'/'expired'/'superseded' row: a
 * package an admin already declined once must not be silently re-proposed
 * just because a discovery source (e.g. the same GitHub repo, found
 * again on a later run) surfaces it a second time. Never used by the
 * insert/supersede path itself — only by a caller deciding whether to
 * call proposeForPackage() at all.
 */
export async function findAnyProposalForPackage(
  supabase: SupabaseClient,
  packageName: string,
  proposalType: ProposalType,
): Promise<{ id: string; status: ProposalStatus } | null> {
  const { data, error } = await supabase
    .from("play_import_proposals")
    .select("id, status")
    .eq("package_name", packageName)
    .eq("proposal_type", proposalType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: ProposalStatus }>();
  if (error) throw error;
  return data;
}

/**
 * Marks one pending proposal 'superseded' — never deleted, so its
 * proposed_fields/previous_fields/created_at stay in the table as history.
 * Conditional on `status = 'pending'` in the WHERE clause (not just the id)
 * for the same reason lib/admin/version-publish.ts's setVersionPublished()
 * guards its own write the same way: if two callers race to supersede the
 * same row, only the first one's write actually changes anything, and the
 * second sees zero affected rows rather than double-superseding silently.
 */
async function supersedePending(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("play_import_proposals")
    .update({ status: "superseded" })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function insertPendingProposal(
  supabase: SupabaseClient,
  row: ProposalRow,
): Promise<{ data: { id: string } | null; error: { message?: string | null; code?: string | null } | null }> {
  const { data, error } = await supabase
    .from("play_import_proposals")
    .insert({
      proposal_type: row.proposal_type,
      package_name: row.package_name,
      play_url: row.play_url,
      app_id: row.app_id,
      proposed_fields: row.proposed_fields,
      previous_fields: row.previous_fields,
      // status, created_at, id all come from the table's own defaults —
      // never set explicitly here, so this can never accidentally insert
      // anything other than a fresh 'pending' proposal.
    })
    .select("id")
    .single<{ id: string }>();
  return { data, error };
}

export type InsertProposalResult = {
  id: string;
  /** True if an existing pending proposal for the same package+type was marked superseded first. */
  superseded: boolean;
};

/**
 * Inserts one pending proposal, superseding any existing pending proposal
 * for the same (package_name, proposal_type) first — old rows are marked
 * 'superseded', never deleted, so proposal history is always preserved.
 * Re-validates the row's field maps with assertSafeProposalFields()
 * immediately before ever building the insert payload: buildProposalRow()
 * (lib/metadata/play-proposals.ts) already guarantees this, but a CLI- or
 * future-caller-generated row is never trusted blindly here either.
 *
 * Race-safe: if a concurrent writer's pending proposal for the same
 * package+type lands between this call's own supersede-check and its
 * insert, the DB's partial unique index (play_import_proposals_pending_unique)
 * rejects the insert with a 23505; this function recovers by superseding
 * whichever row actually won the race and retrying the insert exactly
 * once, rather than either erroring out or silently creating a duplicate.
 */
export async function insertProposal(
  supabase: SupabaseClient,
  row: ProposalRow,
): Promise<InsertProposalResult> {
  assertSafeProposalFields(row.proposed_fields);
  if (row.previous_fields) assertSafeProposalFields(row.previous_fields);

  const existing = await findPendingProposal(supabase, row.package_name, row.proposal_type);
  let superseded = false;
  if (existing) {
    superseded = await supersedePending(supabase, existing.id);
  }

  let result = await insertPendingProposal(supabase, row);

  if (result.error) {
    if (!isUniqueViolation(result.error, "play_import_proposals_pending_unique")) {
      throw result.error;
    }
    // Someone else's pending proposal for this exact package+type landed
    // between the check above and this insert — supersede whichever row
    // actually exists now and retry once.
    const raceWinner = await findPendingProposal(supabase, row.package_name, row.proposal_type);
    if (raceWinner) {
      superseded = (await supersedePending(supabase, raceWinner.id)) || superseded;
    }
    result = await insertPendingProposal(supabase, row);
    if (result.error) throw result.error;
  }

  return { id: result.data!.id, superseded };
}

export type ProposeOutcome =
  | { status: "unchanged" }
  | { status: "ineligible"; reason: string }
  | {
      status: "new_app";
      proposalId: string;
      superseded: boolean;
      row: ProposalRow;
    }
  | {
      status: "metadata_update";
      proposalId: string;
      superseded: boolean;
      row: ProposalRow;
      appSlug: string;
    };

/**
 * The one function scripts/import-play-metadata.mjs's --propose mode calls
 * per package: reads the current app (if any), classifies, shapes, and —
 * only for a real new_app/metadata_update proposal — inserts. Every other
 * outcome (unchanged, ineligible) writes nothing at all.
 */
export async function proposeForPackage(
  supabase: SupabaseClient,
  input: { fetched: FetchedMetadata; packageName: string; playUrl: string },
): Promise<ProposeOutcome> {
  const current = await findCurrentApp(supabase, input.packageName);
  const classification = classifyProposal(input.fetched, current, input.playUrl);
  const row = buildProposalRow(classification, input.playUrl);

  if (!row) {
    return classification.kind === "ineligible"
      ? { status: "ineligible", reason: classification.reason }
      : { status: "unchanged" };
  }

  const { id, superseded } = await insertProposal(supabase, row);

  if (classification.kind === "new_app") {
    return { status: "new_app", proposalId: id, superseded, row };
  }
  return {
    status: "metadata_update",
    proposalId: id,
    superseded,
    row,
    appSlug: current!.slug,
  };
}

export type ProposeSummary = {
  totalUrls: number;
  successfulFetches: number;
  failures: number;
  newProposals: number;
  metadataUpdateProposals: number;
  unchanged: number;
  skipped: number;
  superseded: number;
  inserted: number;
};

/** Pure aggregation over one run's per-URL outcomes — no I/O, fully testable. */
export function summarizeProposeRun(
  outcomes: (ProposeOutcome | { status: "invalid_url" } | { status: "fetch_failed" } | { status: "failed" })[],
): ProposeSummary {
  const summary: ProposeSummary = {
    totalUrls: outcomes.length,
    successfulFetches: 0,
    failures: 0,
    newProposals: 0,
    metadataUpdateProposals: 0,
    unchanged: 0,
    skipped: 0,
    superseded: 0,
    inserted: 0,
  };

  for (const outcome of outcomes) {
    switch (outcome.status) {
      case "invalid_url":
      case "fetch_failed":
      case "failed":
        summary.failures++;
        break;
      case "ineligible":
        summary.successfulFetches++;
        summary.skipped++;
        break;
      case "unchanged":
        summary.successfulFetches++;
        summary.unchanged++;
        break;
      case "new_app":
        summary.successfulFetches++;
        summary.newProposals++;
        summary.inserted++;
        if (outcome.superseded) summary.superseded++;
        break;
      case "metadata_update":
        summary.successfulFetches++;
        summary.metadataUpdateProposals++;
        summary.inserted++;
        if (outcome.superseded) summary.superseded++;
        break;
    }
  }

  return summary;
}
