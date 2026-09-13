/**
 * Phase 4e: pure, UI-agnostic helpers for
 * components/admin/PlayProposalsReview.tsx — API-response interpretation,
 * field-value formatting, and filtering. No React, no fetch, no DOM, so
 * these can be exercised directly under plain `node --test`, unlike the
 * "use client" component itself (which — like every other client component
 * in this project — has no JSX transform available to the test runner).
 *
 * This module never talks to a database or an API on its own; it only
 * decides what a given response *means* once the component has already
 * called one of the existing Phase 4d routes.
 */
import { FIELD_LABELS, type OverridableField } from "./provenance.ts";

export type ProposalTypeUi = "new_app" | "metadata_update";

export type PostActionResult =
  | { networkError: true }
  | { networkError: false; status: number; body: Record<string, unknown> | null };

export type Outcome = {
  message: string;
  kind: "success" | "error";
  /** Whether this proposal should disappear from the pending list regardless of the message shown. */
  removeFromList: boolean;
};

/**
 * Interprets one approve/reject response. Both routes report the same
 * shapes (401/403, 404, already-handled, expired, superseded, success) for
 * the same underlying reasons, so one interpreter covers both actions.
 */
export function describeOutcome(result: PostActionResult): Outcome {
  if (result.networkError) {
    return {
      message: "Could not reach the server. Check your connection and try again.",
      kind: "error",
      removeFromList: false,
    };
  }

  const { status, body } = result;

  if (status === 401 || status === 403) {
    return { message: "You don't have permission to do this.", kind: "error", removeFromList: false };
  }
  if (status === 404) {
    return { message: "This proposal no longer exists.", kind: "error", removeFromList: true };
  }
  if (body?.alreadyHandled) {
    const handledStatus = typeof body.status === "string" ? body.status : "handled";
    return {
      message: `This proposal was already ${handledStatus} — no action was taken.`,
      kind: "error",
      removeFromList: true,
    };
  }
  if (status === 409 && body?.status === "expired") {
    return {
      message:
        "This proposal has expired — Play's data has likely moved on since it was created. Regenerate it (via the CLI's --propose mode) rather than retrying.",
      kind: "error",
      removeFromList: true,
    };
  }
  if (status === 409 && body?.status === "superseded") {
    return {
      message: "This proposal is no longer valid — the underlying app changed (or now conflicts) since this proposal was created.",
      kind: "error",
      removeFromList: true,
    };
  }
  if (status >= 500) {
    return { message: "Something went wrong on the server. Try again in a moment.", kind: "error", removeFromList: false };
  }
  if (status === 200 && body?.success) {
    return { message: "success", kind: "success", removeFromList: true };
  }
  return {
    message: (typeof body?.error === "string" && body.error) || "That request could not be completed.",
    kind: "error",
    removeFromList: false,
  };
}

/** "17199543" -> "17,199,543"; a rating stays at two decimal places; everything else passes through. */
export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (field === "rating_count" && typeof value === "number") return value.toLocaleString("en-US");
  if (field === "rating" && typeof value === "number") return value.toFixed(2);
  return String(value);
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field as OverridableField] ?? field;
}

export function filterProposals<T extends { proposalType: ProposalTypeUi }>(
  proposals: T[],
  filter: "all" | ProposalTypeUi,
): T[] {
  return proposals.filter((p) => filter === "all" || p.proposalType === filter);
}
