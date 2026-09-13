/**
 * Phase 4b: pure proposal-management logic for Play metadata proposals —
 * classification, row-shaping, live re-diffing, staleness, superseding, and
 * approval-precondition checks for `public.play_import_proposals` (see
 * supabase/migrations/20260913000000_play_import_proposals.sql).
 *
 * No fetch, no Supabase client, no I/O of any kind — every function here
 * takes plain data and returns plain data, so the future CLI `--propose`
 * mode and the future approve API route can both call the exact same
 * functions instead of each growing its own copy of "is this safe to
 * write." Reuses lib/metadata/play-dry-run.ts's planImport() for
 * classification/diffing and lib/metadata/provenance.ts's changedFields()/
 * isManual() for the manual-field rule — this module adds nothing new to
 * either of those decisions, it only shapes their output into a
 * proposal-row and re-runs them later against fresh state.
 *
 * This module never decides to write anything. It only ever answers "what
 * would this proposal do" and "is it still safe to do that" — the actual
 * Supabase write, when it exists, stays in lib/metadata/play-apply.ts's
 * createExternalAppFromPlay()/applyPermittedChanges(), called by whatever
 * future code owns a real database connection.
 */
import {
  planImport,
  PLAY_COMPARABLE_FIELDS,
  type ExistingAppPlan,
  type ExistingAppRow,
  type FieldChange,
  type NewAppPlan,
} from "./play-dry-run.ts";
import { changedFields, isManual, type OverridableField } from "./provenance.ts";
import type { FetchedMetadata } from "./fetchers.ts";

/** ExistingAppRow plus the one extra column needed to tell an F-Droid-owned
 * row apart from a Play-managed external one — the same EXISTING_APP_SELECT
 * shape scripts/import-play-metadata.mjs already reads. */
export type CurrentAppRow = ExistingAppRow & { source_type: string };

export type ProposalType = "new_app" | "metadata_update";
export type ProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied"
  | "expired"
  | "superseded";

/* ------------------------------------------------------ safety invariants */

/**
 * Every field that must never appear in a proposal's writable/proposed map,
 * regardless of proposal type. Play's public listing page cannot legitimately
 * produce any of these, and Phase 2 (lib/metadata/play-apply.ts) never reads
 * them from anything this module produces — source_type/hosted_locally/
 * external_url/scan_status are hardcoded there, not taken from a proposal.
 */
export const FORBIDDEN_PROPOSAL_FIELDS = [
  "source_type",
  "hosted_locally",
  "external_url",
  "published",
  "version_code",
  "version_name",
  "scan_status",
  "scanned_at",
  "target_sdk",
  "min_android_version",
  "permissions",
  "changelog",
  "file_size",
  "file_url",
] as const;

export class UnsafeProposalFieldError extends Error {
  constructor(field: string) {
    super(`"${field}" must never appear in a Play proposal's writable field map.`);
    this.name = "UnsafeProposalFieldError";
  }
}

/**
 * Throws if `fields` contains anything outside the Play-comparable display
 * fields (name/description/icon_url/developer_name/category/rating/
 * rating_count) — in particular anything in FORBIDDEN_PROPOSAL_FIELDS.
 * Called at the end of every function in this module that produces a
 * writable field map, so the invariant is enforced by the module itself,
 * not left to callers to remember.
 */
export function assertSafeProposalFields(
  fields: readonly FieldChange[] | Record<string, unknown>,
): void {
  const keys = Array.isArray(fields) ? fields.map((f) => f.field) : Object.keys(fields);
  for (const key of keys) {
    if ((FORBIDDEN_PROPOSAL_FIELDS as readonly string[]).includes(key)) {
      throw new UnsafeProposalFieldError(key);
    }
    if (!(PLAY_COMPARABLE_FIELDS as readonly string[]).includes(key)) {
      throw new UnsafeProposalFieldError(key);
    }
  }
}

/* -------------------------------------------------------- classification */

export type ProposalClassification =
  | { kind: "new_app"; plan: NewAppPlan }
  | { kind: "metadata_update"; plan: ExistingAppPlan }
  | { kind: "unchanged"; plan: ExistingAppPlan }
  | { kind: "ineligible"; reason: string };

/**
 * Classifies what (if anything) should be proposed for one fetched Play
 * listing. Reuses planImport() verbatim for the actual diff/new-vs-existing
 * decision; the one thing this function adds on top is refusing to
 * classify an F-Droid-owned row as anything other than "ineligible" —
 * planImport() itself has no opinion on source_type at all (it only sees
 * whatever `current` it's handed), so that guard belongs here, at the one
 * point every future caller (CLI --propose, approve route) is expected to
 * go through.
 */
export function classifyProposal(
  fetched: FetchedMetadata,
  current: CurrentAppRow | null,
  playUrl: string,
): ProposalClassification {
  if (current && current.source_type === "fdroid") {
    return {
      kind: "ineligible",
      reason: "existing app is F-Droid-sourced; not managed by the Play metadata workflow",
    };
  }

  const plan = planImport(fetched, current, playUrl);
  if (plan.kind === "new") return { kind: "new_app", plan };
  if (plan.unchanged) return { kind: "unchanged", plan };
  return { kind: "metadata_update", plan };
}

/* ------------------------------------------------------------ row shaping */

export type ProposalRow = {
  proposal_type: ProposalType;
  package_name: string;
  play_url: string;
  app_id: string | null;
  proposed_fields: Record<string, unknown>;
  previous_fields: Record<string, unknown> | null;
};

function fieldsFromNewAppPlan(plan: NewAppPlan): Record<string, unknown> {
  // Deliberately NOT the same shape as plan.proposed: source_type,
  // hosted_locally, external_url and scan_status are structural facts
  // about how a Play draft is created (see createExternalAppFromPlay,
  // which hardcodes them), not "metadata a future write should read back
  // out of this row" — storing them here would be exactly the "unnecessary
  // field" the task asks not to store, and would give this module's output
  // a second place those four facts could quietly drift from what
  // createExternalAppFromPlay() actually does.
  const fields: Record<string, unknown> = {
    name: plan.proposed.name,
    description: plan.proposed.description,
    icon_url: plan.proposed.icon_url,
    developer_name: plan.proposed.developer_name,
    category: plan.proposed.category,
    rating: plan.proposed.rating,
    rating_count: plan.proposed.rating_count,
  };
  assertSafeProposalFields(fields);
  return fields;
}

/**
 * Turns a classification into the exact JSON-safe row shape
 * play_import_proposals expects — or null when there is nothing worth
 * proposing (unchanged or ineligible). Only ever includes the fields a
 * metadata proposal could legitimately carry; see assertSafeProposalFields.
 */
export function buildProposalRow(
  classification: ProposalClassification,
  playUrl: string,
): ProposalRow | null {
  if (classification.kind === "new_app") {
    const { plan } = classification;
    return {
      proposal_type: "new_app",
      package_name: plan.packageName,
      play_url: playUrl,
      app_id: null,
      proposed_fields: fieldsFromNewAppPlan(plan),
      previous_fields: null,
    };
  }

  if (classification.kind === "metadata_update") {
    const { plan } = classification;
    const proposed: Record<string, unknown> = {};
    const previous: Record<string, unknown> = {};
    // Only plan.changes — never plan.protectedFields. A manually-overridden
    // field must never even reach the proposal row, let alone a later
    // write: this is the one line that keeps requirement 3 true by
    // construction rather than by a downstream filter remembering to skip it.
    //
    // Also skip any change whose `to` value is null/undefined/empty — Play
    // returning nothing for a field is "Play doesn't expose this right
    // now", never evidence the real value went away, so a proposal must
    // never suggest blanking a stored field. This mirrors
    // lib/metadata/play-apply.ts's writableChangesFor() at proposal-
    // creation time rather than deferring the same rule to apply-time only.
    for (const change of plan.changes) {
      const isNullish = change.to === null || change.to === undefined || change.to === "";
      if (isNullish) continue;
      proposed[change.field] = change.to;
      previous[change.field] = change.from;
    }
    // Nothing survived the null-filter — there is no real proposal here
    // even though planImport() classified it as a metadata_update.
    if (Object.keys(proposed).length === 0) return null;

    assertSafeProposalFields(proposed);
    return {
      proposal_type: "metadata_update",
      package_name: plan.packageName,
      play_url: playUrl,
      app_id: plan.appId,
      proposed_fields: proposed,
      previous_fields: previous,
    };
  }

  // "unchanged" and "ineligible" both mean: nothing to propose right now.
  return null;
}

/* ---------------------------------------------------------- live re-diff */

export type LiveDiff = {
  applied: FieldChange[];
  protectedFields: FieldChange[];
  skippedNull: FieldChange[];
};

/**
 * Recomputes the real, currently-applicable diff for a metadata_update
 * proposal against the CURRENT apps row — never the proposal's own stored
 * previous_fields, which is a snapshot from whenever the proposal was
 * created and may already be stale (Play's ratings/counts drift within
 * minutes; an admin may have hand-edited the app since; manual_fields may
 * have changed). `proposedFields` (the proposal's stored proposed_fields)
 * is the one piece of the stale snapshot this function does still use —
 * not as ground truth to write, but as "what Play said last time", which
 * is a reasonable basis to re-check against fresh data rather than
 * re-fetching Play synchronously inside a pure function.
 *
 * Mirrors planImport()'s existing-app branch and
 * lib/metadata/play-apply.ts's writableChangesFor() combined into one
 * pass, since both decisions (manual-field protection, null-never-
 * overwrites) apply identically here.
 */
export function recomputeLiveChanges(
  proposedFields: Record<string, unknown>,
  currentApp: CurrentAppRow,
): LiveDiff {
  const storedMap: Partial<Record<OverridableField, unknown>> = {
    name: currentApp.name,
    description: currentApp.description,
    icon_url: currentApp.icon_url,
    developer_name: currentApp.developer_name,
    category: currentApp.category,
    rating: currentApp.rating,
    rating_count: currentApp.rating_count,
  };

  const restrictedProposed: Partial<Record<OverridableField, unknown>> = {};
  for (const field of PLAY_COMPARABLE_FIELDS) {
    if (field in proposedFields) restrictedProposed[field] = proposedFields[field];
  }

  const differing = changedFields(storedMap, restrictedProposed);

  const applied: FieldChange[] = [];
  const protectedFields: FieldChange[] = [];
  const skippedNull: FieldChange[] = [];

  for (const field of differing) {
    const to = restrictedProposed[field] ?? null;
    const entry: FieldChange = { field, from: storedMap[field] ?? null, to };

    // manual_fields is read from currentApp — the live row handed in right
    // now, never from whatever it was when the proposal was first created.
    if (isManual(currentApp.manual_fields, field)) {
      protectedFields.push(entry);
      continue;
    }
    const isNullish = to === null || to === undefined || to === "";
    (isNullish ? skippedNull : applied).push(entry);
  }

  assertSafeProposalFields(applied);
  return { applied, protectedFields, skippedNull };
}

/* --------------------------------------------------------------- staleness */

/** No scheduled job checks this — it's evaluated lazily wherever a proposal is about to be read/applied. */
export const DEFAULT_PROPOSAL_TTL_DAYS = 30;

/**
 * True once `createdAt` is older than `ttlDays`. `now`/`ttlDays` are both
 * parameters (not module-level constants baked into the check) specifically
 * so tests — and any future caller with a different risk tolerance — don't
 * need to fake the system clock to exercise this.
 */
export function isProposalExpired(
  createdAt: string | Date,
  now: Date = new Date(),
  ttlDays: number = DEFAULT_PROPOSAL_TTL_DAYS,
): boolean {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  return now.getTime() - created.getTime() > ttlMs;
}

/* -------------------------------------------------------------- superseding */

export type SupersedeResult = {
  /** The status transition the OLD row should receive — this function performs no write itself. */
  oldProposalTransition: { id: string; status: "superseded" };
  /** The fresh row to insert in its place. */
  newProposal: ProposalRow;
};

export class ProposalMismatchError extends Error {}

/**
 * Decides what superseding a pending proposal with a freshly-classified one
 * should look like — never touches a database. A fresher proposal for the
 * same package+type is expected to replace a still-pending one (Play data
 * drifts continuously, so an admin should review current numbers, not
 * whatever was true when the first proposal was generated) while keeping
 * the old row around, marked 'superseded', for the audit trail rather than
 * deleting it.
 */
export function supersede(
  pending: { id: string; package_name: string; proposal_type: ProposalType },
  fresh: ProposalRow,
): SupersedeResult {
  if (pending.package_name !== fresh.package_name || pending.proposal_type !== fresh.proposal_type) {
    throw new ProposalMismatchError(
      `cannot supersede ${pending.proposal_type}/${pending.package_name} with ${fresh.proposal_type}/${fresh.package_name}`,
    );
  }
  return {
    oldProposalTransition: { id: pending.id, status: "superseded" },
    newProposal: fresh,
  };
}

/* ------------------------------------------------------ approval preconditions */

export type ApprovalPrecondition = { ok: true } | { ok: false; reason: string };

export type StoredProposal = {
  id: string;
  status: ProposalStatus;
  proposal_type: ProposalType;
  package_name: string;
  created_at: string | Date;
};

/**
 * The full set of checks an approval must pass before any write is even
 * attempted — every one of these can have become false between when the
 * proposal was created and when an admin actually clicks Approve, so this
 * takes the CURRENT app row (or null), never anything stored on the
 * proposal itself. manual_fields protection is deliberately NOT re-checked
 * here — that happens in recomputeLiveChanges(), which is always the next
 * step after these preconditions pass; this function only answers "is it
 * even meaningful to compute a diff", not "which fields survive it".
 */
export function checkApprovalPreconditions(input: {
  proposal: StoredProposal;
  currentApp: CurrentAppRow | null;
  now?: Date;
  ttlDays?: number;
}): ApprovalPrecondition {
  const { proposal, currentApp } = input;

  if (proposal.status !== "pending") {
    return { ok: false, reason: `proposal is not pending (status: "${proposal.status}")` };
  }
  if (isProposalExpired(proposal.created_at, input.now, input.ttlDays)) {
    return { ok: false, reason: "proposal has expired" };
  }

  if (proposal.proposal_type === "new_app") {
    if (currentApp) {
      return currentApp.source_type === "fdroid"
        ? {
            ok: false,
            reason:
              "package now belongs to an F-Droid-sourced app; a Play external draft cannot be created over it",
          }
        : {
            ok: false,
            reason: "package already exists in the catalogue; this new_app proposal is stale",
          };
    }
    return { ok: true };
  }

  // metadata_update
  if (!currentApp) {
    return { ok: false, reason: "the app this proposal refers to no longer exists" };
  }
  if (currentApp.package_name !== proposal.package_name) {
    return { ok: false, reason: "package_name mismatch between the proposal and the current app row" };
  }
  if (currentApp.source_type === "fdroid") {
    return {
      ok: false,
      reason: "app is now F-Droid-sourced; Play metadata must not be applied to it",
    };
  }
  return { ok: true };
}
