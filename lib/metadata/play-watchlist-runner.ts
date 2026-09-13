/**
 * Step 2 of the scheduled Play automation layer: the orchestration layer
 * that runs the finite, admin-curated play_watchlist through the existing,
 * completely unchanged propose pipeline (proposeForPackage() —
 * lib/metadata/play-proposal-store.ts). Everything that decides WHAT to
 * propose, and every safety invariant that governs it (manual_fields,
 * F-Droid ownership, null-never-overwrites, pending-unique superseding),
 * still lives entirely in lib/metadata/play-proposals.ts /
 * play-proposal-store.ts — this module adds only "which packages" (the
 * watchlist, never a discovered/arbitrary set) and "how is watchlist
 * health tracked" on top of it.
 *
 * fetchMetadata and sleep are both injected rather than imported directly,
 * so this module — despite being I/O-shaped (it writes to Supabase and
 * calls a network fetcher) — can be exercised entirely with fakes under
 * plain `node --test`, with no real network call and no real Supabase
 * connection. scripts/import-play-metadata.mjs's --watchlist mode is a
 * thin wrapper around this function: it supplies the real Supabase client,
 * the real fetchMetadata() (lib/metadata/fetchers.ts), and a real sleep,
 * then only handles printing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePlayUrl } from "./play-url.ts";
import {
  partitionWatchlistRows,
  summarizeWatchlistRun,
  type WatchlistRow,
  type WatchlistRowResult,
  type WatchlistRunSummary,
} from "./play-watchlist.ts";
import {
  listWatchlistRows,
  markWatchlistChecked,
  markWatchlistFailure,
  markWatchlistSuccess,
} from "./play-watchlist-store.ts";
import { proposeForPackage } from "./play-proposal-store.ts";
import type { FetchedMetadata } from "./fetchers.ts";

export type WatchlistRowReport = { row: WatchlistRow; result: WatchlistRowResult };

export type WatchlistRunReport = {
  enabled: WatchlistRow[];
  disabled: WatchlistRow[];
  rows: WatchlistRowReport[];
  summary: WatchlistRunSummary;
};

export type WatchlistRunDeps = {
  supabase: SupabaseClient;
  fetchMetadata: (url: string) => Promise<FetchedMetadata>;
  /** Called between real Play fetches only — never after an invalid-URL row, which made no network call at all. */
  sleep: (ms: number) => Promise<void>;
  fetchIntervalMs: number;
};

/**
 * Processes exactly one enabled watchlist row: records that it was
 * checked, validates its stored URL, fetches Play metadata, records
 * success/failure, and — only on a successful fetch — hands the result to
 * proposeForPackage() completely unchanged. A failure at any step is
 * caught here and turned into a result the caller can tally; it never
 * propagates, so one row's failure can never abort the rows after it.
 */
async function processWatchlistRow(
  deps: WatchlistRunDeps,
  row: WatchlistRow,
): Promise<WatchlistRowResult> {
  await markWatchlistChecked(deps.supabase, row.id);

  const parsed = parsePlayUrl(row.play_url);
  if (!parsed.ok) {
    const reason = parsed.reason;
    await markWatchlistFailure(deps.supabase, row.id, `invalid play_url: ${reason}`);
    return { kind: "invalid_url", reason };
  }

  let metadata: FetchedMetadata;
  try {
    metadata = await deps.fetchMetadata(parsed.url);
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    await markWatchlistFailure(deps.supabase, row.id, reason.slice(0, 500));
    return { kind: "fetch_failed", reason };
  }

  // The fetch succeeded — recorded immediately, independent of whether the
  // proposal write below succeeds. A DB failure after a working fetch is a
  // different problem than Play being unreachable, and must not make this
  // row look like the Play fetch itself failed.
  await markWatchlistSuccess(deps.supabase, row.id);

  try {
    const outcome = await proposeForPackage(deps.supabase, {
      fetched: metadata,
      packageName: parsed.packageName,
      playUrl: parsed.url,
    });
    return { kind: "propose", outcome };
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    return { kind: "store_failed", reason };
  }
}

/**
 * Runs every enabled play_watchlist row through processWatchlistRow(), in
 * order, with the same fixed pacing between real Play fetches the file-
 * based --propose mode already uses. Disabled rows are never touched —
 * not fetched, not health-updated, not counted toward failures — only
 * reported as a count. An empty (or all-disabled) watchlist is not an
 * error: the loop simply never runs, and the returned summary is all
 * zeros.
 */
export async function runWatchlistPropose(deps: WatchlistRunDeps): Promise<WatchlistRunReport> {
  const allRows = await listWatchlistRows(deps.supabase);
  const { enabled, disabled } = partitionWatchlistRows(allRows);

  const rows: WatchlistRowReport[] = [];
  for (let i = 0; i < enabled.length; i++) {
    const row = enabled[i];
    const result = await processWatchlistRow(deps, row);
    rows.push({ row, result });
    // Pacing only matters between real network requests; an invalid-URL
    // row is caught before any fetch and costs no delay — the same rule
    // scripts/import-play-metadata.mjs's file-based modes already apply.
    const madeNetworkCall = result.kind !== "invalid_url";
    if (i < enabled.length - 1 && madeNetworkCall) await deps.sleep(deps.fetchIntervalMs);
  }

  const summary = summarizeWatchlistRun(
    enabled.length,
    disabled.length,
    rows.map((r) => r.result),
  );
  return { enabled, disabled, rows, summary };
}
