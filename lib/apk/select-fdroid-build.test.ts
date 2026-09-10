import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { selectFdroidBuild, type FdroidBuildLike } from "./select-fdroid-build.ts";

/**
 * Run with: npm test
 *
 * Regression coverage for the import-readiness audit finding: F-Droid lists
 * builds newest-first by versionCode, and some apps (Notesnook 3.4.11 is the
 * real example that triggered this) ship one APK per CPU architecture for a
 * single release, each with its own versionCode. Naively taking the first
 * entry can land on an x86_64- or x86-only build purely because it happened
 * to get the highest versionCode — these tests pin the fix: prefer
 * arm64-v8a, then armeabi-v7a, only when a release genuinely has more than
 * one build to choose from.
 */

function build(overrides: Partial<FdroidBuildLike> & Record<string, unknown> = {}): FdroidBuildLike {
  return {
    versionCode: 1,
    versionName: "1.0",
    nativecode: null,
    ...overrides,
  };
}

group("selectFdroidBuild", () => {
  test("the real Notesnook 3.4.11 case: prefers arm64-v8a over the higher-versionCode x86_64 build", () => {
    // Actual shape from the F-Droid index: four per-arch splits of the same
    // release, arm64-v8a does not have the highest versionCode.
    const builds = [
      build({ versionCode: 15589, versionName: "3.4.11", nativecode: ["x86_64"] }),
      build({ versionCode: 15588, versionName: "3.4.11", nativecode: ["arm64-v8a"] }),
      build({ versionCode: 15587, versionName: "3.4.11", nativecode: ["x86"] }),
      build({ versionCode: 15586, versionName: "3.4.11", nativecode: ["armeabi-v7a"] }),
    ];

    const selected = selectFdroidBuild(builds);

    assert.equal(selected?.versionCode, 15588);
    assert.deepEqual(selected?.nativecode, ["arm64-v8a"]);
  });

  test("falls back to armeabi-v7a when no arm64-v8a build is present", () => {
    const builds = [
      build({ versionCode: 3, versionName: "2.0", nativecode: ["x86_64"] }),
      build({ versionCode: 2, versionName: "2.0", nativecode: ["armeabi-v7a"] }),
      build({ versionCode: 1, versionName: "2.0", nativecode: ["x86"] }),
    ];

    const selected = selectFdroidBuild(builds);

    assert.equal(selected?.versionCode, 2);
  });

  test("falls back to the newest build when no split declares a preferred ABI", () => {
    const builds = [
      build({ versionCode: 2, versionName: "1.5", nativecode: ["x86_64"] }),
      build({ versionCode: 1, versionName: "1.5", nativecode: ["x86"] }),
    ];

    const selected = selectFdroidBuild(builds);

    // Neither split is arm-compatible — nothing safe to prefer, so this
    // matches the pipeline's pre-existing behavior rather than guessing.
    assert.equal(selected?.versionCode, 2);
  });

  test("does not break a universal APK with no native code at all", () => {
    const builds = [build({ versionCode: 5, versionName: "3.0", nativecode: null })];

    const selected = selectFdroidBuild(builds);

    assert.equal(selected?.versionCode, 5);
  });

  test("does not break a single fat APK that already bundles every ABI", () => {
    const builds = [
      build({
        versionCode: 7,
        versionName: "1.2",
        nativecode: ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"],
      }),
    ];

    const selected = selectFdroidBuild(builds);

    assert.equal(selected?.versionCode, 7);
  });

  test("the real LocalSend case: arm64-v8a already has the highest versionCode, so behavior is unchanged", () => {
    const builds = [
      build({ versionCode: 643, versionName: "1.18.2", nativecode: ["arm64-v8a"] }),
      build({ versionCode: 642, versionName: "1.18.2", nativecode: ["armeabi-v7a"] }),
      build({ versionCode: 641, versionName: "1.18.2", nativecode: ["x86_64"] }),
    ];

    const selected = selectFdroidBuild(builds);

    assert.equal(selected?.versionCode, 643);
  });

  test("a genuine single-build release is returned untouched, even across an older versionName in the list", () => {
    const builds = [
      build({ versionCode: 20, versionName: "26.08.1", nativecode: ["arm64-v8a", "x86_64"] }),
      build({ versionCode: 19, versionName: "26.07.0", nativecode: ["arm64-v8a"] }),
    ];

    const selected = selectFdroidBuild(builds);

    assert.equal(selected?.versionCode, 20);
  });

  test("preserves every other field on the returned build, not just versionCode", () => {
    const builds = [
      build({
        versionCode: 15589,
        versionName: "3.4.11",
        nativecode: ["x86_64"],
        apkName: "com.streetwriters.notesnook_15589.apk",
        hash: "wrong-hash",
      }),
      build({
        versionCode: 15588,
        versionName: "3.4.11",
        nativecode: ["arm64-v8a"],
        apkName: "com.streetwriters.notesnook_15588.apk",
        hash: "right-hash",
        size: 39505154,
      }),
    ];

    const selected = selectFdroidBuild(builds) as FdroidBuildLike & Record<string, unknown>;

    assert.equal(selected.apkName, "com.streetwriters.notesnook_15588.apk");
    assert.equal(selected.hash, "right-hash");
    assert.equal(selected.size, 39505154);
  });

  test("an empty build list returns undefined rather than throwing", () => {
    assert.equal(selectFdroidBuild([]), undefined);
  });
});
