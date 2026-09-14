import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UnsafeUrlError } from "../net/safe-fetch.ts";
import { ApkValidationError } from "./validate.ts";
import type { ApkMetadata } from "./parse.ts";
import { importGithubApkForApp, type GithubApkImportDeps } from "./github-release-import.ts";
import { FakeSupabase } from "./test-helpers/fake-supabase.ts";
import type { GithubFetchFn, GithubFetchResponse } from "../metadata/github-discovery.ts";

/**
 * Run with: npm test — every external boundary faked: no real network/DNS
 * (download is injected), no real ZIP/manifest parsing (validate/parse are
 * injected), a fixture-driven GithubFetchFn (never a real GitHub API call),
 * and an in-memory database/storage (FakeSupabase). This proves the
 * orchestration in lib/apk/github-release-import.ts — which state each
 * scenario resolves to, what does and doesn't get written, and above all
 * the package-name safety gate (Phase 4) — not the already-tested internals
 * of downloadSafely/validateApkFile/parseApkFile/createVersion themselves.
 */

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

function jsonResponse(status: number, body: unknown): GithubFetchResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

type Route = { test: (url: string) => boolean; response: GithubFetchResponse };

/** Exact-match routing (not substring) — "/repos/{ownerRepo}" and "/repos/{ownerRepo}/releases/latest" would otherwise collide under a substring match. */
function fakeFetch(routes: Route[]): GithubFetchFn {
  return async (url: string) => {
    const route = routes.find((r) => r.test(url));
    if (!route) throw new Error(`no fixture route for ${url}`);
    return route.response;
  };
}

function repoExistsRoute(ownerRepo: string, status = 200): Route {
  return { test: (url) => url === `https://api.github.com/repos/${ownerRepo}`, response: jsonResponse(status, {}) };
}

function releasesLatestRoute(ownerRepo: string, response: GithubFetchResponse): Route {
  return { test: (url) => url === `https://api.github.com/repos/${ownerRepo}/releases/latest`, response };
}

const PHOTOK_OWNER_REPO = "leonlatsch/Photok";
const PHOTOK_ASSET_URL = "https://github.com/leonlatsch/Photok/releases/download/3.3.0/photok-3.3.0-foss.apk";

function photokReleaseAsset(overrides: Record<string, unknown> = {}) {
  return {
    name: "photok-3.3.0-foss.apk",
    browser_download_url: PHOTOK_ASSET_URL,
    content_type: "application/vnd.android.package-archive",
    size: 11_595_059,
    ...overrides,
  };
}

/** repo exists + one release with exactly one matching APK asset — the Photok-shaped happy path. */
function happyGithubFetch(ownerRepo = PHOTOK_OWNER_REPO): GithubFetchFn {
  return fakeFetch([
    repoExistsRoute(ownerRepo),
    releasesLatestRoute(ownerRepo, jsonResponse(200, { tag_name: "3.3.0", assets: [photokReleaseAsset()] })),
  ]);
}

const VALID_METADATA: ApkMetadata = {
  packageName: "dev.leonlatsch.photok",
  versionName: "3.3.0",
  versionCode: 42,
  minAndroidVersion: "9.0",
  label: "Photok",
  permissions: ["android.permission.INTERNET"],
  icon: null,
};

function happyDeps(overrides: Partial<GithubApkImportDeps> = {}): Partial<GithubApkImportDeps> {
  return {
    fetchFn: happyGithubFetch(),
    githubHeaders: { "User-Agent": "test" },
    downloadSafely: async () => ({
      path: "/fake/tmp/download.apk",
      size: 1024,
      contentType: "application/vnd.android.package-archive",
      cleanup: async () => {},
    }),
    validateApkFile: async () => ({ entryCount: 3, totalUncompressedSize: 1024, hasAndroidManifest: true }),
    parseApkFile: async () => VALID_METADATA,
    readFile: async () => Buffer.from("apk-bytes"),
    randomUUID: () => "fixed-uuid",
    scanByHash: async () => "pending",
    ...overrides,
  };
}

function seedGithubSource(fake: FakeSupabase, packageName: string, ownerRepo: string) {
  fake.play_import_proposals.push({
    id: `proposal-${packageName}`,
    package_name: packageName,
    proposal_type: "new_app",
    status: "applied",
    applied_at: "2026-09-01T00:00:00Z",
  });
  fake.play_discovery_candidates.push({
    id: `cand-${packageName}`,
    source: "github",
    source_ref: ownerRepo,
    proposal_id: `proposal-${packageName}`,
  });
}

function targetApp(overrides: { id?: string; packageName?: string } = {}) {
  return { id: overrides.id ?? "app-1", packageName: overrides.packageName ?? "dev.leonlatsch.photok" };
}

/* -------------------------------------------------------- eligibility / source */

group("importGithubApkForApp — eligibility and source resolution", () => {
  test("an app that already has a version returns already_has_version and never calls GitHub", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    fake.versions.push({ id: "v-1", app_id: "app-1", version_code: 1 });
    let githubCalled = false;

    const result = await importGithubApkForApp(client(fake), targetApp(), {}, {
      ...happyDeps({
        fetchFn: async (...args) => {
          githubCalled = true;
          return happyGithubFetch()(...args);
        },
      }),
    });

    assert.equal(result.status, "already_has_version");
    assert.equal(githubCalled, false);
  });

  test("no resolvable GitHub source (e.g. Discord) returns no_github_source and never calls GitHub", async () => {
    const fake = new FakeSupabase();
    let githubCalled = false;

    const result = await importGithubApkForApp(
      client(fake),
      targetApp({ packageName: "com.discord" }),
      {},
      happyDeps({
        fetchFn: async (...args) => {
          githubCalled = true;
          return happyGithubFetch()(...args);
        },
      }),
    );

    assert.equal(result.status, "no_github_source");
    assert.equal(githubCalled, false);
  });

  test("a linked repository that no longer exists returns github_repo_not_found", async () => {
    const fake = new FakeSupabase();
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    const fetchFn = fakeFetch([repoExistsRoute(PHOTOK_OWNER_REPO, 404)]);

    const result = await importGithubApkForApp(client(fake), targetApp(), {}, happyDeps({ fetchFn }));

    assert.equal(result.status, "github_repo_not_found");
    if (result.status === "github_repo_not_found") assert.equal(result.ownerRepo, PHOTOK_OWNER_REPO);
  });

  test("a repository with no release at all returns no_release", async () => {
    const fake = new FakeSupabase();
    seedGithubSource(fake, "dev.leonlatsch.photok", "zackria/bit-switch");
    const fetchFn = fakeFetch([
      repoExistsRoute("zackria/bit-switch"),
      releasesLatestRoute("zackria/bit-switch", jsonResponse(404, { message: "Not Found" })),
    ]);

    const result = await importGithubApkForApp(client(fake), targetApp(), {}, happyDeps({ fetchFn }));

    assert.equal(result.status, "no_release");
  });

  test("a release with no APK asset (e.g. Bit Switch's real v1.0 release) returns no_apk_asset and creates nothing", async () => {
    const fake = new FakeSupabase();
    seedGithubSource(fake, "com.binaryboots.bit_switch", "zackria/bit-switch");
    const fetchFn = fakeFetch([
      repoExistsRoute("zackria/bit-switch"),
      releasesLatestRoute("zackria/bit-switch", jsonResponse(200, { tag_name: "v1.0", assets: [] })),
    ]);

    const result = await importGithubApkForApp(
      client(fake),
      targetApp({ packageName: "com.binaryboots.bit_switch" }),
      {},
      happyDeps({ fetchFn }),
    );

    assert.equal(result.status, "no_apk_asset");
    assert.equal(fake.versions.length, 0);
    assert.equal(fake.storageUploads.length, 0);
  });
});

/* ---------------------------------------------------------- multiple assets */

group("importGithubApkForApp — multiple APK assets require explicit selection", () => {
  function multiAssetFetch(): GithubFetchFn {
    return fakeFetch([
      repoExistsRoute(PHOTOK_OWNER_REPO),
      releasesLatestRoute(
        PHOTOK_OWNER_REPO,
        jsonResponse(200, {
          tag_name: "3.3.0",
          assets: [photokReleaseAsset({ name: "app-arm64.apk", browser_download_url: `${PHOTOK_ASSET_URL}-arm64` }),
            photokReleaseAsset({ name: "app-armeabi.apk", browser_download_url: `${PHOTOK_ASSET_URL}-armeabi` })],
        }),
      ),
    ]);
  }

  test("returns multiple_apk_assets with the full candidate list, and never downloads anything", async () => {
    const fake = new FakeSupabase();
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    let downloadCalled = false;

    const result = await importGithubApkForApp(
      client(fake),
      targetApp(),
      {},
      happyDeps({
        fetchFn: multiAssetFetch(),
        downloadSafely: async () => {
          downloadCalled = true;
          throw new Error("must not be called");
        },
      }),
    );

    assert.equal(result.status, "multiple_apk_assets");
    if (result.status === "multiple_apk_assets") assert.equal(result.assets.length, 2);
    assert.equal(downloadCalled, false);
  });

  test("a valid selectedAssetUrl proceeds with exactly that asset", async () => {
    const fake = new FakeSupabase();
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    let downloadedUrl: string | null = null;

    const result = await importGithubApkForApp(
      client(fake),
      targetApp(),
      { selectedAssetUrl: `${PHOTOK_ASSET_URL}-armeabi` },
      happyDeps({
        fetchFn: multiAssetFetch(),
        downloadSafely: async (url) => {
          downloadedUrl = url;
          return { path: "/fake/tmp/download.apk", size: 1024, contentType: null, cleanup: async () => {} };
        },
      }),
    );

    assert.equal(downloadedUrl, `${PHOTOK_ASSET_URL}-armeabi`);
    assert.equal(result.status, "imported_unpublished");
  });

  test("a selectedAssetUrl that is not actually one of the release's own assets is refused, never downloaded", async () => {
    const fake = new FakeSupabase();
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    let downloadCalled = false;

    const result = await importGithubApkForApp(
      client(fake),
      targetApp(),
      { selectedAssetUrl: "https://evil.example/not-a-real-asset.apk" },
      happyDeps({
        fetchFn: multiAssetFetch(),
        downloadSafely: async () => {
          downloadCalled = true;
          throw new Error("must not be called");
        },
      }),
    );

    assert.equal(result.status, "import_failed");
    assert.equal(downloadCalled, false);
  });
});

/* ------------------------------------------------------- the safety gate */

group("importGithubApkForApp — the package-name safety gate (Phase 4)", () => {
  test("a mismatched package name is rejected and creates nothing at all", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "target-app", package_name: "dev.example.target" });
    seedGithubSource(fake, "dev.example.target", "someone/other-repo");
    const fetchFn = fakeFetch([
      repoExistsRoute("someone/other-repo"),
      releasesLatestRoute("someone/other-repo", jsonResponse(200, { tag_name: "1.0", assets: [photokReleaseAsset()] })),
    ]);

    const result = await importGithubApkForApp(
      client(fake),
      targetApp({ id: "target-app", packageName: "dev.example.target" }),
      {},
      happyDeps({
        fetchFn,
        parseApkFile: async () => ({ ...VALID_METADATA, packageName: "com.attacker.other" }),
      }),
    );

    assert.equal(result.status, "package_mismatch");
    if (result.status === "package_mismatch") {
      assert.equal(result.expectedPackageName, "dev.example.target");
      assert.equal(result.actualPackageName, "com.attacker.other");
    }

    assert.equal(fake.apps.length, 1, "no second app was created");
    assert.equal(fake.apps[0].id, "target-app", "the original app is untouched");
    assert.equal(fake.versions.length, 0, "no version created");
    assert.equal(fake.storageUploads.length, 0, "nothing uploaded");
  });

  test("a null packageName from a malformed manifest is also rejected as a mismatch, not treated as a pass", async () => {
    const fake = new FakeSupabase();
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);

    const result = await importGithubApkForApp(
      client(fake),
      targetApp(),
      {},
      happyDeps({ parseApkFile: async () => ({ ...VALID_METADATA, packageName: null }) }),
    );

    assert.equal(result.status, "package_mismatch");
    assert.equal(fake.versions.length, 0);
  });
});

/* --------------------------------------------------------------- happy path */

group("importGithubApkForApp — the happy path (Photok-shaped)", () => {
  test("downloads, validates, parses, confirms the package match, stores, and creates an unpublished version", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok", slug: "photok" });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);

    const result = await importGithubApkForApp(client(fake), targetApp(), {}, happyDeps());

    assert.equal(result.status, "imported_unpublished");
    if (result.status === "imported_unpublished") {
      assert.equal(result.appId, "app-1");
      assert.equal(result.packageName, "dev.leonlatsch.photok");
      assert.equal(result.versionName, "3.3.0");
      assert.equal(result.versionCode, 42);
      assert.equal(result.ownerRepo, PHOTOK_OWNER_REPO);
      assert.equal(result.tagName, "3.3.0");
    }

    assert.equal(fake.apps.length, 1, "no second app created — the existing app is reused by id");
    assert.equal(fake.versions.length, 1);
    const version = fake.versions[0];
    assert.equal(version.app_id, "app-1");
    assert.equal(version.published, false, "must never auto-publish");
    assert.equal(version.version_code, 42);

    assert.equal(fake.storageUploads.length, 1);
    assert.equal(fake.storageUploads[0].path, "builds/fixed-uuid.apk");
    assert.equal(fake.storageRemovedPaths.length, 0, "a successful import leaves the uploaded object alone");
  });

  test("a clean VirusTotal verdict is recorded but the build still stays unpublished", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);

    const result = await importGithubApkForApp(
      client(fake),
      targetApp(),
      {},
      happyDeps({ scanByHash: async () => "clean" }),
    );

    assert.equal(result.status, "imported_unpublished");
    assert.equal(fake.versions[0].scan_status, "clean");
    assert.equal(fake.versions[0].published, false, "a verdict alone must never auto-publish");
  });

  test("the downloaded temp file is always cleaned up", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    let cleanupCalls = 0;

    await importGithubApkForApp(
      client(fake),
      targetApp(),
      {},
      happyDeps({
        downloadSafely: async () => ({
          path: "/fake/tmp/download.apk",
          size: 1024,
          contentType: null,
          cleanup: async () => {
            cleanupCalls++;
          },
        }),
      }),
    );

    assert.equal(cleanupCalls, 1);
  });
});

/* --------------------------------------------------------------- idempotency */

group("importGithubApkForApp — idempotency / duplicate protection (Phase 6)", () => {
  test("a repeated import after the first succeeded is blocked at the eligibility check, not re-downloaded", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    fake.versions.push({ id: "v-existing", app_id: "app-1", version_code: 42 });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    let downloadCalled = false;

    const result = await importGithubApkForApp(
      client(fake),
      targetApp(),
      {},
      happyDeps({
        downloadSafely: async () => {
          downloadCalled = true;
          throw new Error("must not be called");
        },
      }),
    );

    assert.equal(result.status, "already_has_version");
    assert.equal(downloadCalled, false);
    assert.equal(fake.versions.length, 1, "no duplicate version row");
  });

  test("a race lost at the DB's own unique constraint still cleans up storage and reports already_has_version", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    fake.onBeforeInsert = (table, payload) => {
      if (table === "versions" && payload.app_id === "app-1" && payload.version_code === 42) {
        fake.versions.push({ id: "v-race", app_id: "app-1", version_code: 42 });
      }
    };

    const result = await importGithubApkForApp(client(fake), targetApp(), {}, happyDeps());

    assert.equal(result.status, "already_has_version");
    assert.equal(fake.storageUploads.length, 1, "the upload did happen");
    assert.deepEqual(fake.storageRemovedPaths, ["builds/fixed-uuid.apk"], "and must be cleaned up again");
    assert.equal(fake.versions.length, 1, "only the winner's row remains");
  });
});

/* -------------------------------------------------- failures and cleanup */

group("importGithubApkForApp — download/validate/parse failures never reach storage", () => {
  test("an UnsafeUrlError from downloadSafely is reported and nothing is stored", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);

    const result = await importGithubApkForApp(
      client(fake),
      targetApp(),
      {},
      happyDeps({
        downloadSafely: async () => {
          throw new UnsafeUrlError("That host is not reachable from here.");
        },
      }),
    );

    assert.equal(result.status, "import_failed");
    assert.equal(fake.storageUploads.length, 0);
    assert.equal(fake.versions.length, 0);
  });

  test("an ApkValidationError is reported and nothing is stored", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);

    const result = await importGithubApkForApp(
      client(fake),
      targetApp(),
      {},
      happyDeps({
        validateApkFile: async () => {
          throw new ApkValidationError("The archive has no AndroidManifest.xml.");
        },
      }),
    );

    assert.equal(result.status, "import_failed");
    assert.equal(fake.storageUploads.length, 0);
  });

  test("a parse failure is reported and nothing is stored", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);

    const result = await importGithubApkForApp(
      client(fake),
      targetApp(),
      {},
      happyDeps({
        parseApkFile: async () => {
          throw new Error("Could not read that APK.");
        },
      }),
    );

    assert.equal(result.status, "import_failed");
    assert.equal(fake.storageUploads.length, 0);
  });

  test("a storage upload failure never touches the database", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    fake.storageUploadShouldFail = true;

    const result = await importGithubApkForApp(client(fake), targetApp(), {}, happyDeps());

    assert.equal(result.status, "import_failed");
    assert.equal(fake.versions.length, 0);
  });

  test("a non-duplicate createVersion failure cleans up the uploaded storage object", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "dev.leonlatsch.photok" });
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    fake.forceError = { table: "versions", op: "insert", error: { message: "connection reset", code: "08006" } };

    const result = await importGithubApkForApp(client(fake), targetApp(), {}, happyDeps());

    assert.equal(result.status, "import_failed");
    assert.deepEqual(fake.storageRemovedPaths, ["builds/fixed-uuid.apk"]);
  });
});

/* ---------------------------------------------------------- GitHub API errors */

group("importGithubApkForApp — GitHub API errors surface as import_failed, never a crash", () => {
  test("a rate-limited repo-existence check is reported cleanly", async () => {
    const fake = new FakeSupabase();
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    const fetchFn = fakeFetch([
      { test: (url) => url === `https://api.github.com/repos/${PHOTOK_OWNER_REPO}`, response: jsonResponse(403, { message: "API rate limit exceeded" }) },
    ]);

    const result = await importGithubApkForApp(client(fake), targetApp(), {}, happyDeps({ fetchFn }));

    assert.equal(result.status, "import_failed");
    if (result.status === "import_failed") assert.match(result.message, /rate limit/i);
  });

  test("a network error while fetching the release is reported cleanly", async () => {
    const fake = new FakeSupabase();
    seedGithubSource(fake, "dev.leonlatsch.photok", PHOTOK_OWNER_REPO);
    const fetchFn: GithubFetchFn = async (url) => {
      if (url === `https://api.github.com/repos/${PHOTOK_OWNER_REPO}`) return jsonResponse(200, {});
      throw new Error("ECONNRESET");
    };

    const result = await importGithubApkForApp(client(fake), targetApp(), {}, happyDeps({ fetchFn }));

    assert.equal(result.status, "import_failed");
  });
});

/* -------------------------------------------------------------- wiring */

group("importGithubApkForApp — uses the real security modules by default", () => {
  test("defaultDeps wires the actual downloadSafely/validateApkFile/parseApkFile, not a stand-in", async () => {
    const { defaultDeps } = await import("./github-release-import.ts");
    const { downloadSafely: realDownloadSafely } = await import("../net/safe-fetch.ts");
    const { validateApkFile: realValidateApkFile } = await import("./validate.ts");
    const { parseApkFile: realParseApkFile } = await import("./parse.ts");

    assert.equal(defaultDeps.downloadSafely, realDownloadSafely);
    assert.equal(defaultDeps.validateApkFile, realValidateApkFile);
    assert.equal(defaultDeps.parseApkFile, realParseApkFile);
  });
});
