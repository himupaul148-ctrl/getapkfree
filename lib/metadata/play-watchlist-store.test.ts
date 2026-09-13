import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listWatchlistRows,
  markWatchlistChecked,
  markWatchlistFailure,
  markWatchlistSuccess,
} from "./play-watchlist-store.ts";
import { FakeSupabase } from "../apk/test-helpers/fake-supabase.ts";

/**
 * Run with: npm test — FakeSupabase throughout, never a real database
 * connection, network call, or production project. Mirrors
 * lib/metadata/play-proposal-store.test.ts's own pattern.
 */

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

function seedWatchlistRow(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  const row = {
    id: "watch-1",
    package_name: "org.telegram.messenger",
    play_url: "https://play.google.com/store/apps/details?id=org.telegram.messenger",
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

group("listWatchlistRows", () => {
  test("an empty table returns an empty array, not null or an error", async () => {
    const fake = new FakeSupabase();
    const rows = await listWatchlistRows(client(fake));
    assert.deepEqual(rows, []);
  });

  test("returns every row — enabled and disabled alike", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "a", enabled: true });
    seedWatchlistRow(fake, { id: "b", enabled: false });
    const rows = await listWatchlistRows(client(fake));
    assert.deepEqual(
      rows.map((r) => r.id).sort(),
      ["a", "b"],
    );
  });

  test("never reads from apps, versions, or play_import_proposals", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake);
    fake.apps.push({ id: "app-1", package_name: "com.example.app" });
    fake.versions.push({ id: "v-1", app_id: "app-1" });
    fake.play_import_proposals.push({ id: "p-1", package_name: "com.example.app" });

    const rows = await listWatchlistRows(client(fake));
    assert.equal(rows.length, 1);
    // Untouched — still exactly what was seeded, nothing added or removed.
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.versions.length, 1);
    assert.equal(fake.play_import_proposals.length, 1);
  });
});

group("markWatchlistChecked", () => {
  test("sets last_checked_at on the matching row only", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "a" });
    seedWatchlistRow(fake, { id: "b" });

    await markWatchlistChecked(client(fake), "a");

    const a = fake.play_watchlist.find((r) => r.id === "a")!;
    const b = fake.play_watchlist.find((r) => r.id === "b")!;
    assert.ok(typeof a.last_checked_at === "string" && a.last_checked_at.length > 0);
    assert.equal(b.last_checked_at, null);
  });

  test("never touches apps or versions", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "a" });
    fake.apps.push({ id: "app-1", package_name: "com.example.app" });
    await markWatchlistChecked(client(fake), "a");
    assert.deepEqual(fake.apps, [{ id: "app-1", package_name: "com.example.app" }]);
  });
});

group("markWatchlistSuccess", () => {
  test("sets last_success_at and clears any prior failure", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "a", last_failure_at: "2026-01-01T00:00:00.000Z", last_error: "old error" });

    await markWatchlistSuccess(client(fake), "a");

    const a = fake.play_watchlist.find((r) => r.id === "a")!;
    assert.ok(typeof a.last_success_at === "string" && a.last_success_at.length > 0);
    assert.equal(a.last_failure_at, null);
    assert.equal(a.last_error, null);
  });

  test("never touches apps, versions, or storage", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "a" });
    fake.apps.push({ id: "app-1" });
    fake.versions.push({ id: "v-1" });
    await markWatchlistSuccess(client(fake), "a");
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.versions.length, 1);
    assert.deepEqual(fake.storageUploads, []);
  });
});

group("markWatchlistFailure", () => {
  test("sets last_failure_at and last_error", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "a" });
    await markWatchlistFailure(client(fake), "a", "fetch timed out");

    const a = fake.play_watchlist.find((r) => r.id === "a")!;
    assert.ok(typeof a.last_failure_at === "string" && a.last_failure_at.length > 0);
    assert.equal(a.last_error, "fetch timed out");
  });

  test("never erases last_success_at — a failed check must not hide the last time this row actually worked", async () => {
    const fake = new FakeSupabase();
    const successAt = "2026-09-01T00:00:00.000Z";
    seedWatchlistRow(fake, { id: "a", last_success_at: successAt });

    await markWatchlistFailure(client(fake), "a", "network error");

    const a = fake.play_watchlist.find((r) => r.id === "a")!;
    assert.equal(a.last_success_at, successAt);
    assert.ok(typeof a.last_failure_at === "string");
    assert.equal(a.last_error, "network error");
  });

  test("never touches apps or versions", async () => {
    const fake = new FakeSupabase();
    seedWatchlistRow(fake, { id: "a" });
    fake.apps.push({ id: "app-1" });
    await markWatchlistFailure(client(fake), "a", "boom");
    assert.equal(fake.apps.length, 1);
  });
});
