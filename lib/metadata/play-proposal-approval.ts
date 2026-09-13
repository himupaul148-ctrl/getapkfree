/**
 * Phase 4d: the actual approve/reject logic for one
 * public.play_import_proposals row — extracted from
 * app/api/admin/play-proposals/[id]/{approve,reject}/route.ts so it can be
 * exercised directly by tests with a fake Supabase client, exactly like
 * lib/apk/verify-version.ts's runVersionVerify() or
 * lib/apk/import-pipeline.ts's runApkUrlImport(). The routes themselves add
 * only admin authentication and Next.js request/response plumbing.
 *
 * Nothing here ever trusts a proposal's stored proposed_fields/app_id as
 * ground truth for what to write. Every write path re-reads the CURRENT
 * apps row by package_name (never by the proposal's stored app_id — an app
 * can be deleted and its id reused by nothing, but package_name is the
 * actual identity key everywhere else in this project too) and re-runs
 * lib/metadata/play-proposals.ts's own precondition/diff logic against that
 * live state before ever calling lib/metadata/play-apply.ts's write
 * functions.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkApprovalPreconditions,
  isProposalExpired,
  recomputeLiveChanges,
  type CurrentAppRow,
  type ProposalStatus,
  type ProposalType,
} from "./play-proposals.ts";
import { findCurrentApp } from "./play-proposal-store.ts";
import { createExternalAppFromPlay, applyPermittedChanges } from "./play-apply.ts";

export type StoredProposalRow = {
  id: string;
  proposal_type: ProposalType;
  package_name: string;
  play_url: string;
  app_id: string | null;
  proposed_fields: Record<string, unknown>;
  previous_fields: Record<string, unknown> | null;
  status: ProposalStatus;
  created_at: string;
};

const PROPOSAL_SELECT =
  "id, proposal_type, package_name, play_url, app_id, proposed_fields, previous_fields, status, created_at";

async function loadProposal(
  supabase: SupabaseClient,
  proposalId: string,
): Promise<StoredProposalRow | null> {
  const { data, error } = await supabase
    .from("play_import_proposals")
    .select(PROPOSAL_SELECT)
    .eq("id", proposalId)
    .maybeSingle<StoredProposalRow>();
  if (error) throw error;
  return data;
}

/**
 * Updates a proposal's status only if it is still in `expectedStatus` —
 * the same read-then-conditionally-write idiom lib/admin/version-publish.ts's
 * setVersionPublished() already uses, and lib/metadata/play-proposal-store.ts's
 * supersedePending() reuses for exactly the same reason: if two requests
 * race to transition the same row, only the first one's write actually
 * changes anything, and the second sees zero affected rows rather than
 * silently double-applying.
 */
async function conditionalStatusUpdate(
  supabase: SupabaseClient,
  proposalId: string,
  expectedStatus: ProposalStatus,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("play_import_proposals")
    .update(patch)
    .eq("id", proposalId)
    .eq("status", expectedStatus)
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

export type RouteResult = { status: number; body: Record<string, unknown> };

/**
 * Runs the full approval flow for one proposal id. Every branch that
 * transitions the proposal's status does so conditionally on it still
 * being 'pending' — see conditionalStatusUpdate() above — so a retried or
 * double-submitted request can never apply the same proposal twice, and a
 * concurrent approve/reject on the same row can never both "win".
 */
export async function approveProposal(
  supabase: SupabaseClient,
  proposalId: string,
  decidedBy: string,
): Promise<RouteResult> {
  const proposal = await loadProposal(supabase, proposalId);
  if (!proposal) {
    return { status: 404, body: { error: "No proposal with that id." } };
  }

  // Fast-path: already decided by an earlier request. Every actual write
  // below is still independently race-guarded — this is purely an early,
  // idempotent response for the common "already handled" case, not the
  // thing that makes double-apply impossible.
  if (proposal.status !== "pending") {
    return {
      status: 200,
      body: { alreadyHandled: true, proposalId, status: proposal.status },
    };
  }

  if (isProposalExpired(proposal.created_at)) {
    await conditionalStatusUpdate(supabase, proposalId, "pending", { status: "expired" });
    return { status: 409, body: { error: "Proposal has expired.", proposalId, status: "expired" } };
  }

  // Never the proposal's stored app_id — package_name is the real identity
  // key, exactly as everywhere else in this project.
  const currentApp = await findCurrentApp(supabase, proposal.package_name);

  const precheck = checkApprovalPreconditions({
    proposal: {
      id: proposal.id,
      status: proposal.status,
      proposal_type: proposal.proposal_type,
      package_name: proposal.package_name,
      created_at: proposal.created_at,
    },
    currentApp,
  });

  if (!precheck.ok) {
    // The proposal no longer represents a valid, applicable operation —
    // the package appeared/disappeared, or its source_type changed —
    // since it was created. Marked 'superseded' (not 'rejected': no admin
    // declined it, reality just moved on) and never written to apps/versions.
    await conditionalStatusUpdate(supabase, proposalId, "pending", { status: "superseded" });
    return { status: 409, body: { error: precheck.reason, proposalId, status: "superseded" } };
  }

  if (proposal.proposal_type === "new_app") {
    return applyNewApp(supabase, proposal, decidedBy);
  }
  return applyMetadataUpdate(supabase, proposal, currentApp!, decidedBy);
}

async function applyNewApp(
  supabase: SupabaseClient,
  proposal: StoredProposalRow,
  decidedBy: string,
): Promise<RouteResult> {
  const fields = proposal.proposed_fields;
  const result = await createExternalAppFromPlay(supabase, {
    packageName: proposal.package_name,
    proposed: {
      source_type: "external",
      hosted_locally: false,
      external_url: proposal.play_url,
      scan_status: "external",
      name: (fields.name as string | undefined) ?? proposal.package_name,
      package_name: proposal.package_name,
      developer_name: (fields.developer_name as string | null | undefined) ?? null,
      description: (fields.description as string | null | undefined) ?? null,
      icon_url: (fields.icon_url as string | null | undefined) ?? null,
      category: (fields.category as string | null | undefined) ?? null,
      rating: (fields.rating as number | null | undefined) ?? null,
      rating_count: (fields.rating_count as number | null | undefined) ?? null,
    },
  });

  if (!result.created) {
    // createExternalAppFromPlay() is itself race-safe by package_name — a
    // concurrent writer already created this app. Never a duplicate;
    // this proposal simply no longer has anything left to do.
    await conditionalStatusUpdate(supabase, proposal.id, "pending", { status: "superseded" });
    return {
      status: 409,
      body: {
        error: "The app already exists (created by a concurrent operation).",
        proposalId: proposal.id,
        status: "superseded",
      },
    };
  }

  const now = new Date().toISOString();
  const marked = await conditionalStatusUpdate(supabase, proposal.id, "pending", {
    status: "applied",
    decided_at: now,
    decided_by: decidedBy,
    applied_at: now,
  });

  if (!marked) {
    // The app row now exists either way (created just above, or by
    // whoever won the race on the proposal's own status) — nothing to
    // roll back, and createExternalAppFromPlay()'s own package_name
    // lookup means no second row was ever at risk of being created.
    return {
      status: 200,
      body: { alreadyHandled: true, proposalId: proposal.id, appId: result.appId, slug: result.slug },
    };
  }

  // A brand-new, zero-version app is invisible on every public surface
  // until it has a published version (confirmed in the Phase 4 safety
  // audit) — no revalidation call is needed here.
  return {
    status: 200,
    body: {
      success: true,
      proposalId: proposal.id,
      status: "applied",
      appId: result.appId,
      slug: result.slug,
    },
  };
}

async function applyMetadataUpdate(
  supabase: SupabaseClient,
  proposal: StoredProposalRow,
  currentApp: CurrentAppRow,
  decidedBy: string,
): Promise<RouteResult> {
  // Never the stale stored proposed_fields taken at face value — re-diffed
  // against the live row, so a manual edit or further drift since the
  // proposal was created is respected exactly as it would be for a fresh
  // proposal.
  const { applied } = recomputeLiveChanges(proposal.proposed_fields, currentApp);

  await applyPermittedChanges(supabase, currentApp.id, applied);

  const now = new Date().toISOString();
  const marked = await conditionalStatusUpdate(supabase, proposal.id, "pending", {
    status: "applied",
    decided_at: now,
    decided_by: decidedBy,
    applied_at: now,
  });

  if (!marked) {
    return {
      status: 200,
      body: { alreadyHandled: true, proposalId: proposal.id, appliedFields: applied.map((c) => c.field) },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      proposalId: proposal.id,
      status: "applied",
      appliedFields: applied.map((c) => c.field),
      appId: currentApp.id,
      appSlug: currentApp.slug,
    },
  };
}

/**
 * Rejects one pending proposal. Never touches apps/versions/storage —
 * this only ever writes to play_import_proposals itself.
 */
export async function rejectProposal(
  supabase: SupabaseClient,
  proposalId: string,
  decidedBy: string,
  reason: string | null,
): Promise<RouteResult> {
  const proposal = await loadProposal(supabase, proposalId);
  if (!proposal) {
    return { status: 404, body: { error: "No proposal with that id." } };
  }

  if (proposal.status !== "pending") {
    return { status: 200, body: { alreadyHandled: true, proposalId, status: proposal.status } };
  }

  const now = new Date().toISOString();
  const marked = await conditionalStatusUpdate(supabase, proposalId, "pending", {
    status: "rejected",
    decided_at: now,
    decided_by: decidedBy,
    rejection_reason: reason,
  });

  if (!marked) {
    return { status: 200, body: { alreadyHandled: true, proposalId } };
  }

  return { status: 200, body: { success: true, proposalId, status: "rejected" } };
}
