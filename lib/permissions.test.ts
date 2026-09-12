import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { describePermission, describePermissions } from "./permissions.ts";

/**
 * No dedicated coverage existed for this module before P2-3 (confirmed
 * during the P2-3 audit). Covers exactly the behavior P2-3 now depends on
 * elsewhere: the short `label` (reused verbatim in AppJsonLd's `permissions`
 * property and in VersionHistory's per-build summary) and the
 * sensitive-first sort order (relied on by both PermissionsList and
 * VersionHistory's shared PermissionBulletList).
 */

group("describePermission", () => {
  test("a known permission returns a human label and description", () => {
    const info = describePermission("android.permission.CAMERA");
    assert.equal(info.raw, "android.permission.CAMERA");
    assert.equal(info.short, "CAMERA");
    assert.equal(info.label, "Camera");
    assert.equal(info.description, "Use the camera to take photos or video.");
  });

  test("a multi-word permission produces a Title Case label", () => {
    const info = describePermission("android.permission.ACCESS_NETWORK_STATE");
    assert.equal(info.label, "Access Network State");
  });

  test("a known sensitive permission is flagged sensitive", () => {
    assert.equal(describePermission("android.permission.CAMERA").sensitive, true);
    assert.equal(describePermission("android.permission.RECORD_AUDIO").sensitive, true);
    assert.equal(describePermission("android.permission.QUERY_ALL_PACKAGES").sensitive, true);
  });

  test("a known non-sensitive permission is not flagged", () => {
    assert.equal(describePermission("android.permission.INTERNET").sensitive, false);
    assert.equal(describePermission("android.permission.VIBRATE").sensitive, false);
  });

  test("an unrecognised permission still returns a usable label, with a generic description rather than a crash", () => {
    const info = describePermission("android.permission.SOME_NEW_PERMISSION_2027");
    assert.equal(info.label, "Some New Permission 2027");
    assert.equal(info.description, "No description available for this permission.");
    assert.equal(info.sensitive, false);
  });

  test("a permission string with no dots still returns something sane", () => {
    const info = describePermission("CUSTOM_PERMISSION");
    assert.equal(info.short, "CUSTOM_PERMISSION");
    assert.equal(info.label, "Custom Permission");
  });
});

group("describePermissions — ordering", () => {
  test("sensitive permissions sort before non-sensitive ones", () => {
    const result = describePermissions([
      "android.permission.INTERNET",
      "android.permission.CAMERA",
      "android.permission.VIBRATE",
    ]);
    assert.deepEqual(result.map((p) => p.short), ["CAMERA", "INTERNET", "VIBRATE"]);
    assert.equal(result[0].sensitive, true);
  });

  test("within the same sensitivity tier, labels sort alphabetically", () => {
    const result = describePermissions([
      "android.permission.VIBRATE",
      "android.permission.INTERNET",
    ]);
    assert.deepEqual(result.map((p) => p.short), ["INTERNET", "VIBRATE"]);
  });

  test("an empty list returns an empty list, not an error", () => {
    assert.deepEqual(describePermissions([]), []);
  });

  test("every entry in the input produces exactly one entry in the output, in some order", () => {
    const raws = [
      "android.permission.CAMERA",
      "android.permission.INTERNET",
      "android.permission.RECORD_AUDIO",
      "android.permission.VIBRATE",
    ];
    const result = describePermissions(raws);
    assert.equal(result.length, raws.length);
    assert.deepEqual(new Set(result.map((p) => p.raw)), new Set(raws));
  });
});
