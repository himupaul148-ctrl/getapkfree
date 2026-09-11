import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { licenseFromFdroidApp, targetSdkFromFdroidBuild } from "./fdroid-license-sdk.ts";

group("licenseFromFdroidApp", () => {
  test("a real F-Droid license value is preserved as-is", () => {
    assert.equal(licenseFromFdroidApp({ license: "GPL-3.0-only" }), "GPL-3.0-only");
    assert.equal(licenseFromFdroidApp({ license: "Apache-2.0" }), "Apache-2.0");
  });

  test("absent license stays null", () => {
    assert.equal(licenseFromFdroidApp({}), null);
    assert.equal(licenseFromFdroidApp({ license: null }), null);
    assert.equal(licenseFromFdroidApp({ license: undefined }), null);
  });

  test("an empty or whitespace-only license is treated as absent", () => {
    assert.equal(licenseFromFdroidApp({ license: "" }), null);
    assert.equal(licenseFromFdroidApp({ license: "   " }), null);
  });

  test("surrounding whitespace on a real value is trimmed, not altered otherwise", () => {
    assert.equal(licenseFromFdroidApp({ license: "  MIT  " }), "MIT");
  });
});

group("targetSdkFromFdroidBuild", () => {
  test("a real targetSdkVersion is stored as a number", () => {
    const result = targetSdkFromFdroidBuild({ targetSdkVersion: 34 });
    assert.equal(result, 34);
    assert.equal(typeof result, "number");
  });

  test("a string-typed API level (as F-Droid's JSON may carry it) still becomes a number", () => {
    assert.equal(targetSdkFromFdroidBuild({ targetSdkVersion: "33" }), 33);
  });

  test("missing targetSdkVersion becomes null", () => {
    assert.equal(targetSdkFromFdroidBuild({}), null);
    assert.equal(targetSdkFromFdroidBuild({ targetSdkVersion: null }), null);
    assert.equal(targetSdkFromFdroidBuild({ targetSdkVersion: undefined }), null);
  });

  test("a non-numeric or non-positive value becomes null rather than a garbage number", () => {
    assert.equal(targetSdkFromFdroidBuild({ targetSdkVersion: "not-a-number" }), null);
    assert.equal(targetSdkFromFdroidBuild({ targetSdkVersion: 0 }), null);
    assert.equal(targetSdkFromFdroidBuild({ targetSdkVersion: -5 }), null);
  });

  test("never converted through a release-string table — always the raw API level", () => {
    // 34 is Android 14 in API_TO_RELEASE (lib/android.ts) — this function
    // must return the raw integer, never "14.0" or any other release string.
    const result = targetSdkFromFdroidBuild({ targetSdkVersion: 34 });
    assert.equal(result, 34);
    assert.notEqual(result, "14.0");
    assert.equal(typeof result, "number");
  });
});
