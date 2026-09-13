/**
 * Step 2 of the scheduled Play automation layer: pure logic for the
 * play_watchlist-aware proposal runner — selecting which rows a run should
 * touch and aggregating what happened, once it's over. No fetch, no
 * Supabase client, no I/O of any kind, mirroring
 * lib/metadata/play-proposals.ts's own "decides WHAT, never does IT" split.
 *
 * What to fetch and what to propose for a given package are entirely
 * unchanged — this module adds nothing on top of parsePlayUrl()
 * (lib/metadata/play-url.ts) and ProposeOutcome (already produced by
 * proposeForPackage() in lib/metadata/play-proposal-store.ts). It only
 * decides which watchlist rows are in scope for a run, and how to
 * summarize the per-row results those existing functions already produce.
 */
import { parsePlayUrl, type PlayUrlResult } from "./play-url.ts";
import type { ProposeOutcome } from "./play-proposal-store.ts";

export type WatchlistRow = {
  id: string;
  package_name: string;
  play_url: string;
  enabled: boolean;
  last_checked_at?: string | null;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  last_error?: string | null;
};

/**
 * Splits every watchlist row into the finite set a run is allowed to touch
 * (enabled) and the set it must skip entirely, including never updating
 * their health timestamps (disabled). This is the one place "which
 * packages are in scope" is decided — a run must never discover or process
 * anything outside this list.
 */
export function partitionWatchlistRows(
  rows: WatchlistRow[],
): { enabled: WatchlistRow[]; disabled: WatchlistRow[] } {
  const enabled: WatchlistRow[] = [];
  const disabled: WatchlistRow[] = [];
  for (const row of rows) (row.enabled ? enabled : disabled).push(row);
  return { enabled, disabled };
}

/** Validates one row's stored URL using the exact same rule scripts/import-play-metadata.mjs's file-based mode already applies. */
export function validateWatchlistRow(row: WatchlistRow): PlayUrlResult {
  return parsePlayUrl(row.play_url);
}

export type WatchlistRowResult =
  | { kind: "invalid_url"; reason: string }
  | { kind: "fetch_failed"; reason: string }
  | { kind: "store_failed"; reason: string }
  | { kind: "propose"; outcome: ProposeOutcome };

export type WatchlistRunSummary = {
  enabledCount: number;
  disabledCount: number;
  successfulFetches: number;
  failedFetches: number;
  newProposals: number;
  metadataUpdateProposals: number;
  unchanged: number;
  ineligible: number;
  superseded: number;
  storeFailures: number;
};

/**
 * Pure aggregation over one run's per-row results — no I/O, fully testable.
 * Mirrors lib/metadata/play-proposal-store.ts's summarizeProposeRun(), with
 * the watchlist-specific outcomes (invalid URL, disabled count, a fetch
 * that succeeded but whose proposal write then failed) folded in on top.
 */
export function summarizeWatchlistRun(
  enabledCount: number,
  disabledCount: number,
  results: WatchlistRowResult[],
): WatchlistRunSummary {
  const summary: WatchlistRunSummary = {
    enabledCount,
    disabledCount,
    successfulFetches: 0,
    failedFetches: 0,
    newProposals: 0,
    metadataUpdateProposals: 0,
    unchanged: 0,
    ineligible: 0,
    superseded: 0,
    storeFailures: 0,
  };

  for (const result of results) {
    switch (result.kind) {
      case "invalid_url":
      case "fetch_failed":
        summary.failedFetches++;
        break;
      case "store_failed":
        // The fetch itself succeeded — only recording the proposal failed.
        summary.successfulFetches++;
        summary.storeFailures++;
        break;
      case "propose":
        summary.successfulFetches++;
        switch (result.outcome.status) {
          case "unchanged":
            summary.unchanged++;
            break;
          case "ineligible":
            summary.ineligible++;
            break;
          case "new_app":
            summary.newProposals++;
            if (result.outcome.superseded) summary.superseded++;
            break;
          case "metadata_update":
            summary.metadataUpdateProposals++;
            if (result.outcome.superseded) summary.superseded++;
            break;
        }
        break;
    }
  }

  return summary;
}
