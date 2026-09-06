/**
 * The DOWNLOAD → VALIDATE → PARSE → STORE → SAVE (unpublished) pipeline for
 * importing an APK from a remote URL, factored out of
 * app/api/admin/import-apk-from-url/route.ts so it can be exercised directly
 * by tests with every external boundary (network, DNS, Storage, database)
 * swapped for a fake — the route itself only adds admin authentication and
 * Next.js request/response plumbing around this.
 *
 * Every value that reaches the database comes from either the URL the admin
 * supplied or from what `downloadSafely` + `validateApkFile` + `parseApkFile`
 * independently determined about the bytes actually fetched — never from
 * arbitrary request-body fields. The created version is always
 * `scan_status: "pending"`, `published: false`; no live malware scan exists
 * yet (see scripts/import-fdroid.mjs's offline `scanByHash`, which this
 * route does not call), so nothing here is allowed to invent a verdict.
 */
import { randomUUID as nodeRandomUUID } from "node:crypto";
import { readFile as fsReadFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
// Relative, with explicit extensions, not the usual "@/..." alias: this
// module is exercised directly by the plain `node --test` runner (see
// import-pipeline.test.ts), which resolves specifiers itself and has no
// knowledge of tsconfig's bundler-only path aliases.
import {
  downloadSafely as downloadSafelyImpl,
  UnsafeUrlError,
  type SafeDownloadOptions,
  type SafeDownloadResult,
} from "../net/safe-fetch.ts";
import {
  validateApkFile as validateApkFileImpl,
  ApkValidationError,
} from "./validate.ts";
import { parseApkFile as parseApkFileImpl, type ApkMetadata } from "./parse.ts";
import {
  DuplicateVersionError,
  createVersion,
  findOrCreateApp,
} from "./save-build.ts";

const APK_CONTENT_TYPE = "application/vnd.android.package-archive";

// app-info-parser (via parseApkFile) infers file type from the trailing
// extension of the path it's given — it has no other way to tell an APK
// from an IPA. safe-fetch.ts itself stays content-agnostic (it downloads
// arbitrary URLs, not specifically APKs), so this pipeline is the one that
// has to ask for the right extension explicitly, exactly as the local
// upload route already does with its own "upload.apk" temp file.
const APK_TEMP_FILE_NAME = "download.apk";

export type ImportResult = { status: number; body: Record<string, unknown> };

export type ImportPipelineDeps = {
  downloadSafely: (url: string, options?: SafeDownloadOptions) => Promise<SafeDownloadResult>;
  validateApkFile: (path: string, size: number) => Promise<unknown>;
  parseApkFile: (path: string) => Promise<ApkMetadata>;
  readFile: (path: string) => Promise<Buffer>;
  randomUUID: () => string;
};

// Exported so a test can assert this route actually wires up the real
// SSRF-safe downloader/validator/parser rather than, say, global fetch() —
// an identity check that survives even if the functions' behavior is
// otherwise refactored.
export const defaultDeps: ImportPipelineDeps = {
  downloadSafely: downloadSafelyImpl,
  validateApkFile: validateApkFileImpl,
  parseApkFile: parseApkFileImpl,
  readFile: fsReadFile,
  randomUUID: nodeRandomUUID,
};

/** Everything the route needs from the body other than the URL is deliberately never read here. */
function parseRequestedUrl(rawUrl: unknown): { ok: true; value: string } | { ok: false; result: ImportResult } {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { ok: false, result: { status: 400, body: { error: "A URL is required." } } };
  }
  const trimmed = rawUrl.trim();
  try {
    // Validity check only — downloadSafely() does the real scheme/SSRF parsing.
    new URL(trimmed);
  } catch {
    return { ok: false, result: { status: 400, body: { error: "That is not a valid URL." } } };
  }
  return { ok: true, value: trimmed };
}

async function findExistingVersion(
  supabase: SupabaseClient,
  packageName: string,
  versionCode: number,
): Promise<boolean> {
  const { data: existingApp } = await supabase
    .from("apps")
    .select("id")
    .eq("package_name", packageName)
    .maybeSingle<{ id: string }>();
  if (!existingApp) return false;

  const { data: existingVersion } = await supabase
    .from("versions")
    .select("id")
    .eq("app_id", existingApp.id)
    .eq("version_code", versionCode)
    .maybeSingle<{ id: string }>();
  return Boolean(existingVersion);
}

async function cleanupStorage(supabase: SupabaseClient, path: string | null) {
  if (!path) return;
  const { error } = await supabase.storage.from("apks").remove([path]);
  if (error) {
    console.error("[import-apk-from-url] failed to remove orphaned storage object:", path, error);
  }
}

async function cleanupCreatedApp(supabase: SupabaseClient, appId: string) {
  const { error } = await supabase.from("apps").delete().eq("id", appId);
  if (error) {
    console.error("[import-apk-from-url] failed to remove orphaned app row:", appId, error);
  }
}

/**
 * Runs the whole import pipeline for one request and returns a plain
 * `{status, body}` result — no Next.js types, so tests can call this
 * directly with fakes and assert on the result like any other function.
 */
export async function runApkUrlImport(
  rawUrl: unknown,
  supabase: SupabaseClient,
  overrides: Partial<ImportPipelineDeps> = {},
): Promise<ImportResult> {
  const deps: ImportPipelineDeps = { ...defaultDeps, ...overrides };

  const parsedUrl = parseRequestedUrl(rawUrl);
  if (!parsedUrl.ok) return parsedUrl.result;

  let download: SafeDownloadResult | null = null;
  let storagePath: string | null = null;
  let createdAppId: string | null = null;

  try {
    // ---- 1. download (SSRF-safe, size/redirect/timeout-limited) ----
    try {
      download = await deps.downloadSafely(parsedUrl.value, { tempFileName: APK_TEMP_FILE_NAME });
    } catch (caught) {
      if (caught instanceof UnsafeUrlError) {
        return { status: 400, body: { error: caught.message } };
      }
      console.error("[import-apk-from-url] download failed:", caught);
      return { status: 502, body: { error: "Could not download a file from that URL." } };
    }

    // ---- 2. validate (structural only — not a malware scan) ----
    try {
      await deps.validateApkFile(download.path, download.size);
    } catch (caught) {
      if (caught instanceof ApkValidationError) {
        return { status: 422, body: { error: caught.message } };
      }
      console.error("[import-apk-from-url] APK validation failed:", caught);
      return { status: 422, body: { error: "Could not validate the downloaded file." } };
    }

    // ---- 3. parse (never trust the request body for any of this) ----
    let metadata: ApkMetadata;
    try {
      metadata = await deps.parseApkFile(download.path);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "unknown error";
      return { status: 422, body: { error: `Could not read metadata from that APK: ${message}` } };
    }

    // ---- 4. sanity-check the parsed metadata ----
    const packageName = metadata.packageName?.trim();
    if (!packageName) {
      return { status: 422, body: { error: "The APK's manifest has no package name." } };
    }
    if (!metadata.versionCode || metadata.versionCode <= 0) {
      return { status: 422, body: { error: "The APK's manifest has no usable version code." } };
    }
    // version_name is NOT NULL in the schema; Play omits it for updates
    // sometimes, so fall back to the version code rather than inventing a
    // fake-looking string.
    const versionName = metadata.versionName?.trim() || String(metadata.versionCode);
    const label = metadata.label?.trim() || packageName;

    // ---- 5. duplicate pre-check (a courtesy — the DB constraint decides) ----
    if (await findExistingVersion(supabase, packageName, metadata.versionCode)) {
      return {
        status: 409,
        body: { error: `Version ${metadata.versionCode} of ${packageName} has already been imported.` },
      };
    }

    // ---- 6. upload the validated bytes to permanent storage ----
    storagePath = `builds/${deps.randomUUID()}.apk`;
    const bytes = await deps.readFile(download.path);
    const { error: uploadError } = await supabase.storage
      .from("apks")
      .upload(storagePath, bytes, { contentType: APK_CONTENT_TYPE, upsert: false });
    if (uploadError) {
      storagePath = null; // nothing landed — nothing to clean up
      console.error("[import-apk-from-url] storage upload failed:", uploadError);
      return { status: 502, body: { error: "Could not store the downloaded APK." } };
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from("apks").getPublicUrl(storagePath);

    // ---- 7. find-or-create the app row ----
    let appResult;
    try {
      appResult = await findOrCreateApp(supabase, {
        packageName,
        name: label,
        // Nothing here is invented: an existing app is reused as-is, and a
        // new one gets only what the APK itself actually provided. The
        // admin UI is where the rest gets filled in later.
        category: null,
        description: null,
        developerName: null,
        iconUrl: metadata.icon,
      });
    } catch (caught) {
      await cleanupStorage(supabase, storagePath);
      console.error("[import-apk-from-url] app save failed:", caught);
      return { status: 500, body: { error: "Could not save the app record." } };
    }
    if (appResult.created) createdAppId = appResult.appId;

    // ---- 8. create the (unpublished, pending-scan) version row ----
    try {
      const { versionId } = await createVersion(supabase, {
        appId: appResult.appId,
        versionName,
        versionCode: metadata.versionCode,
        // The public download URL is always our own Storage object, never
        // the admin-supplied remote URL.
        fileUrl: publicUrl,
        fileSize: download.size,
        minAndroidVersion: metadata.minAndroidVersion,
        permissions: metadata.permissions,
        scanStatus: "pending",
        scannedAt: null,
        published: false,
      });

      return {
        status: 200,
        body: {
          success: true,
          app: {
            id: appResult.appId,
            slug: appResult.slug,
            name: label,
            packageName,
            created: appResult.created,
          },
          version: {
            id: versionId,
            versionName,
            versionCode: metadata.versionCode,
            minAndroidVersion: metadata.minAndroidVersion,
            permissionsCount: metadata.permissions.length,
            scanStatus: "pending",
            published: false,
          },
        },
      };
    } catch (caught) {
      if (caught instanceof DuplicateVersionError) {
        // The app row is legitimate either way (ours, or the winner of a
        // concurrent import of the same package) — only this request's own
        // storage object is orphaned.
        await cleanupStorage(supabase, storagePath);
        return {
          status: 409,
          body: { error: `Version ${caught.versionCode} of ${packageName} has already been imported.` },
        };
      }

      await cleanupStorage(supabase, storagePath);
      // Only ever remove the app row THIS request created — an existing
      // app must never be deleted because a new version failed to save.
      if (createdAppId) await cleanupCreatedApp(supabase, createdAppId);
      console.error("[import-apk-from-url] version save failed:", caught);
      return { status: 500, body: { error: "Could not save the version record." } };
    }
  } finally {
    // Temp file cleanup happens exactly once, regardless of which exit path
    // above was taken.
    await download?.cleanup();
  }
}
