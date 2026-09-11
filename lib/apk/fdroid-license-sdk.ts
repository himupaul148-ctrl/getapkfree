/**
 * Pure field extraction for the two P2-1 facts F-Droid's index already
 * carries directly, so scripts/import-fdroid.mjs can stay a thin wrapper and
 * this logic can be unit-tested without the network or a database.
 *
 * license: an app-level SPDX string, lives on the index's `app` entry
 * (index.apps[i].license) — same object the importer already reads
 * authorName/categories/localized from.
 *
 * target_sdk: a per-build integer, lives on the index's `build` entry
 * (index.packages[pkg][i].targetSdkVersion) — the same object
 * `minSdkVersion` already comes from. Deliberately NOT run through
 * releaseFromApiLevel()/API_TO_RELEASE: target SDK is conventionally
 * referred to by its raw numeric API level everywhere in the Android
 * ecosystem, unlike min_android_version's device-compatibility framing.
 */

export type FdroidAppLicenseLike = {
  license?: unknown;
};

export type FdroidBuildTargetSdkLike = {
  targetSdkVersion?: unknown;
};

/** F-Droid's own value when present and non-empty; null otherwise. Never inferred. */
export function licenseFromFdroidApp(app: FdroidAppLicenseLike): string | null {
  const license = String(app.license ?? "").trim();
  return license || null;
}

/** The raw numeric API level when present and valid; null otherwise. Never converted to a release string. */
export function targetSdkFromFdroidBuild(build: FdroidBuildTargetSdkLike): number | null {
  const level = Number(build.targetSdkVersion);
  return Number.isFinite(level) && level > 0 ? level : null;
}
