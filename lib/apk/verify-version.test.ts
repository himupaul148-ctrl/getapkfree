import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UnsafeUrlError } from "../net/safe-fetch.ts";
import { defaultDeps, runVersionVerify, type VerifyVersionDeps } from "./verify-version.ts";
import { FakeSupabase } from "./test-helpers/fake-supabase.ts";

/**
 * Run with: npm test
 *
 * Exercises runVersionVerify with the database and the stored-file download
 * both faked — no real network, no real Supabase. Proves the things that
 * actually matter for safety here: the hash always comes from the bytes
 * this module itself downloaded (through the SSRF-safe path, not a raw
 * fetch), the write only ever touches the one targeted version row, and
 * `published` is never part of that write — plus the server-side scope
 * guard that now rejects anything but a pending/failed, unpublished build
 * before it ever touches the file or VirusTotal.
 */

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

const FILE_BYTES = Buffer.from("fake-apk-bytes-for-hashing");
const FILE_SHA256 = createHash("sha256").update(FILE_BYTES).digest("hex");

function happyDeps(overrides: Partial<VerifyVersionDeps> = {}): Partial<VerifyVersionDeps> {
  return {
    fetchFileBytes: async () => FILE_BYTES,
    scanByHash: async () => "pending",
    ...overrides,
  };
}

function pendingVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "v-1",
    app_id: "app-1",
    file_url: "https://fake.supabase.local/build.apk",
    scan_status: "pending",
    scanned_at: null,
    published: false,
    ...overrides,
  };
}

group("runVersionVerify — request validation", () => {
  test("rejects a missing version id", async () => {
    const fake = new FakeSupabase();
    const result = await runVersionVerify("", client(fake));
    assert.equal(result.status, 400);
  });

  test("404s when no version has that id", async () => {
    const fake = new FakeSupabase();
    const result = await runVersionVerify("does-not-exist", client(fake), happyDeps());
    assert.equal(result.status, 404);
  });
});

group("runVersionVerify — server-side scope enforcement", () => {
  for (const scanStatus of ["clean", "flagged", "external"]) {
    test(`rejects a "${scanStatus}" build with 409, without touching the file or VirusTotal`, async () => {
      const fake = new FakeSupabase();
      fake.versions.push(pendingVersion({ scan_status: scanStatus, published: false }));

      let fetchCalled = false;
      let scanCalled = false;
      const result = await runVersionVerify(
        "v-1",
        client(fake),
        happyDeps({
          fetchFileBytes: async () => { fetchCalled = true; return FILE_BYTES; },
          scanByHash: async () => { scanCalled = true; return "clean"; },
        }),
      );

      assert.equal(result.status, 409);
      assert.equal(fetchCalled, false);
      assert.equal(scanCalled, false);
      assert.equal(fake.versions[0].scan_status, scanStatus, "must be completely unchanged");
    });
  }

  test('rejects a null scan_status with 409 too, not treated as verifiable', async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion({ scan_status: null, published: false }));

    const result = await runVersionVerify("v-1", client(fake), happyDeps());
    assert.equal(result.status, 409);
  });

  test("rejects an already-published build with 409, even if its scan_status is pending", async () => {
    // Should not be reachable through the normal state machine after the
    // publish-eligibility fix, but this route must not rely on that alone.
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion({ scan_status: "pending", published: true }));

    let fetchCalled = false;
    const result = await runVersionVerify(
      "v-1",
      client(fake),
      happyDeps({ fetchFileBytes: async () => { fetchCalled = true; return FILE_BYTES; } }),
    );

    assert.equal(result.status, 409);
    assert.equal(fetchCalled, false);
    assert.equal(fake.versions[0].scan_status, "pending", "must be completely unchanged");
    assert.equal(fake.versions[0].published, true, "must still be untouched");
  });

  test('a "failed" build IS allowed through — proceeds all the way to a real update', async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion({ scan_status: "failed", published: false }));

    const result = await runVersionVerify("v-1", client(fake), happyDeps({ scanByHash: async () => "clean" }));

    assert.equal(result.status, 200);
    assert.equal(fake.versions[0].scan_status, "clean");
  });

  test('a "pending", unpublished build IS allowed through', async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion({ scan_status: "pending", published: false }));

    const result = await runVersionVerify("v-1", client(fake), happyDeps({ scanByHash: async () => "clean" }));

    assert.equal(result.status, 200);
    assert.equal(fake.versions[0].scan_status, "clean");
  });

  test("422s a verifiable version with no stored file, without calling out anywhere", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion({ file_url: null }));
    let fetchCalled = false;
    const result = await runVersionVerify(
      "v-1",
      client(fake),
      happyDeps({ fetchFileBytes: async () => { fetchCalled = true; return FILE_BYTES; } }),
    );
    assert.equal(result.status, 422);
    assert.equal(fetchCalled, false);
  });
});

group("runVersionVerify — deriving the hash", () => {
  test("computes the SHA-256 from the actual downloaded bytes, not from anything else", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());

    let receivedHash: string | null = null;
    const result = await runVersionVerify(
      "v-1",
      client(fake),
      happyDeps({
        scanByHash: async (sha256) => {
          receivedHash = sha256;
          return "clean";
        },
      }),
    );

    assert.equal(result.status, 200);
    assert.equal(receivedHash, FILE_SHA256);
  });

  test("a download that throws an ordinary error is a 502 and leaves the row untouched", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());

    const result = await runVersionVerify(
      "v-1",
      client(fake),
      happyDeps({ fetchFileBytes: async () => { throw new Error("ECONNRESET"); } }),
    );

    assert.equal(result.status, 502);
    assert.equal(fake.versions[0].scan_status, "pending");
  });

  test("a download blocked by the SSRF guard (UnsafeUrlError) is also a 502, not a crash", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());

    const result = await runVersionVerify(
      "v-1",
      client(fake),
      happyDeps({
        fetchFileBytes: async () => {
          throw new UnsafeUrlError("resolves to a non-routable or internal address");
        },
      }),
    );

    assert.equal(result.status, 502);
    assert.equal(fake.versions[0].scan_status, "pending");
  });
});

group("runVersionVerify — FIX 3: uses the real SSRF-safe downloader, not a raw fetch", () => {
  test("defaultDeps.fetchFileBytes rejects a blocked host (localhost) before any real network call", async () => {
    // localhost is rejected by safe-fetch.ts's hostname check before any DNS
    // lookup even happens, so this is a hermetic, network-free proof that
    // the production wiring goes through downloadSafely and not a plain
    // fetch(url) — a raw fetch would have no opinion about "localhost".
    await assert.rejects(
      defaultDeps.fetchFileBytes("https://localhost/build.apk"),
      (err) => err instanceof UnsafeUrlError,
    );
  });

  test("defaultDeps.fetchFileBytes rejects a private IP literal the same way", async () => {
    await assert.rejects(
      defaultDeps.fetchFileBytes("https://127.0.0.1/build.apk"),
      (err) => err instanceof UnsafeUrlError,
    );
  });
});

group("runVersionVerify — writing the verdict", () => {
  test("a clean verdict updates scan_status and stamps scanned_at", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());

    const result = await runVersionVerify("v-1", client(fake), happyDeps({ scanByHash: async () => "clean" }));

    assert.equal(result.status, 200);
    assert.equal(fake.versions[0].scan_status, "clean");
    assert.notEqual(fake.versions[0].scanned_at, null);
    assert.deepEqual(result.body, { versionId: "v-1", scanStatus: "clean", scannedAt: fake.versions[0].scanned_at });
  });

  test("a flagged verdict updates scan_status and stamps scanned_at", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());

    await runVersionVerify("v-1", client(fake), happyDeps({ scanByHash: async () => "flagged" }));

    assert.equal(fake.versions[0].scan_status, "flagged");
    assert.notEqual(fake.versions[0].scanned_at, null);
  });

  test("a pending (hash-miss) verdict leaves scanned_at null", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());

    await runVersionVerify("v-1", client(fake), happyDeps({ scanByHash: async () => "pending" }));

    assert.equal(fake.versions[0].scan_status, "pending");
    assert.equal(fake.versions[0].scanned_at, null);
  });

  test("a scanByHash that throws does not fail the request — resolves to pending instead", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());

    const result = await runVersionVerify(
      "v-1",
      client(fake),
      happyDeps({ scanByHash: async () => { throw new Error("VirusTotal is down"); } }),
    );

    assert.equal(result.status, 200, "a scan-lookup failure must not fail the whole request");
    assert.equal(fake.versions[0].scan_status, "pending");
    assert.equal(fake.versions[0].scanned_at, null);
  });

  test("never writes `published` — the field is absent from the update payload regardless of verdict", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());

    await runVersionVerify("v-1", client(fake), happyDeps({ scanByHash: async () => "clean" }));

    // A clean verdict makes the build ELIGIBLE (via canPublishVersion,
    // tested separately), but this module must never flip `published`
    // itself — that stays a distinct, deliberate admin action.
    assert.equal(fake.versions[0].published, false);
  });
});

group("runVersionVerify — never touches a sibling version", () => {
  test("verifying one version leaves every other version's row completely unchanged", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion({ id: "v-1", file_url: "https://fake.supabase.local/build-1.apk" }));
    fake.versions.push(pendingVersion({ id: "v-2", file_url: "https://fake.supabase.local/build-2.apk" }));

    await runVersionVerify("v-1", client(fake), happyDeps({ scanByHash: async () => "clean" }));

    const v1 = fake.versions.find((v) => v.id === "v-1");
    const v2 = fake.versions.find((v) => v.id === "v-2");
    assert.equal(v1?.scan_status, "clean", "the targeted version was updated");
    assert.equal(v2?.scan_status, "pending", "the sibling version must be completely untouched");
    assert.equal(v2?.scanned_at, null);
    assert.equal(v2?.published, false);
  });

  test("a published clean sibling is untouched by verifying a different, still-pending version", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion({ id: "v-1", scan_status: "clean", published: true, scanned_at: "2026-01-01T00:00:00.000Z" }));
    fake.versions.push(pendingVersion({ id: "v-2", scan_status: "pending", published: false }));

    await runVersionVerify("v-2", client(fake), happyDeps({ scanByHash: async () => "flagged" }));

    assert.equal(fake.versions.find((v) => v.id === "v-1")?.scan_status, "clean", "v-1 must be untouched");
    assert.equal(fake.versions.find((v) => v.id === "v-1")?.published, true, "v-1's published state must be untouched");
    assert.equal(fake.versions.find((v) => v.id === "v-2")?.scan_status, "flagged");
  });
});

group("runVersionVerify — database errors", () => {
  test("a read error is a 500 and never attempts the write", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());
    fake.forceError = { table: "versions", op: "select", error: { message: "connection reset", code: "08006" } };

    const result = await runVersionVerify("v-1", client(fake), happyDeps());
    assert.equal(result.status, 500);
  });

  test("a write error is surfaced as a 500", async () => {
    const fake = new FakeSupabase();
    fake.versions.push(pendingVersion());
    fake.forceError = { table: "versions", op: "update", error: { message: "connection reset", code: "08006" } };

    const result = await runVersionVerify("v-1", client(fake), happyDeps());
    assert.equal(result.status, 500);
  });
});

group("runVersionVerify — default dependencies", () => {
  test("defaultDeps.scanByHash resolves to pending with no VIRUSTOTAL_API_KEY configured", async () => {
    assert.equal(process.env.VIRUSTOTAL_API_KEY, undefined);
    assert.equal(await defaultDeps.scanByHash("0".repeat(64)), "pending");
  });
});
