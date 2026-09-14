/**
 * Pure, UI-agnostic helpers for the admin Play Proposals page's "Recently
 * approved (GitHub-discovered)" section — no React, no fetch, no DOM, so
 * these can be exercised directly under plain `node --test`, mirroring
 * lib/metadata/play-proposals-ui.ts's own design for the same page's
 * existing pending-queue cards.
 *
 * This module makes NO decisions the enrichment workflow itself doesn't
 * already make: isRetryEligible() is built from the exact same
 * RETRYABLE_STATUSES/TERMINAL_STATUSES/DEFAULT_RETRY_COOLDOWN_HOURS
 * lib/apk/github-apk-enrichment-store.ts already exports and
 * selectEligibleApps() already uses internally — it is a read-only
 * restatement of that eligibility rule for display purposes, never a
 * second, independent definition of it. Nothing here writes to the
 * database, calls the GitHub API, or triggers a retry — it only describes
 * what a caller who already has an attempt row should show.
 */
import { formatShortRelative } from "../format.ts";
import { STATUS_LABELS } from "../apk/enrichment-status-labels.ts";
import {
  DEFAULT_RETRY_COOLDOWN_HOURS,
  RETRYABLE_STATUSES,
  TERMINAL_STATUSES,
  type EnrichmentStatus,
} from "../apk/github-apk-enrichment-store.ts";

/** The subset of an EnrichmentAttemptRow these helpers actually need. */
export type EnrichmentAttemptLike = {
  status: EnrichmentStatus;
  last_attempted_at: string;
};

export type ImportedVersionLike = {
  version_name: string;
  version_code: number;
  published: boolean;
};

/**
 * True if the scheduled enrichment job would consider this app for its
 * next run — the same rule selectEligibleApps() applies inline, restated
 * here as a standalone, directly-testable predicate for display purposes.
 * A missing attempt (never checked yet) is "eligible" in the same sense
 * selectEligibleApps() treats it: there is no cooldown to wait out.
 */
export function isRetryEligible(
  attempt: EnrichmentAttemptLike | null | undefined,
  now: Date = new Date(),
  cooldownHours: number = DEFAULT_RETRY_COOLDOWN_HOURS,
): boolean {
  if (!attempt) return true;
  if (TERMINAL_STATUSES.has(attempt.status)) return false;
  if (!RETRYABLE_STATUSES.has(attempt.status)) return false;

  const lastAttemptMs = Date.parse(attempt.last_attempted_at);
  if (!Number.isFinite(lastAttemptMs)) return true;

  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  return now.getTime() - lastAttemptMs >= cooldownMs;
}

/** package_mismatch and multiple_apk_assets both require a human decision the scheduled job will never make on its own. */
const ATTENTION_STATUSES: ReadonlySet<EnrichmentStatus> = new Set(["package_mismatch", "multiple_apk_assets"]);

export type EnrichmentStatusDescription = {
  /** The raw status, or "no_attempt" when the app has never been checked at all. */
  status: EnrichmentStatus | "no_attempt";
  label: string;
  /** Formatted, minute/hour-granular relative time — null only when there has never been an attempt. */
  lastChecked: string | null;
  /** Whether to render a "Next retry: …" line at all. */
  showRetry: boolean;
  retryText: "eligible now" | "eligible after cooldown" | null;
  versionName: string | null;
  versionCode: number | null;
  published: boolean | null;
  needsAttention: boolean;
};

/**
 * Shapes one attempt (plus, for a successful import, its version row) into
 * exactly what the presentational component needs — nothing more. A null
 * `attempt` means this app has never been checked yet (the attempts table
 * has no row for it), which covers both "the scheduled job hasn't reached
 * it" and "the lookup query itself came back empty" identically — a safe,
 * non-alarming fallback either way, never a crash.
 */
export function describeEnrichmentStatus(
  attempt: EnrichmentAttemptLike | null | undefined,
  version: ImportedVersionLike | null | undefined = null,
  now: Date = new Date(),
): EnrichmentStatusDescription {
  if (!attempt) {
    return {
      status: "no_attempt",
      label: "Waiting for first automatic check",
      lastChecked: null,
      showRetry: false,
      retryText: null,
      versionName: null,
      versionCode: null,
      published: null,
      needsAttention: false,
    };
  }

  const retryable = RETRYABLE_STATUSES.has(attempt.status);
  const eligible = retryable ? isRetryEligible(attempt, now) : false;
  const hasVersion = attempt.status === "imported_unpublished" && Boolean(version);

  return {
    status: attempt.status,
    label: STATUS_LABELS[attempt.status] ?? attempt.status,
    lastChecked: formatShortRelative(attempt.last_attempted_at),
    showRetry: retryable,
    retryText: retryable ? (eligible ? "eligible now" : "eligible after cooldown") : null,
    versionName: hasVersion ? version!.version_name : null,
    versionCode: hasVersion ? version!.version_code : null,
    published: hasVersion ? version!.published : null,
    needsAttention: ATTENTION_STATUSES.has(attempt.status),
  };
}
