/**
 * Structural validation for a downloaded APK, run BEFORE app-info-parser
 * ever sees the file. This is deliberately not a malware scanner — it only
 * answers "is this plausibly a well-formed APK worth parsing at all", the
 * same way a bouncer checks for a pulse, not a criminal record.
 *
 * Three layers, cheapest first, so an obviously-wrong response (an HTML
 * error page, an empty body) never pays for a ZIP-directory walk:
 *   1. size          — reject empty or over the same 100MB cap the
 *                       downloader itself enforces
 *   2. magic bytes    — reject anything that isn't even a ZIP local-file
 *                       header, independent of Content-Type or filename
 *   3. ZIP structure  — open the actual central directory with yauzl and
 *                       walk entry metadata only (never decompressing any
 *                       entry's data) to catch a corrupted/truncated
 *                       archive, an unreasonable entry count, an extreme
 *                       compression ratio, and confirm the archive at
 *                       least contains an AndroidManifest.xml
 */
import { open as openStat } from "node:fs/promises";
import * as yauzl from "yauzl";

export class ApkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApkValidationError";
  }
}

export const MAX_APK_BYTES = 100 * 1024 * 1024;

// Real-world APKs run from a few hundred to a few tens of thousands of
// entries (resources, translated strings, per-density images). This is a
// generous ceiling meant to catch an archive engineered to be slow to walk,
// not to reject a large legitimate app.
const MAX_ZIP_ENTRIES = 50_000;

// If the sum of what the archive claims it will decompress to is enormous
// relative to what was actually downloaded, something is off — either a
// corrupt central directory or a deliberate decompression bomb. This checks
// declared metadata only; nothing is ever inflated to test it.
const MAX_TOTAL_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_DECOMPRESSION_RATIO = 300;

const ZIP_LOCAL_FILE_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// An empty archive (just an end-of-central-directory record) is a
// structurally valid ZIP but can never be a real APK — every APK has at
// least AndroidManifest.xml — so it's rejected by the entry-count/manifest
// checks below rather than here.

export type ApkStructure = {
  entryCount: number;
  totalUncompressedSize: number;
  hasAndroidManifest: boolean;
};

/** Size only — cheap enough to run before touching the file's contents at all. */
export function assertApkSize(byteLength: number): void {
  if (byteLength <= 0) {
    throw new ApkValidationError("The downloaded file is empty.");
  }
  if (byteLength > MAX_APK_BYTES) {
    throw new ApkValidationError(
      `The downloaded file is ${byteLength} bytes, over the ${MAX_APK_BYTES}-byte limit.`,
    );
  }
}

/**
 * An APK is a ZIP archive, and every ZIP begins with a local file header
 * signature. This alone rejects an HTML error page, a JSON error body, or
 * plain text masquerading as an APK — all without trusting the response's
 * Content-Type header or the URL's `.apk` extension, neither of which an
 * attacker-controlled server is obligated to get right.
 */
export function hasApkMagicBytes(head: Buffer): boolean {
  return head.length >= 4 && head.subarray(0, 4).equals(ZIP_LOCAL_FILE_MAGIC);
}

/** Reads just the first 4 bytes of a file — never the whole thing — to check the magic number. */
async function readMagicBytes(path: string): Promise<Buffer> {
  const handle = await openStat(path, "r");
  try {
    const buf = Buffer.alloc(4);
    await handle.read(buf, 0, 4, 0);
    return buf;
  } finally {
    await handle.close();
  }
}

/**
 * Opens the archive's central directory and walks entry metadata only
 * (name + declared sizes) — no entry's compressed data is ever read or
 * inflated. yauzl itself rejects a corrupted or truncated archive by
 * erroring on `open()` or mid-walk, which covers "malformed ZIP" and
 * "truncated ZIP" without any extra code here.
 */
function inspectZipStructure(path: string): Promise<ApkStructure> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true },
      (err, zipfile) => {
        if (err || !zipfile) {
          reject(
            new ApkValidationError(
              `Not a valid ZIP/APK archive: ${err?.message ?? "could not open it"}.`,
            ),
          );
          return;
        }

        // Narrowed once so the nested function declarations below don't
        // each need to re-check the possibly-undefined parameter.
        const zf = zipfile;

        let entryCount = 0;
        let totalUncompressedSize = 0;
        let hasAndroidManifest = false;
        let settled = false;

        function fail(message: string) {
          if (settled) return;
          settled = true;
          zf.close();
          reject(new ApkValidationError(message));
        }

        zf.on("error", (zipErr) => {
          fail(`Not a valid ZIP/APK archive: ${zipErr.message}.`);
        });

        zf.on("entry", (entry) => {
          if (settled) return;

          entryCount++;
          if (entryCount > MAX_ZIP_ENTRIES) {
            fail(
              `Archive has more than ${MAX_ZIP_ENTRIES} entries — refusing to process it.`,
            );
            return;
          }

          totalUncompressedSize += entry.uncompressedSize;
          if (totalUncompressedSize > MAX_TOTAL_UNCOMPRESSED_BYTES) {
            fail(
              `Archive claims to decompress to over ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes — refusing to process it.`,
            );
            return;
          }

          // Ratio check per entry: a single tiny compressed entry claiming
          // an enormous uncompressed size is the classic zip-bomb shape.
          if (
            entry.compressedSize > 0 &&
            entry.uncompressedSize / entry.compressedSize > MAX_DECOMPRESSION_RATIO
          ) {
            fail(
              `An archive entry has a suspicious decompression ratio (${entry.fileName}).`,
            );
            return;
          }

          if (entry.fileName === "AndroidManifest.xml") hasAndroidManifest = true;

          zf.readEntry();
        });

        zf.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ entryCount, totalUncompressedSize, hasAndroidManifest });
        });

        zf.readEntry();
      },
    );
  });
}

/**
 * Runs every structural check against a downloaded file, in order, and
 * throws `ApkValidationError` on the first one that fails. Callers should
 * run this before ever handing the path to `parseApkFile` from
 * `lib/apk/parse.ts`.
 */
export async function validateApkFile(
  path: string,
  byteLength: number,
): Promise<ApkStructure> {
  assertApkSize(byteLength);

  const magic = await readMagicBytes(path);
  if (!hasApkMagicBytes(magic)) {
    throw new ApkValidationError(
      "That file does not start with a ZIP/APK signature — it is not an APK.",
    );
  }

  const structure = await inspectZipStructure(path);

  if (structure.entryCount === 0) {
    throw new ApkValidationError("The archive contains no entries.");
  }
  if (!structure.hasAndroidManifest) {
    throw new ApkValidationError(
      "The archive has no AndroidManifest.xml — it does not resemble an APK.",
    );
  }

  return structure;
}
