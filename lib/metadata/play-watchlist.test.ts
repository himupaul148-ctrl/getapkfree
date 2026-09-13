import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  partitionWatchlistRows,
  summarizeWatchlistRun,
  validateWatchlistRow,
  type WatchlistRow,
  type WatchlistRowResult,
} from "./play-watchlist.ts";
import type { ProposeOutcome } from "./play-proposal-store.ts";

function row(overrides: Partial<WatchlistRow> = {}): WatchlistRow {
  return {
    id: "row-1",
    package_name: "org.telegram.messenger",
    play_url: "https://play.google.com/store/apps/details?id=org.telegram.messenger",
    enabled: true,
    ...overrides,
  };
}

group("partitionWatchlistRows", () => {
  test("splits enabled and disabled rows", () => {
    const rows = [row({ id: "a", enabled: true }), row({ id: "b", enabled: false }), row({ id: "c", enabled: true })];
    const { enabled, disabled } = partitionWatchlistRows(rows);
    assert.deepEqual(enabled.map((r) => r.id), ["a", "c"]);
    assert.deepEqual(disabled.map((r) => r.id), ["b"]);
  });

  test("an empty watchlist partitions to two empty lists, not an error", () => {
    const { enabled, disabled } = partitionWatchlistRows([]);
    assert.deepEqual(enabled, []);
    assert.deepEqual(disabled, []);
  });

  test("an all-disabled watchlist partitions to zero enabled rows", () => {
    const rows = [row({ id: "a", enabled: false }), row({ id: "b", enabled: false })];
    const { enabled, disabled } = partitionWatchlistRows(rows);
    assert.equal(enabled.length, 0);
    assert.equal(disabled.length, 2);
  });
});

group("validateWatchlistRow", () => {
  test("a valid play.google.com app-details URL parses ok", () => {
    const result = validateWatchlistRow(row());
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.packageName, "org.telegram.messenger");
  });

  test("an invalid URL fails with a reason, using the exact same rule as the file-based mode", () => {
    const result = validateWatchlistRow(row({ play_url: "https://example.com/not-play" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /not a play\.google\.com URL/);
  });
});

group("summarizeWatchlistRun", () => {
  function propose(outcome: ProposeOutcome): WatchlistRowResult {
    return { kind: "propose", outcome };
  }

  test("an empty result list with zero enabled/disabled counts summarizes to all zeros", () => {
    const summary = summarizeWatchlistRun(0, 0, []);
    assert.deepEqual(summary, {
      enabledCount: 0,
      disabledCount: 0,
      successfulFetches: 0,
      failedFetches: 0,
      newProposals: 0,
      metadataUpdateProposals: 0,
      unchanged: 0,
      ineligible: 0,
      superseded: 0,
      storeFailures: 0,
    });
  });

  test("carries enabledCount/disabledCount through unchanged", () => {
    const summary = summarizeWatchlistRun(5, 2, []);
    assert.equal(summary.enabledCount, 5);
    assert.equal(summary.disabledCount, 2);
  });

  test("invalid_url and fetch_failed both count as failed fetches, not successful ones", () => {
    const summary = summarizeWatchlistRun(2, 0, [
      { kind: "invalid_url", reason: "bad url" },
      { kind: "fetch_failed", reason: "network error" },
    ]);
    assert.equal(summary.failedFetches, 2);
    assert.equal(summary.successfulFetches, 0);
  });

  test("store_failed counts as a successful fetch AND a store failure — the fetch worked, the write didn't", () => {
    const summary = summarizeWatchlistRun(1, 0, [{ kind: "store_failed", reason: "db error" }]);
    assert.equal(summary.successfulFetches, 1);
    assert.equal(summary.storeFailures, 1);
    assert.equal(summary.failedFetches, 0);
  });

  test("a new_app propose outcome increments newProposals and successfulFetches", () => {
    const summary = summarizeWatchlistRun(1, 0, [
      propose({
        status: "new_app",
        proposalId: "p1",
        superseded: false,
        row: { proposal_type: "new_app", package_name: "com.discord", play_url: "u", app_id: null, proposed_fields: {}, previous_fields: null },
      }),
    ]);
    assert.equal(summary.newProposals, 1);
    assert.equal(summary.successfulFetches, 1);
    assert.equal(summary.superseded, 0);
  });

  test("a superseded new_app outcome also increments superseded", () => {
    const summary = summarizeWatchlistRun(1, 0, [
      propose({
        status: "new_app",
        proposalId: "p1",
        superseded: true,
        row: { proposal_type: "new_app", package_name: "com.discord", play_url: "u", app_id: null, proposed_fields: {}, previous_fields: null },
      }),
    ]);
    assert.equal(summary.newProposals, 1);
    assert.equal(summary.superseded, 1);
  });

  test("a metadata_update propose outcome increments metadataUpdateProposals", () => {
    const summary = summarizeWatchlistRun(1, 0, [
      propose({
        status: "metadata_update",
        proposalId: "p2",
        superseded: false,
        row: {
          proposal_type: "metadata_update",
          package_name: "org.telegram.messenger",
          play_url: "u",
          app_id: "app-1",
          proposed_fields: { rating_count: 17227838 },
          previous_fields: { rating_count: 17199543 },
        },
        appSlug: "telegram",
      }),
    ]);
    assert.equal(summary.metadataUpdateProposals, 1);
  });

  test("an unchanged propose outcome increments unchanged, not any proposal count", () => {
    const summary = summarizeWatchlistRun(1, 0, [propose({ status: "unchanged" })]);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.newProposals, 0);
    assert.equal(summary.metadataUpdateProposals, 0);
  });

  test("an ineligible propose outcome (e.g. F-Droid-owned) increments ineligible, not a failure", () => {
    const summary = summarizeWatchlistRun(1, 0, [
      propose({ status: "ineligible", reason: "existing app is F-Droid-sourced; not managed by the Play metadata workflow" }),
    ]);
    assert.equal(summary.ineligible, 1);
    assert.equal(summary.failedFetches, 0);
  });

  test("a mixed run tallies every kind independently", () => {
    const summary = summarizeWatchlistRun(6, 1, [
      { kind: "invalid_url", reason: "bad" },
      { kind: "fetch_failed", reason: "network" },
      { kind: "store_failed", reason: "db" },
      propose({ status: "unchanged" }),
      propose({ status: "ineligible", reason: "f-droid" }),
      propose({
        status: "new_app",
        proposalId: "p1",
        superseded: false,
        row: { proposal_type: "new_app", package_name: "com.discord", play_url: "u", app_id: null, proposed_fields: {}, previous_fields: null },
      }),
    ]);
    assert.equal(summary.enabledCount, 6);
    assert.equal(summary.disabledCount, 1);
    assert.equal(summary.failedFetches, 2);
    assert.equal(summary.storeFailures, 1);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.ineligible, 1);
    assert.equal(summary.newProposals, 1);
    // successfulFetches: store_failed + unchanged + ineligible + new_app = 4
    assert.equal(summary.successfulFetches, 4);
  });
});
