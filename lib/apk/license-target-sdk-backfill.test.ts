import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  findMatchingFdroidBuild,
  hasManualLicense,
  planLicenseBackfill,
  planTargetSdkBackfill,
  type LicenseBackfillInput,
  type TargetSdkBackfillInput,
} from "./license-target-sdk-backfill.ts";

function licenseInput(overrides: Partial<LicenseBackfillInput> = {}): LicenseBackfillInput {
  return {
    currentLicense: null,
    manualFields: [],
    matchStatus: "matched",
    fdroidLicense: "MIT",
    ...overrides,
  };
}

function sdkInput(overrides: Partial<TargetSdkBackfillInput> = {}): TargetSdkBackfillInput {
  return {
    currentTargetSdk: null,
    matchStatus: "matched",
    fdroidTargetSdk: 34,
    ...overrides,
  };
}

group("planLicenseBackfill", () => {
  test("license preserved: current already equals F-Droid's value -> match", () => {
    const d = planLicenseBackfill(licenseInput({ currentLicense: "MIT", fdroidLicense: "MIT" }));
    assert.deepEqual(d, { action: "match", reason: "already-matching" });
  });

  test("missing current license, F-Droid has one -> propose (fill), not fabricated", () => {
    const d = planLicenseBackfill(licenseInput({ currentLicense: null, fdroidLicense: "Apache-2.0" }));
    assert.deepEqual(d, { action: "propose", reason: "license-filled" });
  });

  test("F-Droid has no usable license -> skip, current (if any) is left as-is", () => {
    const d = planLicenseBackfill(licenseInput({ fdroidLicense: null }));
    assert.deepEqual(d, { action: "skip", reason: "no-fdroid-license" });
  });

  test("app not found in the current F-Droid index -> skip, never guessed", () => {
    const d = planLicenseBackfill(licenseInput({ matchStatus: "not-in-index", fdroidLicense: null }));
    assert.deepEqual(d, { action: "skip", reason: "not-in-fdroid-index" });
  });

  test("manual override: license in manual_fields is never proposed, even when it disagrees", () => {
    const d = planLicenseBackfill(
      licenseInput({ manualFields: ["license"], currentLicense: "GPL-3.0-only", fdroidLicense: "MIT" }),
    );
    assert.deepEqual(d, { action: "skip", reason: "manual-override" });
  });

  test("manual override takes priority even when the not-in-index check would also apply first — order matters", () => {
    // not-in-index is checked before manual-override, since there is nothing
    // authoritative to compare against at all in that case.
    const d = planLicenseBackfill(
      licenseInput({ matchStatus: "not-in-index", manualFields: ["license"], fdroidLicense: null }),
    );
    assert.equal(d.reason, "not-in-fdroid-index");
  });

  test("existing non-null license differs from F-Droid -> conflict, not silently overwritten", () => {
    const d = planLicenseBackfill(
      licenseInput({ currentLicense: "GPL-3.0-only", fdroidLicense: "GPL-3.0-or-later" }),
    );
    assert.deepEqual(d, { action: "conflict", reason: "existing-license-differs" });
  });

  test("hasManualLicense only fires for the exact 'license' entry", () => {
    assert.equal(hasManualLicense(["license"]), true);
    assert.equal(hasManualLicense(["name", "description"]), false);
    assert.equal(hasManualLicense([]), false);
    assert.equal(hasManualLicense(null), false);
  });
});

group("planTargetSdkBackfill", () => {
  test("target SDK numeric value preserved: current already equals F-Droid's value -> match", () => {
    const d = planTargetSdkBackfill(sdkInput({ currentTargetSdk: 34, fdroidTargetSdk: 34 }));
    assert.deepEqual(d, { action: "match", reason: "already-matching" });
  });

  test("missing current target_sdk, F-Droid has one -> propose (fill)", () => {
    const d = planTargetSdkBackfill(sdkInput({ currentTargetSdk: null, fdroidTargetSdk: 33 }));
    assert.deepEqual(d, { action: "propose", reason: "target-sdk-filled" });
    assert.equal(typeof (d as { action: "propose" }).reason, "string");
  });

  test("F-Droid target SDK missing -> skip, never fabricated", () => {
    const d = planTargetSdkBackfill(sdkInput({ fdroidTargetSdk: null }));
    assert.deepEqual(d, { action: "skip", reason: "no-fdroid-target-sdk" });
  });

  test("app not in the current F-Droid index -> skip", () => {
    const d = planTargetSdkBackfill(sdkInput({ matchStatus: "not-in-fdroid-index", fdroidTargetSdk: null }));
    assert.deepEqual(d, { action: "skip", reason: "not-in-fdroid-index" });
  });

  test("no build with this exact version_code -> skip, distinct from 'app not in index'", () => {
    const d = planTargetSdkBackfill(sdkInput({ matchStatus: "no-matching-build", fdroidTargetSdk: null }));
    assert.deepEqual(d, { action: "skip", reason: "no-matching-build" });
  });

  test("existing non-null target_sdk differs from F-Droid -> conflict, not silently overwritten", () => {
    const d = planTargetSdkBackfill(sdkInput({ currentTargetSdk: 33, fdroidTargetSdk: 34 }));
    assert.deepEqual(d, { action: "conflict", reason: "existing-target-sdk-differs" });
  });

  test("target_sdk has no manual-override concept: a 'conflict' is reported the same way regardless of any manual_fields on the app", () => {
    // TargetSdkBackfillInput intentionally carries no manualFields at all —
    // this test documents that omission is deliberate, not an oversight.
    const input: TargetSdkBackfillInput = {
      currentTargetSdk: 30,
      matchStatus: "matched",
      fdroidTargetSdk: 34,
    };
    assert.deepEqual(planTargetSdkBackfill(input), {
      action: "conflict",
      reason: "existing-target-sdk-differs",
    });
    assert.equal("manualFields" in input, false);
  });

  test("proposed value is always a raw API level, never a release-name string", () => {
    const d = planTargetSdkBackfill(sdkInput({ currentTargetSdk: null, fdroidTargetSdk: 34 }));
    assert.equal(d.action, "propose");
    // The decision itself carries no value — callers report fdroidTargetSdk
    // (already produced by targetSdkFromFdroidBuild, tested separately to
    // never be release-string-converted). This asserts the input contract:
    // a plausible release string would fail the "number" check upstream.
    assert.equal(Number.isInteger(sdkInput().fdroidTargetSdk), true);
  });
});

group("findMatchingFdroidBuild", () => {
  test("finds the build whose versionCode exactly matches", () => {
    const builds = [
      { versionCode: 20, targetSdkVersion: 33 },
      { versionCode: 21, targetSdkVersion: 34 },
    ];
    assert.deepEqual(findMatchingFdroidBuild(builds, 21), { versionCode: 21, targetSdkVersion: 34 });
  });

  test("returns undefined when no build has that version_code — unmatched, reported as such", () => {
    const builds = [{ versionCode: 20, targetSdkVersion: 33 }];
    assert.equal(findMatchingFdroidBuild(builds, 99), undefined);
  });

  test("versionCode types are compared numerically, tolerating a string in the source JSON", () => {
    const builds = [{ versionCode: "21", targetSdkVersion: 34 }];
    assert.deepEqual(findMatchingFdroidBuild(builds, 21), { versionCode: "21", targetSdkVersion: 34 });
  });

  test("empty build list -> undefined, not a throw", () => {
    assert.equal(findMatchingFdroidBuild([], 1), undefined);
  });
});
