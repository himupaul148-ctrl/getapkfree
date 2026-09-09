import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadSafely as realDownloadSafely, UnsafeUrlError } from "../net/safe-fetch.ts";
import { validateApkFile as realValidateApkFile, ApkValidationError } from "./validate.ts";
import { parseApkFile as realParseApkFile, type ApkMetadata } from "./parse.ts";
import { defaultDeps, runApkUrlImport, type ImportPipelineDeps } from "./import-pipeline.ts";
import { FakeSupabase } from "./test-helpers/fake-supabase.ts";

/**
 * Run with: npm test
 *
 * Exercises the whole DOWNLOAD → VALIDATE → PARSE → STORE → SAVE pipeline
 * with every external boundary faked: no real network/DNS (download is
 * injected), no real ZIP/manifest parsing (validate/parse are injected —
 * both already have their own dedicated suites), and an in-memory database
 * and storage. This is deliberately an orchestration test: it proves the
 * NEW control flow in lib/apk/import-pipeline.ts — status codes, cleanup
 * ordering, what does and doesn't touch the database/storage — not the
 * already-tested internals of any one step.
 */

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

const VALID_METADATA: ApkMetadata = {
  packageName: "com.example.app",
  versionName: "1.2.3",
  versionCode: 42,
  minAndroidVersion: "9.0",
  label: "Example App",
  permissions: ["android.permission.INTERNET"],
  icon: "data:image/png;base64,AAA=",
};

/** A working, do-nothing-real download+validate+parse trio, ready to be overridden per test. */
function happyDeps(overrides: Partial<ImportPipelineDeps> = {}): Partial<ImportPipelineDeps> {
  return {
    downloadSafely: async () => ({
      path: "/fake/tmp/download.bin",
      size: 1024,
      contentType: "application/vnd.android.package-archive",
      cleanup: async () => {},
    }),
    validateApkFile: async () => ({ entryCount: 3, totalUncompressedSize: 1024, hasAndroidManifest: true }),
    parseApkFile: async () => VALID_METADATA,
    readFile: async () => Buffer.from("apk-bytes"),
    randomUUID: () => "fixed-uuid",
    // A no-op stand-in for the real VirusTotal lookup — every test below
    // that doesn't care about scan status gets the same "no verdict
    // obtained" result the real lookup would give for an unknown hash,
    // without making a network call.
    scanByHash: async () => "pending",
    ...overrides,
  };
}

/** SHA-256 of the exact bytes happyDeps()'s readFile returns, for asserting the pipeline hashes the real downloaded bytes rather than anything else. */
const APK_BYTES_SHA256 = createHash("sha256").update(Buffer.from("apk-bytes")).digest("hex");

group("runApkUrlImport — request validation", () => {
  test("rejects a missing URL", async () => {
    const fake = new FakeSupabase();
    const result = await runApkUrlImport(undefined, client(fake));
    assert.equal(result.status, 400);
  });

  test("rejects a non-string URL", async () => {
    const fake = new FakeSupabase();
    const result = await runApkUrlImport({ not: "a string" }, client(fake));
    assert.equal(result.status, 400);
  });

  test("rejects an empty string URL", async () => {
    const fake = new FakeSupabase();
    const result = await runApkUrlImport("   ", client(fake));
    assert.equal(result.status, 400);
  });

  test("rejects a malformed URL", async () => {
    const fake = new FakeSupabase();
    const result = await runApkUrlImport("not a url at all", client(fake));
    assert.equal(result.status, 400);
  });

  test("never reaches downloadSafely for a request-validation failure", async () => {
    const fake = new FakeSupabase();
    let called = false;
    await runApkUrlImport(undefined, client(fake), {
      downloadSafely: async () => {
        called = true;
        throw new Error("should not be called");
      },
    });
    assert.equal(called, false);
  });
});

group("runApkUrlImport — download and SSRF errors surface as 400", () => {
  test("an UnsafeUrlError from downloadSafely (http, private IP, oversized, etc.) is a 400", async () => {
    const fake = new FakeSupabase();
    const result = await runApkUrlImport("https://blocked.example/app.apk", client(fake), {
      downloadSafely: async () => {
        throw new UnsafeUrlError("That host is not reachable from here.");
      },
    });
    assert.equal(result.status, 400);
    assert.match(String(result.body.error), /not reachable/);
  });

  test("an ordinary network failure is a 502, not a 400", async () => {
    const fake = new FakeSupabase();
    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), {
      downloadSafely: async () => {
        throw new Error("ECONNRESET");
      },
    });
    assert.equal(result.status, 502);
  });

  test("a download failure with no result at all does not crash the cleanup path", async () => {
    // downloadSafely owns its own temp file on failure; the pipeline has
    // nothing to clean up in this case (there is no SafeDownloadResult),
    // and the `finally { await download?.cleanup() }` guard must not throw
    // trying to.
    const fake = new FakeSupabase();
    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), {
      downloadSafely: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(result.status, 502);
  });
});

group("runApkUrlImport — validation and parsing failures", () => {
  test("an ApkValidationError is a 422 and never reaches Storage", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({
      validateApkFile: async () => {
        throw new ApkValidationError("That file does not start with a ZIP/APK signature.");
      },
    });
    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 422);
    assert.equal(fake.storageUploads.length, 0, "an invalid file must never be uploaded");
    assert.equal(fake.apps.length, 0);
  });

  test("a parse failure is a 422 and never reaches Storage", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({
      parseApkFile: async () => {
        throw new Error("Could not read that APK.");
      },
    });
    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 422);
    assert.equal(fake.storageUploads.length, 0);
  });

  test("a missing package name is rejected before Storage", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({
      parseApkFile: async () => ({ ...VALID_METADATA, packageName: null }),
    });
    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 422);
    assert.equal(fake.storageUploads.length, 0);
  });

  test("a missing/zero version code is rejected before Storage", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({
      parseApkFile: async () => ({ ...VALID_METADATA, versionCode: 0 }),
    });
    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 422);
    assert.equal(fake.storageUploads.length, 0);
  });

  test("a missing versionName falls back to the version code rather than failing", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({
      parseApkFile: async () => ({ ...VALID_METADATA, versionName: null }),
    });
    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 200);
    assert.equal((result.body.version as { versionName: string }).versionName, "42");
  });
});

group("runApkUrlImport — the happy path", () => {
  test("downloads, validates, parses, stores, and creates an unpublished, pending-scan version for a new app", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps();

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);

    assert.equal(fake.apps.length, 1);
    assert.equal(fake.apps[0].package_name, "com.example.app");
    assert.equal(fake.apps[0].name, "Example App");
    // Never external-shaped:
    assert.equal("source_type" in fake.apps[0], false);
    assert.equal("external_url" in fake.apps[0], false);

    assert.equal(fake.versions.length, 1);
    const version = fake.versions[0];
    assert.equal(version.published, false, "must never be published automatically");
    assert.equal(version.scan_status, "pending", "must never invent a clean scan result");
    assert.equal(version.scanned_at, null);
    assert.equal(version.version_code, 42);
    assert.equal(version.min_android_version, "9.0");
    assert.deepEqual(version.permissions, ["android.permission.INTERNET"]);

    assert.equal(fake.storageUploads.length, 1);
    assert.equal(fake.storageUploads[0].path, "builds/fixed-uuid.apk");
    // A successful import must leave the uploaded object alone — it's now
    // referenced by the version row, not an orphan to be swept up.
    assert.equal(fake.storageRemovedPaths.length, 0);
    // The public download URL must be our own Storage object, never the
    // remote URL the admin supplied.
    assert.match(String(version.file_url), /^https:\/\/fake\.supabase\.local\//);

    const body = result.body as {
      app: { created: boolean };
      version: { scanStatus: string; published: boolean; minAndroidVersion: string | null; permissionsCount: number };
    };
    assert.equal(body.app.created, true);
    assert.equal(body.version.scanStatus, "pending");
    assert.equal(body.version.published, false);
    assert.equal(body.version.minAndroidVersion, "9.0");
    assert.equal(body.version.permissionsCount, 1);
  });

  test("requests an .apk-suffixed temp file from downloadSafely (regression: production shipped with a .bin default)", async () => {
    // The production failure this guards against: safe-fetch.ts's own
    // default temp file name ("download.bin") is fine for a
    // content-agnostic downloader, but app-info-parser infers APK-vs-IPA
    // purely from the filename extension. If this call site ever stops
    // passing tempFileName explicitly, every real import silently breaks
    // at the parse step while every mocked test here keeps passing.
    const fake = new FakeSupabase();
    let receivedOptions: { tempFileName?: string } | undefined;
    const deps = happyDeps({
      downloadSafely: async (_url, options) => {
        receivedOptions = options;
        return {
          path: "/fake/tmp/download.apk",
          size: 1024,
          contentType: "application/vnd.android.package-archive",
          cleanup: async () => {},
        };
      },
    });

    await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(receivedOptions?.tempFileName, "download.apk");
  });

  test("reuses an existing app by package_name and adds a new version, without touching its metadata", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({
      id: "app-1",
      slug: "example-app",
      package_name: "com.example.app",
      name: "Original Name",
      category: "guides",
      description: "hand-written description",
      developer_name: "Original Dev",
    });
    const deps = happyDeps();

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 200);
    assert.equal(fake.apps.length, 1, "no duplicate app row");
    // Existing hand-edited metadata must survive an import untouched — the
    // import route has no admin-supplied values to write here.
    assert.equal(fake.apps[0].name, "Original Name");
    assert.equal(fake.apps[0].category, "guides");
    assert.equal(fake.apps[0].description, "hand-written description");
    assert.equal(fake.apps[0].developer_name, "Original Dev");

    assert.equal(fake.versions.length, 1);
    assert.equal(fake.versions[0].app_id, "app-1");

    const body = result.body as { app: { created: boolean } };
    assert.equal(body.app.created, false);
  });

  test("the temp file is always cleaned up on success", async () => {
    const fake = new FakeSupabase();
    let cleanupCalls = 0;
    const deps = happyDeps({
      downloadSafely: async () => ({
        path: "/fake/tmp/download.bin",
        size: 1024,
        contentType: null,
        cleanup: async () => {
          cleanupCalls++;
        },
      }),
    });

    await runApkUrlImport("https://example.com/app.apk", client(fake), deps);
    assert.equal(cleanupCalls, 1);
  });
});

group("runApkUrlImport — duplicate handling", () => {
  test("an existing package + version pair is rejected before Storage, with no orphan object", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", slug: "example-app", package_name: "com.example.app" });
    fake.versions.push({ id: "v-1", app_id: "app-1", version_code: 42 });
    const deps = happyDeps();

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 409);
    assert.equal(fake.storageUploads.length, 0);
    assert.equal(fake.storageRemovedPaths.length, 0);
    assert.equal(fake.versions.length, 1, "no second version row");
  });

  test("a race lost at the DB constraint (missed by the pre-check) still cleans up Storage", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", slug: "example-app", package_name: "com.example.app" });
    // Simulate another request's version landing between this request's
    // pre-check and its own insert.
    fake.onBeforeInsert = (table, payload) => {
      if (table === "versions" && payload.app_id === "app-1" && payload.version_code === 42) {
        fake.versions.push({ id: "v-race", app_id: "app-1", version_code: 42 });
      }
    };
    const deps = happyDeps();

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 409);
    assert.equal(fake.storageUploads.length, 1, "the upload did happen");
    assert.deepEqual(fake.storageRemovedPaths, ["builds/fixed-uuid.apk"], "and must be removed again");
    assert.equal(fake.versions.length, 1, "only the winner's version row remains");
  });
});

group("runApkUrlImport — failure cleanup after Storage upload", () => {
  test("findOrCreateApp failing removes the just-uploaded Storage object", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps();
    // The app-creation lookup itself fails with something that is not a
    // recoverable unique-violation shape — a plain connection error.
    fake.forceError = { table: "apps", op: "select", error: { message: "connection reset", code: "08006" } };

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 500);
    assert.equal(fake.storageUploads.length, 1, "the upload did happen");
    assert.deepEqual(fake.storageRemovedPaths, ["builds/fixed-uuid.apk"]);
    assert.equal(fake.apps.length, 0, "no partial app row left behind");
  });

  test("createVersion failing (a non-duplicate DB error) removes Storage AND the app this request just created", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps();
    fake.forceError = { table: "versions", op: "insert", error: { message: "connection reset", code: "08006" } };

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 500);
    assert.deepEqual(fake.storageRemovedPaths, ["builds/fixed-uuid.apk"]);
    assert.equal(fake.apps.length, 0, "the app this request created must be rolled back");
  });

  test("createVersion failing for an EXISTING app never deletes that app", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", slug: "example-app", package_name: "com.example.app", name: "Existing" });
    const deps = happyDeps();
    fake.forceError = { table: "versions", op: "insert", error: { message: "connection reset", code: "08006" } };

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 500);
    assert.equal(fake.apps.length, 1, "the pre-existing app must survive a failed version import");
    assert.equal(fake.apps[0].id, "app-1");
  });

  test("a storage upload failure never touches the database", async () => {
    const fake = new FakeSupabase();
    fake.storageUploadShouldFail = true;
    const deps = happyDeps();

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 502);
    assert.equal(fake.apps.length, 0);
    assert.equal(fake.versions.length, 0);
    assert.equal(fake.storageRemovedPaths.length, 0, "nothing was uploaded, so nothing needs removing");
  });
});

group("runApkUrlImport — uses the real security modules by default", () => {
  test("the default dependencies are the actual safe-fetch/validate/parse implementations", () => {
    // An identity check, not a behavior re-test: proves this pipeline is
    // wired to lib/net/safe-fetch.ts's downloadSafely (not global fetch)
    // and to the real validate/parse modules, unless a caller explicitly
    // overrides them (as every test above does deliberately).
    assert.equal(defaultDeps.downloadSafely, realDownloadSafely);
    assert.equal(defaultDeps.validateApkFile, realValidateApkFile);
    assert.equal(defaultDeps.parseApkFile, realParseApkFile);
  });
});

group("runApkUrlImport — VirusTotal hash-lookup integration", () => {
  test("hashes the actual downloaded bytes, not anything else", async () => {
    const fake = new FakeSupabase();
    let receivedHash: string | null = null;
    const deps = happyDeps({
      scanByHash: async (sha256) => {
        receivedHash = sha256;
        return "pending";
      },
    });

    await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(receivedHash, APK_BYTES_SHA256);
  });

  test("a clean verdict is recorded, but the build is still not published automatically", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({ scanByHash: async () => "clean" });

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 200);
    const version = fake.versions[0];
    assert.equal(version.scan_status, "clean");
    assert.notEqual(version.scanned_at, null, "a real verdict must stamp the scan date");
    assert.equal(
      version.published,
      false,
      "a hash-lookup verdict alone must never auto-publish — publishing stays a separate admin action",
    );

    const body = result.body as { version: { scanStatus: string; published: boolean } };
    assert.equal(body.version.scanStatus, "clean");
    assert.equal(body.version.published, false);
  });

  test("a flagged verdict is recorded and the build is not published", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({ scanByHash: async () => "flagged" });

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 200);
    const version = fake.versions[0];
    assert.equal(version.scan_status, "flagged");
    assert.notEqual(version.scanned_at, null);
    assert.equal(version.published, false);
  });

  test("a hash miss (pending) leaves scanned_at null", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({ scanByHash: async () => "pending" });

    await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    const version = fake.versions[0];
    assert.equal(version.scan_status, "pending");
    assert.equal(version.scanned_at, null);
  });

  test("a VirusTotal lookup that throws does not fail the import — the build still saves, as pending", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({
      scanByHash: async () => {
        throw new Error("VirusTotal is unreachable");
      },
    });

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 200, "the import itself must still succeed");
    assert.equal(fake.versions.length, 1);
    assert.equal(fake.versions[0].scan_status, "pending");
    assert.equal(fake.versions[0].scanned_at, null);
    assert.equal(fake.versions[0].published, false);
  });

  test("a VirusTotal lookup that rejects with a non-Error value still does not fail the import", async () => {
    const fake = new FakeSupabase();
    const deps = happyDeps({
      scanByHash: async () => {
        throw "not an Error instance";
      },
    });

    const result = await runApkUrlImport("https://example.com/app.apk", client(fake), deps);

    assert.equal(result.status, 200);
    assert.equal(fake.versions[0].scan_status, "pending");
  });

  test("defaultDeps.scanByHash resolves to pending with no VIRUSTOTAL_API_KEY configured (the test environment's actual state)", async () => {
    // `npm test` runs `node --test` directly, with no --env-file, so
    // VIRUSTOTAL_API_KEY is genuinely unset here — this exercises the real
    // defaultScanByHash wiring end to end (via the shared module) rather
    // than an injected fake, and proves it degrades safely with no key.
    assert.equal(process.env.VIRUSTOTAL_API_KEY, undefined);
    const result = await defaultDeps.scanByHash("0".repeat(64));
    assert.equal(result, "pending");
  });
});
