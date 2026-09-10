/**
 * Picks which F-Droid build to import for a package's newest release.
 *
 * F-Droid's index lists every build for a package newest-first by
 * versionCode, and the importer used to just take the first one. That works
 * for the common case — one build per release, either with no native code
 * or with every ABI bundled into a single "fat" APK — but some apps instead
 * publish a separate APK per CPU architecture for the very same release,
 * each with its own distinct versionCode. F-Droid's own ordering of those
 * splits is not ABI-aware, so the "first" one is whichever arch happened to
 * get the highest versionCode — for Notesnook 3.4.11 that's an x86_64-only
 * build, which won't run on the arm64/armeabi phones most real users have.
 *
 * This groups the newest release's builds by versionName (every per-arch
 * split of one release shares it, even though their versionCodes differ)
 * and, only when that group actually has more than one build, prefers
 * arm64-v8a, then armeabi-v7a. A single-build release — universal APK or no
 * native code at all — is returned untouched; the ABI preference only ever
 * applies when there is a genuine choice to make.
 */

/**
 * The handful of fields this module reads. Callers pass their real F-Droid
 * build objects straight through — `<T extends FdroidBuildLike>` below keeps
 * every other field (apkName, size, hash, ...) intact on the returned build.
 */
export type FdroidBuildLike = {
  versionCode: number;
  versionName: string;
  nativecode?: readonly string[] | null;
};

/** Checked in this order; the first ABI present in the release wins. */
const ABI_PREFERENCE = ["arm64-v8a", "armeabi-v7a"] as const;

export function selectFdroidBuild<T extends FdroidBuildLike>(
  builds: readonly T[],
): T | undefined {
  if (builds.length === 0) return undefined;

  const newest = builds[0];
  const sameRelease = builds.filter((b) => b.versionName === newest.versionName);

  // Only one build for this release — nothing to choose between.
  if (sameRelease.length <= 1) return newest;

  for (const abi of ABI_PREFERENCE) {
    const match = sameRelease.find(
      (b) => Array.isArray(b.nativecode) && b.nativecode.includes(abi),
    );
    if (match) return match;
  }

  // None of the splits declare a preferred ABI (e.g. x86/x86_64 only) —
  // fall back to the newest, exactly the pre-existing behavior.
  return newest;
}
