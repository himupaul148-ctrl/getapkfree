import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { Readable } from "node:stream";
import * as zlib from "node:zlib";
import { downloadSafely, type LookupFn, type Transport } from "../net/safe-fetch.ts";
import { validateApkFile } from "./validate.ts";
import { parseApkFile } from "./parse.ts";

/**
 * Run with: npm test
 *
 * The production bug this regresses against: safe-fetch.ts staged every
 * download as "download.bin", and app-info-parser (inside parseApkFile)
 * decides APK-vs-IPA purely from the trailing filename extension — so a
 * genuinely valid APK, downloaded correctly and validated correctly, still
 * failed to parse with "Unsupported file type, only support .ipa or .apk
 * file." None of the individual unit suites caught this because
 * import-pipeline.test.ts mocks validateApkFile/parseApkFile entirely, and
 * safe-fetch.test.ts never calls the real parser.
 *
 * This test closes that gap: it runs the REAL downloadSafely() (network and
 * DNS still faked, exactly like the rest of safe-fetch.test.ts) with the
 * `tempFileName` the import pipeline actually requests, then feeds the
 * result straight into the REAL validateApkFile() and REAL parseApkFile() —
 * no mocks anywhere past the transport/DNS boundary.
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

/** A minimal, structurally valid ZIP/APK: one stored AndroidManifest.xml entry. */
function buildMinimalApk(): Buffer {
  const name = Buffer.from("AndroidManifest.xml", "utf8");
  const content = Buffer.from("not real binary AXML, just realistic ZIP structure");
  const crc = zlib.crc32(content);

  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(content.length), u32(content.length),
    u16(name.length), u16(0), name, content,
  ]);
  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(crc), u32(content.length), u32(content.length),
    u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name,
  ]);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(1), u16(1),
    u32(central.length), u32(local.length), u16(0),
  ]);

  return Buffer.concat([local, central, eocd]);
}

const PUBLIC_LOOKUP: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

function fakeApkTransport(apkBytes: Buffer): Transport {
  return async () => ({
    kind: "body",
    statusCode: 200,
    headers: { "content-type": "application/vnd.android.package-archive" },
    body: Readable.from([apkBytes]),
    destroy: () => {},
  });
}

group("real download -> validate -> parse glue (regression: download.bin extension bug)", () => {
  test("downloadSafely with tempFileName: 'download.apk' produces a path app-info-parser accepts", async () => {
    const apk = buildMinimalApk();

    const download = await downloadSafely("https://example.com/app.apk", {
      lookup: PUBLIC_LOOKUP,
      transport: fakeApkTransport(apk),
      tempFileName: "download.apk",
    });

    try {
      // Never regress to the old hardcoded ".bin" name.
      assert.match(download.path, /\.apk$/, "the temp file must end in .apk, not .bin");
      assert.doesNotMatch(download.path, /\.bin$/);

      // Real validateApkFile, no mock — confirms the downloaded bytes are
      // a genuinely well-formed APK/ZIP.
      const structure = await validateApkFile(download.path, download.size);
      assert.equal(structure.hasAndroidManifest, true);

      // Real parseApkFile / real app-info-parser. This APK fixture has no
      // real binary AXML, so a manifest-content error is expected and
      // fine — what this test guards against is the OLD failure mode,
      // where app-info-parser rejected the file before even attempting to
      // read it, purely because of the filename extension.
      await assert.rejects(
        parseApkFile(download.path),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.doesNotMatch(
            err.message,
            /Unsupported file type/i,
            "must never reject on filename/extension grounds for a real .apk path",
          );
          return true;
        },
      );
    } finally {
      await download.cleanup();
    }
  });

  test("without tempFileName, the same real chain reproduces the original bug", async () => {
    // Documents exactly what was broken: the same real download -> validate
    // -> parse chain, but staged with the old default filename, fails at
    // the parse step for a purely cosmetic reason. This is the failure the
    // production smoke test hit.
    const apk = buildMinimalApk();

    const download = await downloadSafely("https://example.com/app.apk", {
      lookup: PUBLIC_LOOKUP,
      transport: fakeApkTransport(apk),
      // tempFileName omitted on purpose — the pre-fix default.
    });

    try {
      assert.match(download.path, /\.bin$/);
      await validateApkFile(download.path, download.size); // structure is still fine

      await assert.rejects(
        parseApkFile(download.path),
        /Unsupported file type, only support \.ipa or \.apk file\./,
      );
    } finally {
      await download.cleanup();
    }
  });
});
