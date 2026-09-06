import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlibNs from "node:zlib";
import {
  ApkValidationError,
  MAX_APK_BYTES,
  assertApkSize,
  hasApkMagicBytes,
  validateApkFile,
} from "./validate.ts";

/**
 * Run with: npm test
 *
 * Builds real, minimal ZIP files by hand (stored/uncompressed entries only)
 * so the "valid APK" and "malformed/truncated ZIP" cases exercise the exact
 * yauzl code path validateApkFile uses, without needing a zip-writing
 * dependency or a real Android build.
 */

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function storedEntry(name: string, content: Buffer) {
  const nameBuf = Buffer.from(name, "utf8");
  const crc = zlibNs.crc32(content);

  const local = Buffer.concat([
    u32(0x04034b50),
    u16(20), // version needed
    u16(0), // flags
    u16(0), // method: stored
    u16(0), // time
    u16(0), // date
    u32(crc),
    u32(content.length), // compressed size == uncompressed for stored
    u32(content.length),
    u16(nameBuf.length),
    u16(0), // extra length
    nameBuf,
    content,
  ]);

  const central = (localOffset: number) =>
    Buffer.concat([
      u32(0x02014b50),
      u16(20), // version made by
      u16(20), // version needed
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(localOffset),
      nameBuf,
    ]);

  return { local, central, nameBuf };
}

/** A minimal, structurally valid ZIP containing the given stored entries. */
function buildZip(entries: { name: string; content: Buffer }[]): Buffer {
  const built = entries.map((e) => storedEntry(e.name, e.content));

  let offset = 0;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  for (const entry of built) {
    locals.push(entry.local);
    centrals.push(entry.central(offset));
    offset += entry.local.length;
  }

  const localsBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(built.length),
    u16(built.length),
    u32(centralBuf.length),
    u32(localsBuf.length), // offset of central directory
    u16(0),
  ]);

  return Buffer.concat([localsBuf, centralBuf, eocd]);
}

async function withTempFile(content: Buffer, fn: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "apk-validate-test-"));
  const path = join(dir, "sample.bin");
  await writeFile(path, content);
  try {
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const MANIFEST = Buffer.from("fake android manifest bytes");

group("assertApkSize", () => {
  test("rejects an empty file", () => {
    assert.throws(() => assertApkSize(0), ApkValidationError);
  });

  test("rejects a negative/impossible size", () => {
    assert.throws(() => assertApkSize(-1), ApkValidationError);
  });

  test("rejects a file over the 100MB cap", () => {
    assert.throws(() => assertApkSize(MAX_APK_BYTES + 1), ApkValidationError);
  });

  test("accepts a normal-sized file", () => {
    assert.doesNotThrow(() => assertApkSize(1024));
  });
});

group("hasApkMagicBytes", () => {
  test("accepts a real ZIP local-file-header signature", () => {
    assert.equal(hasApkMagicBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
  });

  test("rejects an HTML response", () => {
    assert.equal(hasApkMagicBytes(Buffer.from("<!DOCTYPE html>")), false);
  });

  test("rejects a JSON response", () => {
    assert.equal(hasApkMagicBytes(Buffer.from('{"error":"not found"}')), false);
  });

  test("rejects a short/empty buffer", () => {
    assert.equal(hasApkMagicBytes(Buffer.alloc(0)), false);
    assert.equal(hasApkMagicBytes(Buffer.from([0x50, 0x4b])), false);
  });
});

group("validateApkFile", () => {
  test("accepts a well-formed archive containing AndroidManifest.xml", async () => {
    const zip = buildZip([
      { name: "AndroidManifest.xml", content: MANIFEST },
      { name: "classes.dex", content: Buffer.from("fake dex") },
    ]);
    await withTempFile(zip, async (path) => {
      const structure = await validateApkFile(path, zip.length);
      assert.equal(structure.hasAndroidManifest, true);
      assert.equal(structure.entryCount, 2);
    });
  });

  test("rejects an HTML error page served instead of a file", async () => {
    const html = Buffer.from("<html><body>404 not found</body></html>");
    await withTempFile(html, async (path) => {
      await assert.rejects(
        validateApkFile(path, html.length),
        ApkValidationError,
      );
    });
  });

  test("rejects a JSON error body", async () => {
    const json = Buffer.from(JSON.stringify({ error: "rate limited" }));
    await withTempFile(json, async (path) => {
      await assert.rejects(
        validateApkFile(path, json.length),
        ApkValidationError,
      );
    });
  });

  test("rejects an empty file without touching the filesystem further", async () => {
    // byteLength alone is enough to reject — no path needs to exist.
    await assert.rejects(
      validateApkFile("/does/not/exist", 0),
      ApkValidationError,
    );
  });

  test("rejects an oversized file before ever opening it", async () => {
    await assert.rejects(
      validateApkFile("/does/not/exist", MAX_APK_BYTES + 1),
      ApkValidationError,
    );
  });

  test("rejects a malformed ZIP (right magic, garbage after it)", async () => {
    const garbage = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("this is not a real zip structure at all, just noise"),
    ]);
    await withTempFile(garbage, async (path) => {
      await assert.rejects(
        validateApkFile(path, garbage.length),
        ApkValidationError,
      );
    });
  });

  test("rejects a truncated ZIP (valid header, missing central directory)", async () => {
    const zip = buildZip([{ name: "AndroidManifest.xml", content: MANIFEST }]);
    // Cut off the central directory and EOCD entirely — only the local
    // file header and its data survive, which yauzl cannot open.
    const truncated = zip.subarray(0, 40);
    await withTempFile(truncated, async (path) => {
      await assert.rejects(
        validateApkFile(path, truncated.length),
        ApkValidationError,
      );
    });
  });

  test("rejects an archive with no AndroidManifest.xml", async () => {
    const zip = buildZip([{ name: "readme.txt", content: Buffer.from("hi") }]);
    await withTempFile(zip, async (path) => {
      await assert.rejects(
        validateApkFile(path, zip.length),
        /AndroidManifest/,
      );
    });
  });

  test("rejects an archive with an absurd decompression ratio", async () => {
    // Method 8 (deflate), not 0 (stored): a stored entry's compressed and
    // uncompressed sizes must be equal by the ZIP spec itself, and yauzl
    // already rejects a mismatched one on that basis alone (a real, useful
    // check, just not the one this test targets). A deflated entry carries
    // no such constraint between the two declared sizes, which is exactly
    // what a real decompression bomb relies on — one real byte "compressing"
    // a claimed enormous payload.
    const nameBuf = Buffer.from("AndroidManifest.xml", "utf8");
    const content = Buffer.from("x"); // never actually inflated by this check
    const crc = zlibNs.crc32(content);
    const DEFLATE = 8;

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(DEFLATE),
      u16(0),
      u16(0),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      content,
    ]);

    // 1MB claimed against 1 byte actually stored: a 1,000,000:1 ratio, well
    // past the threshold, while staying far under the 2GB total-size cap so
    // this specifically exercises the per-entry ratio check.
    const hugeUncompressed = 1_000_000;
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(DEFLATE),
      u16(0),
      u16(0),
      u32(crc),
      u32(content.length), // compressed size stays honest
      u32(hugeUncompressed), // uncompressed size lies
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(0),
      nameBuf,
    ]);

    const eocd = Buffer.concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(1),
      u16(1),
      u32(central.length),
      u32(local.length),
      u16(0),
    ]);

    const zip = Buffer.concat([local, central, eocd]);
    await withTempFile(zip, async (path) => {
      await assert.rejects(
        validateApkFile(path, zip.length),
        /decompression ratio/,
      );
    });
  });
});
