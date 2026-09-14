/**
 * GitHub Release APK enrichment — the missing link identified by the
 * read-only discovery-pipeline audit this implements: an approved
 * Play-discovered app (zero versions by design — see
 * lib/metadata/play-apply.ts's own doc comment) whose approval traces back
 * to a GitHub repository (lib/apk/app-github-source.ts) can have its
 * latest GitHub Release's APK asset imported as a real, unpublished build,
 * using the EXACT SAME download/validate/parse/save primitives
 * lib/apk/import-pipeline.ts already uses for an admin-supplied URL.
 *
 * This is deliberately NOT a call into runApkUrlImport()/that route: this
 * flow's target app already exists and is already known by id — reusing
 * runApkUrlImport() would mean re-deriving the app via findOrCreateApp()'s
 * find-by-package_name lookup, which is the wrong tool here and is exactly
 * the shape of mistake Phase 4 of the implementation spec warns about. The
 * building blocks below (downloadSafely, validateApkFile, parseApkFile,
 * createVersion, the VirusTotal hash lookup, the Storage upload) are the
 * same, unmodified functions runApkUrlImport() itself calls — nothing here
 * re-implements a download, a ZIP walk, a manifest parse, a hash lookup, or
 * a version insert.
 *
 * The one new safety gate this module adds, ahead of any write:
 *   parsed manifest packageName MUST equal the target app's own package_name.
 * A mismatch aborts before anything is uploaded or created — see
 * importGithubApkForApp()'s step 8 below.
 *
 * The created version is ALWAYS `published: false`. This module never
 * calls setVersionPublished() — publishing stays a separate, deliberate
 * admin action through the existing publish gate
 * (lib/admin/version-publish.ts), unchanged.
 */
import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";
import { readFile as fsReadFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchLatestReleaseAssets,
  findApkAssets,
  type DiscoveryError,
  type GithubFetchFn,
  type GithubFetchResponse,
  type GithubReleaseAsset,
} from "../metadata/github-discovery.ts";
import { resolveAppGithubSource } from "./app-github-source.ts";
import {
  downloadSafely as downloadSafelyImpl,
  UnsafeUrlError,
  type SafeDownloadOptions,
  type SafeDownloadResult,
} from "../net/safe-fetch.ts";
import { validateApkFile as validateApkFileImpl, ApkValidationError } from "./validate.ts";
import { parseApkFile as parseApkFileImpl, type ApkMetadata } from "./parse.ts";
import { DuplicateVersionError, createVersion } from "./save-build.ts";
import { createVirusTotalScanner, type ScanVerdict } from "./virustotal.ts";

const APK_CONTENT_TYPE = "application/vnd.android.package-archive";
const APK_TEMP_FILE_NAME = "download.apk";

export type TargetApp = { id: string; packageName: string };

export type AssetSummary = { name: string; browserDownloadUrl: string; size: number };

export type GithubApkImportResult =
  | { status: "no_github_source" }
  | { status: "github_repo_not_found"; ownerRepo: string }
  | { status: "no_release"; ownerRepo: string }
  | { status: "no_apk_asset"; ownerRepo: string; tagName: string }
  | { status: "multiple_apk_assets"; ownerRepo: string; tagName: string; assets: AssetSummary[] }
  | {
      status: "package_mismatch";
      ownerRepo: string;
      tagName: string;
      expectedPackageName: string;
      actualPackageName: string | null;
    }
  | { status: "already_has_version"; ownerRepo: string | null }
  | {
      status: "imported_unpublished";
      ownerRepo: string;
      tagName: string;
      appId: string;
      versionId: string;
      packageName: string;
      versionName: string;
      versionCode: number;
      scanStatus: ScanVerdict;
    }
  | { status: "import_failed"; message: string };

export type GithubApkImportDeps = {
  fetchFn: GithubFetchFn;
  /** Overrides the default env-derived headers (see resolveGithubHeaders). Tests pass their own; production leaves this unset. */
  githubHeaders?: Record<string, string>;
  downloadSafely: (url: string, options?: SafeDownloadOptions) => Promise<SafeDownloadResult>;
  validateApkFile: (path: string, size: number) => Promise<unknown>;
  parseApkFile: (path: string) => Promise<ApkMetadata>;
  readFile: (path: string) => Promise<Buffer>;
  randomUUID: () => string;
  scanByHash: (sha256: string) => Promise<ScanVerdict>;
};

async function defaultScanByHash(sha256: string): Promise<ScanVerdict> {
  const scanner = createVirusTotalScanner({ apiKey: process.env.VIRUSTOTAL_API_KEY });
  return scanner.scanByHash(sha256);
}

export const defaultDeps: GithubApkImportDeps = {
  fetchFn: fetch,
  downloadSafely: downloadSafelyImpl,
  validateApkFile: validateApkFileImpl,
  parseApkFile: parseApkFileImpl,
  readFile: fsReadFile,
  randomUUID: nodeRandomUUID,
  scanByHash: defaultScanByHash,
};

/** Read at call time (never cached at module load) so a test can set GITHUB_TOKEN per-case; production reads whatever is actually configured. */
function resolveGithubHeaders(deps: GithubApkImportDeps): Record<string, string> {
  if (deps.githubHeaders) return deps.githubHeaders;
  const token = process.env.GITHUB_TOKEN;
  return {
    "User-Agent": "GetApkFree-Enrichment/1.0",
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function describeDiscoveryError(error: DiscoveryError): string {
  switch (error.kind) {
    case "rate_limited":
      return "GitHub API rate limit exceeded. Try again later.";
    case "http_error":
      return `GitHub API returned an error (${error.status}).`;
    case "malformed_response":
      return "GitHub API returned an unexpected response.";
    case "network_error":
      return "Could not reach the GitHub API.";
  }
}

/**
 * GET /repos/{owner}/{repo} — used only to tell "this repository does not
 * exist (or is inaccessible)" apart from "it exists but has no release",
 * which /releases/latest's own 404 cannot distinguish on its own.
 */
async function checkRepoExists(
  fetchFn: GithubFetchFn,
  ownerRepo: string,
  headers: Record<string, string>,
): Promise<{ exists: boolean } | { error: DiscoveryError }> {
  let response: GithubFetchResponse;
  try {
    response = await fetchFn(`https://api.github.com/repos/${ownerRepo}`, { headers });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { error: { kind: "network_error", message } };
  }
  if (response.status === 404) return { exists: false };
  if (response.status === 403 || response.status === 429) {
    return { error: { kind: "rate_limited", message: "GitHub API rate limit exceeded." } };
  }
  if (!response.ok) {
    return { error: { kind: "http_error", status: response.status, message: `GitHub API returned ${response.status}.` } };
  }
  return { exists: true };
}

async function cleanupStorage(supabase: SupabaseClient, path: string | null) {
  if (!path) return;
  const { error } = await supabase.storage.from("apks").remove([path]);
  if (error) {
    console.error("[github-release-import] failed to remove orphaned storage object:", path, error);
  }
}

/** Does the target app already have ANY version? This flow only ever applies to a zero-version app — see AGENTS' Phase 7 UI gating and Phase 6 idempotency. */
async function appAlreadyHasVersion(supabase: SupabaseClient, appId: string): Promise<boolean> {
  const { data, error } = await supabase.from("versions").select("id").eq("app_id", appId);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Runs the whole GitHub-release-enrichment flow for one already-approved
 * app. `options.selectedAssetUrl` lets a caller resolve a
 * `multiple_apk_assets` result by naming exactly one of the assets that
 * result listed — the URL is always re-validated against the release's own
 * asset list, never trusted as an arbitrary download target, so this can
 * never be used to smuggle in a URL that isn't actually part of this
 * repository's own latest release.
 */
export async function importGithubApkForApp(
  supabase: SupabaseClient,
  targetApp: TargetApp,
  options: { selectedAssetUrl?: string } = {},
  overrides: Partial<GithubApkImportDeps> = {},
): Promise<GithubApkImportResult> {
  const deps: GithubApkImportDeps = { ...defaultDeps, ...overrides };
  const headers = resolveGithubHeaders(deps);

  // ---- 0. eligibility / idempotency: this flow only ever targets a
  // zero-version app. Once an import succeeds the app has one, so a
  // repeated call (a double click, a retried request) stops here rather
  // than attempting a second download. ----
  try {
    if (await appAlreadyHasVersion(supabase, targetApp.id)) {
      return { status: "already_has_version", ownerRepo: null };
    }
  } catch {
    return { status: "import_failed", message: "Could not check this app's existing versions." };
  }

  // ---- 1. resolve the GitHub source this approval traces back to ----
  let ownerRepo: string | null;
  try {
    ownerRepo = await resolveAppGithubSource(supabase, targetApp.packageName);
  } catch {
    return { status: "import_failed", message: "Could not resolve this app's GitHub source." };
  }
  if (!ownerRepo) {
    return { status: "no_github_source" };
  }

  // ---- 2. confirm the repository itself is real and reachable ----
  const repoCheck = await checkRepoExists(deps.fetchFn, ownerRepo, headers);
  if ("error" in repoCheck) {
    return { status: "import_failed", message: describeDiscoveryError(repoCheck.error) };
  }
  if (!repoCheck.exists) {
    return { status: "github_repo_not_found", ownerRepo };
  }

  // ---- 3. fetch its latest release and identify APK asset(s) ----
  const releaseResult = await fetchLatestReleaseAssets(deps.fetchFn, ownerRepo, headers);
  if (!releaseResult.ok) {
    return { status: "import_failed", message: describeDiscoveryError(releaseResult.error) };
  }
  const release = releaseResult.value;
  if (!release) {
    return { status: "no_release", ownerRepo };
  }

  const apkAssets = findApkAssets(release.assets);
  if (apkAssets.length === 0) {
    return { status: "no_apk_asset", ownerRepo, tagName: release.tagName };
  }

  let asset: GithubReleaseAsset;
  if (apkAssets.length === 1) {
    asset = apkAssets[0];
  } else if (options.selectedAssetUrl) {
    const chosen = apkAssets.find((a) => a.browserDownloadUrl === options.selectedAssetUrl);
    if (!chosen) {
      return { status: "import_failed", message: "The selected asset is not one of this release's APK assets." };
    }
    asset = chosen;
  } else {
    return {
      status: "multiple_apk_assets",
      ownerRepo,
      tagName: release.tagName,
      assets: apkAssets.map((a) => ({ name: a.name, browserDownloadUrl: a.browserDownloadUrl, size: a.size })),
    };
  }

  // ---- 4-9. download -> validate -> parse -> match -> store -> save,
  // reusing the exact same functions runApkUrlImport() uses. ----
  let download: SafeDownloadResult | null = null;
  try {
    try {
      download = await deps.downloadSafely(asset.browserDownloadUrl, { tempFileName: APK_TEMP_FILE_NAME });
    } catch (caught) {
      const message =
        caught instanceof UnsafeUrlError ? caught.message : "Could not download the release APK.";
      return { status: "import_failed", message };
    }

    try {
      await deps.validateApkFile(download.path, download.size);
    } catch (caught) {
      const message =
        caught instanceof ApkValidationError ? caught.message : "Could not validate the downloaded APK.";
      return { status: "import_failed", message };
    }

    let metadata: ApkMetadata;
    try {
      metadata = await deps.parseApkFile(download.path);
    } catch {
      return { status: "import_failed", message: "Could not read metadata from the downloaded APK." };
    }

    // ---- THE critical gate: never let a GitHub release attach a build to
    // the wrong app. Nothing before this line has written anything. ----
    const parsedPackageName = metadata.packageName?.trim() || null;
    if (parsedPackageName !== targetApp.packageName) {
      return {
        status: "package_mismatch",
        ownerRepo,
        tagName: release.tagName,
        expectedPackageName: targetApp.packageName,
        actualPackageName: parsedPackageName,
      };
    }

    if (!metadata.versionCode || metadata.versionCode <= 0) {
      return { status: "import_failed", message: "The APK's manifest has no usable version code." };
    }
    const versionName = metadata.versionName?.trim() || String(metadata.versionCode);

    const storagePath = `builds/${deps.randomUUID()}.apk`;
    const bytes = await deps.readFile(download.path);
    const { error: uploadError } = await supabase.storage
      .from("apks")
      .upload(storagePath, bytes, { contentType: APK_CONTENT_TYPE, upsert: false });
    if (uploadError) {
      return { status: "import_failed", message: "Could not store the downloaded APK." };
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from("apks").getPublicUrl(storagePath);

    let scanStatus: ScanVerdict = "pending";
    try {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      scanStatus = await deps.scanByHash(sha256);
    } catch {
      // stays "pending" — a failed check is not evidence of safety.
    }

    try {
      const { versionId } = await createVersion(supabase, {
        appId: targetApp.id,
        versionName,
        versionCode: metadata.versionCode,
        fileUrl: publicUrl,
        fileSize: download.size,
        minAndroidVersion: metadata.minAndroidVersion,
        permissions: metadata.permissions,
        scanStatus,
        scannedAt: scanStatus === "pending" ? null : new Date().toISOString(),
        // Always false, regardless of verdict — publishing is a separate,
        // deliberate admin action through the existing publish gate. This
        // module never calls setVersionPublished().
        published: false,
      });

      return {
        status: "imported_unpublished",
        ownerRepo,
        tagName: release.tagName,
        appId: targetApp.id,
        versionId,
        packageName: targetApp.packageName,
        versionName,
        versionCode: metadata.versionCode,
        scanStatus,
      };
    } catch (caught) {
      await cleanupStorage(supabase, storagePath);
      if (caught instanceof DuplicateVersionError) {
        return { status: "already_has_version", ownerRepo };
      }
      return { status: "import_failed", message: "Could not save the version record." };
    }
  } finally {
    await download?.cleanup();
  }
}
