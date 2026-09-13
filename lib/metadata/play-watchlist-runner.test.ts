import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runWatchlistPropose } from "./play-watchlist-runner.ts";
import { FakeSupabase } from "../apk/test-helpers/fake-supabase.ts";
import type { FetchedMetadata } from "./fetchers.ts";

/**
 * Step 2's integration-level tests: the full watchlist -> propose pipeline,
 * run with FakeSupabase and an injected fake fetchMetadata — never a real
 * database connection, never a real network call, never a real Play
 * fetch, and never anything that could download an APK (there is simply no
 * download function anywhere in this call graph for a test to accidentally
 * exercise). Mirrors lib/metadata/play-proposal-store.test.ts's and
 * lib/metadata/play-proposal-approval.test.ts's own FakeSupabase-only
 * pattern.
 */

const TELEGRAM_URL = "https://play.google.com/store/apps/details?id=org.telegram.messenger";
const DISCORD_URL = "https://play.google.com/store/apps/details?id=com.discord";

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

function seedWatchlistRow(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  const row = {
    id: `watch-${fake.play_watchlist.length + 1}`,
    package_name: "org.telegram.messenger",
    play_url: TELEGRAM_URL,
    enabled: true,
    last_checked_at: null,
    last_success_at: null,
    last_failure_at: null,
    last_error: null,
    created_at: new Date().toISOString(),
    added_by: null,
    ...overrides,
  };
  fake.play_watchlist.push(row);
  return row;
}

function seedApp(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  const row = {
    id: "app-1",
    slug: "telegram",
    package_name: "org.telegram.messenger",
    name: "Telegram",
    description: "A messaging app.",
    icon_url: "https://example.com/icon.png",
    developer_name: "Telegram FZ-LLC",
    category: "Internet",
    rating: 4.5,
    rating_count: 17199543,
    manual_fields: [],
    source_type: "external",
    ...overrides,
  };
  fake.apps.push(row);
  return row;
}

function fetched(overrides: Partial<FetchedMetadata> = {}): FetchedMetadata {
  return {
    name: "Telegram",
    packageName: "org.telegram.messenger",
    description: "A messaging app.",
    iconUrl: "https://example.com/icon.png",
    developer: "Telegram FZ-LLC",
    category: "Internet",
    version: null,
    rating: 4.5,
    ratingCount: 17227838,
    screenshots: [],
    source: "play",
    unavailable: [],
    ...overrides,
  };
}

/** Maps a Play URL's ?id= to either a fixture or an Error to throw — never a real network call. */
function fakeFetcher(fixtures: Record<string, FetchedMetadata | Error>) {
  const calls: string[] = [];
  const fn = async (url: string): Promise<FetchedMetadata> => {
    calls.push(url);
    const id = new URL(url).searchParams.get("id") ?? url;
    const fixture = fixtures[id];
    if (fixture === undefined) throw new Error(`no fixture for ${id}`);
    if (fixture instanceof Error) throw fixture;
    return fixture;
  };
  return { fn, calls };
}

function noopSleep() {
  const calls: number[] = [];
  const fn = async (ms: number) => {
    calls.push(ms);
  };
  return { fn, calls };
}

const BASE_DEPS_OVERRIDES = { fetchIntervalMs: 3000 };

group("runWatchlistPropose — selection", () => {
  test("disabled rows are skipped entirely: not fetched, not health-updated, not in the report", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "enabled-1", enabled: true });
    seedWatchlistRow(fake, { id: "disabled-1", enabled: false, play_url: DISCORD_URL, package_name: "com.discord" });

    const { fn: fetchMetadata, calls } = fakeFetcher({ "org.telegram.messenger": fetched() });
    const { fn: sleep } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(report.enabled.length, 1);
    assert.equal(report.disabled.length, 1);
    assert.equal(report.rows.length, 1);
    assert.deepEqual(calls, [TELEGRAM_URL]);

    const disabledRow = fake.play_watchlist.find((r) => r.id === "disabled-1")!;
    assert.equal(disabledRow.last_checked_at, null);
    assert.equal(disabledRow.last_success_at, null);
    assert.equal(disabledRow.last_failure_at, null);
  });

  test("an empty watchlist succeeds cleanly: zero enabled, zero rows, an all-zero summary, no error thrown", async () => {
    const fake = new FakeSupabase();
    const { fn: fetchMetadata, calls } = fakeFetcher({});
    const { fn: sleep } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(report.enabled.length, 0);
    assert.equal(report.disabled.length, 0);
    assert.deepEqual(report.rows, []);
    assert.equal(report.summary.enabledCount, 0);
    assert.equal(report.summary.successfulFetches, 0);
    assert.equal(calls.length, 0);
  });

  test("an all-disabled watchlist behaves like an empty one — nothing fetched", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { enabled: false });
    const { fn: fetchMetadata, calls } = fakeFetcher({});
    const { fn: sleep } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(report.enabled.length, 0);
    assert.equal(report.disabled.length, 1);
    assert.equal(calls.length, 0);
  });
});

group("runWatchlistPropose — URL validation", () => {
  test("a row with an invalid stored URL is marked as a failure, without ever calling fetchMetadata", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "bad-1", play_url: "https://example.com/not-play" });
    const { fn: fetchMetadata, calls } = fakeFetcher({});
    const { fn: sleep } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(calls.length, 0);
    assert.equal(report.rows[0].result.kind, "invalid_url");
    assert.equal(report.summary.failedFetches, 1);

    const row = fake.play_watchlist.find((r) => r.id === "bad-1")!;
    assert.ok(typeof row.last_checked_at === "string");
    assert.ok(typeof row.last_failure_at === "string");
    assert.match(row.last_error as string, /invalid play_url/);
  });
});

group("runWatchlistPropose — health field updates", () => {
  test("a successful fetch sets last_checked_at and last_success_at, and leaves failure fields null", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "ok-1" });
    const { fn: fetchMetadata } = fakeFetcher({ "org.telegram.messenger": fetched() });
    const { fn: sleep } = noopSleep();

    await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    const row = fake.play_watchlist.find((r) => r.id === "ok-1")!;
    assert.ok(typeof row.last_checked_at === "string");
    assert.ok(typeof row.last_success_at === "string");
    assert.equal(row.last_failure_at, null);
    assert.equal(row.last_error, null);
  });

  test("a failed fetch sets last_checked_at and last_failure_at/last_error, and never sets last_success_at", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "fail-1" });
    const { fn: fetchMetadata } = fakeFetcher({
      "org.telegram.messenger": new Error("503 from play.google.com"),
    });
    const { fn: sleep } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    const row = fake.play_watchlist.find((r) => r.id === "fail-1")!;
    assert.ok(typeof row.last_checked_at === "string");
    assert.equal(row.last_success_at, null);
    assert.ok(typeof row.last_failure_at === "string");
    assert.equal(row.last_error, "503 from play.google.com");
    assert.equal(report.rows[0].result.kind, "fetch_failed");
  });

  test("a prior last_success_at is preserved after a later failure — a failed check must not erase it", async () => {
    const fake = new FakeSupabase();
    const priorSuccess = "2026-08-01T00:00:00.000Z";
    seedWatchlistRow(fake, { id: "was-ok", last_success_at: priorSuccess });
    const { fn: fetchMetadata } = fakeFetcher({ "org.telegram.messenger": new Error("timeout") });
    const { fn: sleep } = noopSleep();

    await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    const row = fake.play_watchlist.find((r) => r.id === "was-ok")!;
    assert.equal(row.last_success_at, priorSuccess);
    assert.ok(typeof row.last_failure_at === "string");
  });

  test("a fresh success clears a prior failure's last_error/last_failure_at", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, {
      id: "recovering",
      last_failure_at: "2026-08-01T00:00:00.000Z",
      last_error: "old failure",
    });
    const { fn: fetchMetadata } = fakeFetcher({ "org.telegram.messenger": fetched() });
    const { fn: sleep } = noopSleep();

    await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    const row = fake.play_watchlist.find((r) => r.id === "recovering")!;
    assert.equal(row.last_failure_at, null);
    assert.equal(row.last_error, null);
    assert.ok(typeof row.last_success_at === "string");
  });
});

group("runWatchlistPropose — per-row failure isolation and multiple rows", () => {
  test("one row's fetch failure does not stop the remaining watchlist from being processed", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "fails", package_name: "org.telegram.messenger", play_url: TELEGRAM_URL });
    seedWatchlistRow(fake, { id: "succeeds", package_name: "com.discord", play_url: DISCORD_URL });

    const { fn: fetchMetadata } = fakeFetcher({
      "org.telegram.messenger": new Error("network error"),
      "com.discord": fetched({ name: "Discord", packageName: "com.discord", ratingCount: 7008486 }),
    });
    const { fn: sleep } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(report.rows.length, 2);
    assert.equal(report.rows.find((r) => r.row.id === "fails")!.result.kind, "fetch_failed");
    assert.equal(report.rows.find((r) => r.row.id === "succeeds")!.result.kind, "propose");
    assert.equal(report.summary.failedFetches, 1);
    assert.equal(report.summary.successfulFetches, 1);
  });

  test("multiple enabled rows are all processed, each getting its own health update", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "row-a", package_name: "org.telegram.messenger", play_url: TELEGRAM_URL });
    seedWatchlistRow(fake, { id: "row-b", package_name: "com.discord", play_url: DISCORD_URL });

    const { fn: fetchMetadata } = fakeFetcher({
      "org.telegram.messenger": fetched(),
      "com.discord": fetched({ name: "Discord", packageName: "com.discord", ratingCount: 7008486 }),
    });
    const { fn: sleep, calls: sleepCalls } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(report.rows.length, 2);
    assert.ok(fake.play_watchlist.every((r) => typeof r.last_checked_at === "string"));
    // Paced once between the two real fetches, never after the last row.
    assert.deepEqual(sleepCalls, [3000]);
  });

  test("pacing is skipped after an invalid-URL row, which made no network call", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "bad", play_url: "not a url" });
    seedWatchlistRow(fake, { id: "good", package_name: "com.discord", play_url: DISCORD_URL });

    const { fn: fetchMetadata } = fakeFetcher({
      "com.discord": fetched({ name: "Discord", packageName: "com.discord" }),
    });
    const { fn: sleep, calls: sleepCalls } = noopSleep();

    await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.deepEqual(sleepCalls, []);
  });
});

group("runWatchlistPropose — reuses the existing propose pipeline unchanged", () => {
  test("a new package produces a new_app proposal, and creates NO apps/versions rows", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "discord-row", package_name: "com.discord", play_url: DISCORD_URL });
    const { fn: fetchMetadata } = fakeFetcher({
      "com.discord": fetched({ name: "Discord", packageName: "com.discord", ratingCount: 7008486 }),
    });
    const { fn: sleep } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(report.rows[0].result.kind, "propose");
    const result = report.rows[0].result;
    assert.ok(result.kind === "propose" && result.outcome.status === "new_app");
    assert.equal(fake.apps.length, 0);
    assert.equal(fake.versions.length, 0);
    assert.equal(fake.play_import_proposals.length, 1);
    assert.equal(fake.play_import_proposals[0].status, "pending");
  });

  test("manual_fields is still respected — a manually-overridden field never appears in the proposal", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, { rating: 4.5, manual_fields: ["rating"] });
    seedWatchlistRow(fake, { id: "telegram-row" });
    // Play now reports a different rating AND a different rating_count.
    const { fn: fetchMetadata } = fakeFetcher({
      "org.telegram.messenger": fetched({ rating: 4.9, ratingCount: 17227838 }),
    });
    const { fn: sleep } = noopSleep();

    await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(fake.play_import_proposals.length, 1);
    const proposed = fake.play_import_proposals[0].proposed_fields as Record<string, unknown>;
    assert.ok(!("rating" in proposed), "manually-overridden rating must never appear in proposed_fields");
    assert.equal(proposed.rating_count, 17227838);
  });

  test("an F-Droid-owned app is skipped as ineligible — no proposal is created for it", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, { source_type: "fdroid" });
    seedWatchlistRow(fake, { id: "telegram-row" });
    const { fn: fetchMetadata } = fakeFetcher({ "org.telegram.messenger": fetched() });
    const { fn: sleep } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    const result = report.rows[0].result;
    assert.ok(result.kind === "propose" && result.outcome.status === "ineligible");
    assert.equal(fake.play_import_proposals.length, 0);
    // The F-Droid app row itself is completely untouched.
    assert.equal(fake.apps[0].source_type, "fdroid");
  });

  test("no versions row is ever created, and no storage upload ever happens, across any outcome", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "new-app-row", package_name: "com.discord", play_url: DISCORD_URL });
    seedApp(fake, { id: "app-2", package_name: "org.telegram.messenger" });
    seedWatchlistRow(fake, { id: "update-row", package_name: "org.telegram.messenger", play_url: TELEGRAM_URL });

    const { fn: fetchMetadata } = fakeFetcher({
      "com.discord": fetched({ name: "Discord", packageName: "com.discord" }),
      "org.telegram.messenger": fetched({ ratingCount: 99999999 }),
    });
    const { fn: sleep } = noopSleep();

    await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(fake.versions.length, 0);
    assert.deepEqual(fake.storageUploads, []);
  });

  test("a store-level failure after a successful fetch does not touch last_success_at retroactively", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "row-x" });
    fake.forceError = { table: "play_import_proposals", op: "select", error: { message: "simulated db outage", code: "XXOOO" } };
    const { fn: fetchMetadata } = fakeFetcher({ "org.telegram.messenger": fetched() });
    const { fn: sleep } = noopSleep();

    const report = await runWatchlistPropose({ supabase: client(fake), fetchMetadata, sleep, ...BASE_DEPS_OVERRIDES });

    assert.equal(report.rows[0].result.kind, "store_failed");
    const row = fake.play_watchlist.find((r) => r.id === "row-x")!;
    // The fetch itself worked — last_success_at reflects that, regardless
    // of the later store failure.
    assert.ok(typeof row.last_success_at === "string");
  });
});
