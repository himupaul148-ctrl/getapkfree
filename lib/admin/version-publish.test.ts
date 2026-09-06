import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canPublishVersion,
  setVersionPublished,
  sortVersionsByCodeDesc,
  type ManagedVersion,
} from "./version-publish.ts";
import { FakeSupabase } from "../apk/test-helpers/fake-supabase.ts";

/**
 * Run with: npm test
 *
 * Regression coverage for the app-wide-publish bug: AppsManager used to run
 * `.update({published}).eq("app_id", app.id)`, flipping every version of an
 * app at once. These tests exercise the replacement against the same
 * in-memory Supabase fake used by the APK-import pipeline tests, proving the
 * update is scoped to exactly one version id and nothing else.
 */

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

function version(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "v-1",
    app_id: "app-1",
    version_code: 1,
    version_name: "1.0",
    published: false,
    scan_status: "pending",
    ...overrides,
  };
}

group("canPublishVersion", () => {
  test("allows a clean (scanned) build", () => {
    assert.equal(canPublishVersion("clean"), true);
  });

  test("allows an external listing", () => {
    assert.equal(canPublishVersion("external"), true);
  });

  test("blocks a pending build", () => {
    assert.equal(canPublishVersion("pending"), false);
  });

  test("blocks a flagged build", () => {
    assert.equal(canPublishVersion("flagged"), false);
  });

  test("blocks a failed build", () => {
    assert.equal(canPublishVersion("failed"), false);
  });

  test("blocks an unrecognized/null status rather than defaulting to allowed", () => {
    assert.equal(canPublishVersion(null), false);
    assert.equal(canPublishVersion("something-unexpected"), false);
  });
});

group("sortVersionsByCodeDesc", () => {
  test("orders newest (highest version_code) first", () => {
    const versions: ManagedVersion[] = [
      { id: "a", versionName: "1.0", versionCode: 10, published: true, scanStatus: "clean", scannedAt: null, minAndroidVersion: null, uploadedAt: "", fileSize: null },
      { id: "b", versionName: "2.0", versionCode: 20, published: false, scanStatus: "pending", scannedAt: null, minAndroidVersion: null, uploadedAt: "", fileSize: null },
      { id: "c", versionName: "1.5", versionCode: 15, published: true, scanStatus: "clean", scannedAt: null, minAndroidVersion: null, uploadedAt: "", fileSize: null },
    ];

    const sorted = sortVersionsByCodeDesc(versions);
    assert.deepEqual(sorted.map((v) => v.versionCode), [20, 15, 10]);
  });

  test("does not mutate the input array", () => {
    const versions: ManagedVersion[] = [
      { id: "a", versionName: "1.0", versionCode: 1, published: true, scanStatus: "clean", scannedAt: null, minAndroidVersion: null, uploadedAt: "", fileSize: null },
      { id: "b", versionName: "2.0", versionCode: 2, published: false, scanStatus: "pending", scannedAt: null, minAndroidVersion: null, uploadedAt: "", fileSize: null },
    ];
    const original = [...versions];
    sortVersionsByCodeDesc(versions);
    assert.deepEqual(versions, original);
  });
});

group("setVersionPublished", () => {
  test("publishing one version updates only that version id", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(version({ id: "v-1", version_code: 1, published: false, scan_status: "clean" }));
    fake.versions.push(version({ id: "v-2", version_code: 2, published: false, scan_status: "pending" }));

    await setVersionPublished(client(fake), "v-1", true);

    assert.equal(fake.versions.find((v) => v.id === "v-1")?.published, true);
    assert.equal(fake.versions.find((v) => v.id === "v-2")?.published, false);
  });

  test("unpublishing one version updates only that version id", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(version({ id: "v-1", version_code: 1, published: true, scan_status: "clean" }));
    fake.versions.push(version({ id: "v-2", version_code: 2, published: true, scan_status: "clean" }));

    await setVersionPublished(client(fake), "v-1", false);

    assert.equal(fake.versions.find((v) => v.id === "v-1")?.published, false);
    assert.equal(
      fake.versions.find((v) => v.id === "v-2")?.published,
      true,
      "a sibling version's published state must never change",
    );
  });

  test("the exact scenario from the audit: publishing/unpublishing V1 never touches V2", async () => {
    const fake = new FakeSupabase();
    // V1 published/clean, V2 pending/unpublished — the audit's exact example.
    fake.versions.push(
      version({ id: "v1", app_id: "app-1", version_code: 1, published: true, scan_status: "clean" }),
    );
    fake.versions.push(
      version({ id: "v2", app_id: "app-1", version_code: 2, published: false, scan_status: "pending" }),
    );

    await setVersionPublished(client(fake), "v1", false); // unpublish V1

    assert.equal(fake.versions.find((v) => v.id === "v1")?.published, false);
    assert.equal(
      fake.versions.find((v) => v.id === "v2")?.published,
      false,
      "V2 must remain exactly as it was — never flipped by a change to V1",
    );
  });

  test("throws (rather than silently succeeding) on a database error", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(version({ id: "v-1" }));
    fake.forceError = { table: "versions", op: "update", error: { message: "connection reset", code: "08006" } };

    await assert.rejects(setVersionPublished(client(fake), "v-1", true));
  });
});
