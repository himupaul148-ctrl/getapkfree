/**
 * Server-side logic for re-checking one already-imported build's malware
 * scan status via a VirusTotal hash lookup — extracted from
 * app/api/admin/versions/[versionId]/verify/route.ts, the same split
 * import-pipeline.ts already uses, so it can be exercised directly by tests
 * with the database and the file fetch swapped for fakes. The route itself
 * only adds admin authentication and Next.js request/response plumbing
 * around this.
 *
 * Never trusts anything but the version's own stored file: the SHA-256 is
 * always computed here, server-side, from the actual downloaded bytes —
 * never accepted from a caller. The file itself is fetched through the same
 * SSRF-safe downloader (lib/net/safe-fetch.ts) the URL-import pipeline
 * already uses — never a raw, unpinned fetch of a database-supplied URL.
 * Touches only `scan_status` and `scanned_at`, and only for the one version
 * row identified by its own id — never a sibling version, and never
 * `published`. Publishing stays a separate, deliberate action gated by
 * canPublishVersion (lib/admin/version-publish.ts), which this module does
 * not touch at all.
 *
 * Only re-checks a version whose current scan_status is "pending" or
 * "failed" — enforced here, not just hidden in the admin UI, so a direct
 * authenticated request against a clean/flagged/external/already-published
 * build is rejected rather than silently re-scanning something outside this
 * feature's intended scope.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { downloadSafely, UnsafeUrlError } from "../net/safe-fetch.ts";
import { createVirusTotalScanner, type ScanVerdict } from "./virustotal.ts";

export type VerifyResult = { status: number; body: Record<string, unknown> };

export type VerifyVersionDeps = {
  /**
   * Downloads the version's stored file and returns its bytes. Must go
   * through the same SSRF-safe path as the URL-import pipeline (HTTPS-only,
   * resolve-then-pin DNS, private/internal/metadata IP block-list, size
   * cap, timeout, re-validated redirects) — never a raw, unpinned fetch of
   * a database-supplied URL.
   */
  fetchFileBytes: (url: string) => Promise<Buffer>;
  /** Resolves a verdict for the file's own SHA-256. Any failure must never fail the request — the caller falls back to "pending". */
  scanByHash: (sha256: string) => Promise<ScanVerdict>;
};

async function defaultScanByHash(sha256: string): Promise<ScanVerdict> {
  const scanner = createVirusTotalScanner({ apiKey: process.env.VIRUSTOTAL_API_KEY });
  return scanner.scanByHash(sha256);
}

/**
 * The same downloadSafely() the URL-import pipeline calls, not a
 * reimplementation — it downloads to a temp file rather than returning
 * bytes directly, so this reads that file and always cleans it up
 * afterward, success or failure.
 */
async function defaultFetchFileBytes(url: string): Promise<Buffer> {
  const download = await downloadSafely(url, { tempFileName: "verify.apk" });
  try {
    return await readFile(download.path);
  } finally {
    await download.cleanup();
  }
}

export const defaultDeps: VerifyVersionDeps = {
  fetchFileBytes: defaultFetchFileBytes,
  scanByHash: defaultScanByHash,
};

type VersionRow = {
  id: string;
  file_url: string | null;
  scan_status: string | null;
  published: boolean;
};

/** The only states this feature is allowed to re-check — enforced server-side, independent of what the UI happens to show. */
function isVerifiable(scanStatus: string | null): boolean {
  return scanStatus === "pending" || scanStatus === "failed";
}

/**
 * Re-checks exactly one version, identified by its own id. Every read and
 * write below is filtered by that id alone — this must never touch a
 * sibling build of the same app, and must never write `published`.
 */
export async function runVersionVerify(
  versionId: string,
  supabase: SupabaseClient,
  overrides: Partial<VerifyVersionDeps> = {},
): Promise<VerifyResult> {
  const deps: VerifyVersionDeps = { ...defaultDeps, ...overrides };

  if (!versionId || typeof versionId !== "string") {
    return { status: 400, body: { error: "A version id is required." } };
  }

  const { data: version, error: readError } = await supabase
    .from("versions")
    .select("id, file_url, scan_status, published")
    .eq("id", versionId)
    .maybeSingle<VersionRow>();

  if (readError) {
    return { status: 500, body: { error: readError.message } };
  }
  if (!version) {
    return { status: 404, body: { error: "No build with that id." } };
  }

  // Scope enforcement: clean/external/flagged builds are not re-opened by
  // this feature, and an already-published build must never be re-scanned
  // out from under visitors by this route. Checked before touching the
  // file or VirusTotal at all.
  if (!isVerifiable(version.scan_status)) {
    return {
      status: 409,
      body: {
        error: `This build's scan status is "${version.scan_status ?? "null"}" and cannot be re-verified.`,
      },
    };
  }
  if (version.published) {
    return {
      status: 409,
      body: { error: "This build is already published and cannot be re-verified." },
    };
  }

  if (!version.file_url) {
    return { status: 422, body: { error: "This build has no stored file to verify." } };
  }

  // Re-derive everything from the file itself — never trust a client-
  // supplied hash or verdict.
  let bytes: Buffer;
  try {
    bytes = await deps.fetchFileBytes(version.file_url);
  } catch (caught) {
    if (caught instanceof UnsafeUrlError) {
      console.error("[verify-version] blocked an unsafe stored file URL:", caught.message);
    } else {
      console.error("[verify-version] could not download the stored build:", caught);
    }
    return { status: 502, body: { error: "Could not read the stored build." } };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  let scanStatus: ScanVerdict = "pending";
  try {
    scanStatus = await deps.scanByHash(sha256);
  } catch (caught) {
    console.error("[verify-version] VirusTotal lookup failed:", caught);
    // scanStatus stays "pending" — a failed check is not evidence of safety.
  }

  const scannedAt = scanStatus === "pending" ? null : new Date().toISOString();

  // Scoped by this version's own id only. No app_id, no bulk filter, and no
  // `published` in the payload — publishing is a separate, deliberate
  // action this module never performs.
  const { error: updateError } = await supabase
    .from("versions")
    .update({ scan_status: scanStatus, scanned_at: scannedAt })
    .eq("id", versionId);

  if (updateError) {
    return { status: 500, body: { error: updateError.message } };
  }

  return { status: 200, body: { versionId, scanStatus, scannedAt } };
}
