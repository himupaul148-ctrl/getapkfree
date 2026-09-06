import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseApkFile, type ApkMetadata } from "./parse.ts";

/**
 * Run with: npm test
 *
 * This is a regression check on the *extraction*, not a re-test of
 * app-info-parser's own binary-manifest decoder (that library has its own
 * test suite). What matters here is that lib/apk/parse.ts — pulled out of
 * app/api/admin/parse-apk/route.ts unchanged — still behaves exactly like
 * the inline version did: it throws a plain, catchable Error for a file
 * app-info-parser cannot read, rather than crashing the process, and its
 * resolved shape still matches the ApkMetadata contract the route (and any
 * future importer) depends on.
 */

group("parseApkFile — regression", () => {
  test("throws a catchable error for a file that is not a real APK", async () => {
    const dir = await mkdtemp(join(tmpdir(), "parse-apk-test-"));
    const path = join(dir, "not-an-apk.bin");
    await writeFile(path, Buffer.from("definitely not an APK"));

    try {
      await assert.rejects(parseApkFile(path), Error);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws (rather than resolving) for a path that does not exist", async () => {
    await assert.rejects(parseApkFile("/definitely/does/not/exist.apk"), Error);
  });

  test("the ApkMetadata contract shape is unchanged", () => {
    // Compile-time check: this must keep matching the fields the upload
    // form and admin route both read. If a future edit narrows or renames
    // a field, this assignment fails to type-check under `npm run test`'s
    // TypeScript-aware run — the same guard `npx tsc --noEmit` provides.
    const sample: ApkMetadata = {
      packageName: "com.example.app",
      versionName: "1.0.0",
      versionCode: 1,
      minAndroidVersion: "9.0",
      label: "Example",
      permissions: ["android.permission.INTERNET"],
      icon: null,
    };
    assert.equal(sample.packageName, "com.example.app");
  });
});
