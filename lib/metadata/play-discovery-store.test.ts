import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findDiscoveryCandidate,
  findLatestDiscoveredAt,
  insertDiscoveryCandidate,
  updateDiscoveryCandidate,
} from "./play-discovery-store.ts";
import { FakeSupabase } from "../apk/test-helpers/fake-supabase.ts";

/**
 * Run with: npm test — FakeSupabase throughout, never a real database
 * connection, network call, or production project. Mirrors
 * lib/metadata/play-watchlist-store.test.ts's own pattern.
 */

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

group("findDiscoveryCandidate", () => {
  test("returns null when no row matches (source, source_ref)", async () => {
    const fake = new FakeSupabase();
    const result = await findDiscoveryCandidate(client(fake), "github", "someone/app");
    assert.equal(result, null);
  });

  test("finds the exact (source, source_ref) row, ignoring others", async () => {
    const fake = new FakeSupabase();
    fake.play_discovery_candidates.push({
      id: "a",
      source: "github",
      source_ref: "someone/app",
      candidate_name: "app",
      resolved_play_url: null,
      package_name: null,
      status: "found",
      score: 10,
      proposal_id: null,
      discovered_at: new Date().toISOString(),
      checked_at: null,
    });
    fake.play_discovery_candidates.push({
      id: "b",
      source: "github",
      source_ref: "someone/other",
      candidate_name: "other",
      resolved_play_url: null,
      package_name: null,
      status: "found",
      score: 5,
      proposal_id: null,
      discovered_at: new Date().toISOString(),
      checked_at: null,
    });
    const result = await findDiscoveryCandidate(client(fake), "github", "someone/app");
    assert.equal(result?.id, "a");
  });
});

group("insertDiscoveryCandidate", () => {
  test("inserts with status defaulting to 'found' and all optional fields null", async () => {
    const fake = new FakeSupabase();
    const row = await insertDiscoveryCandidate(client(fake), { source: "github", source_ref: "someone/app" });
    assert.equal(row.status, "found");
    assert.equal(row.resolved_play_url, null);
    assert.equal(row.package_name, null);
    assert.equal(row.proposal_id, null);
    assert.equal(row.checked_at, null);
  });

  test("never accepts a caller-supplied status/resolved_play_url/proposal_id — only source/source_ref/candidate_name/score", async () => {
    const fake = new FakeSupabase();
    const row = await insertDiscoveryCandidate(client(fake), {
      source: "github",
      source_ref: "someone/app",
      candidate_name: "App",
      score: 42,
    });
    assert.equal(row.candidate_name, "App");
    assert.equal(row.score, 42);
    assert.equal(row.status, "found");
  });

  test("never touches apps, versions, or play_import_proposals", async () => {
    const fake = new FakeSupabase();
    await insertDiscoveryCandidate(client(fake), { source: "github", source_ref: "someone/app" });
    assert.equal(fake.apps.length, 0);
    assert.equal(fake.versions.length, 0);
    assert.equal(fake.play_import_proposals.length, 0);
  });
});

group("updateDiscoveryCandidate", () => {
  test("updates only the matching row's fields", async () => {
    const fake = new FakeSupabase();
    const row = await insertDiscoveryCandidate(client(fake), { source: "github", source_ref: "someone/app" });
    await updateDiscoveryCandidate(client(fake), row.id, {
      status: "proposed",
      resolved_play_url: "https://play.google.com/store/apps/details?id=com.example.app",
      package_name: "com.example.app",
      proposal_id: "proposal-1",
      checked_at: "2026-09-15T00:00:00.000Z",
    });
    const updated = await findDiscoveryCandidate(client(fake), "github", "someone/app");
    assert.equal(updated?.status, "proposed");
    assert.equal(updated?.package_name, "com.example.app");
    assert.equal(updated?.proposal_id, "proposal-1");
  });

  test("never touches apps, versions, play_import_proposals, or storage", async () => {
    const fake = new FakeSupabase();
    const row = await insertDiscoveryCandidate(client(fake), { source: "github", source_ref: "someone/app" });
    fake.apps.push({ id: "app-1" });
    await updateDiscoveryCandidate(client(fake), row.id, { status: "disqualified_no_play_link" });
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.versions.length, 0);
    assert.equal(fake.play_import_proposals.length, 0);
    assert.deepEqual(fake.storageUploads, []);
  });
});

group("findLatestDiscoveredAt", () => {
  test("returns null when no row exists for this source yet — the very first run", async () => {
    const fake = new FakeSupabase();
    const result = await findLatestDiscoveredAt(client(fake), "github");
    assert.equal(result, null);
  });

  test("returns the most recent discovered_at among matching-source rows", async () => {
    const fake = new FakeSupabase();
    fake.play_discovery_candidates.push(
      { id: "a", source: "github", source_ref: "x/1", discovered_at: "2026-09-10T00:00:00.000Z" },
      { id: "b", source: "github", source_ref: "x/2", discovered_at: "2026-09-13T00:00:00.000Z" },
      { id: "c", source: "github", source_ref: "x/3", discovered_at: "2026-09-11T00:00:00.000Z" },
    );
    const result = await findLatestDiscoveredAt(client(fake), "github");
    assert.equal(result, "2026-09-13T00:00:00.000Z");
  });

  test("ignores rows from a different source", async () => {
    const fake = new FakeSupabase();
    fake.play_discovery_candidates.push({ id: "a", source: "hn", source_ref: "1234", discovered_at: "2026-09-13T00:00:00.000Z" });
    const result = await findLatestDiscoveredAt(client(fake), "github");
    assert.equal(result, null);
  });
});
