/**
 * Pure decision logic for P2-1 Phase C: proposing `apps.license` and
 * `versions.target_sdk` values from the live F-Droid index against the
 * catalogue's current rows, without ever writing anything.
 *
 * Mirrors lib/apk/fdroid-description.ts's shape (a runner script owns the
 * database and the index fetch; this module only decides what to do with one
 * row's already-extracted values) so the dry-run script can stay a thin
 * wrapper and this logic can be unit-tested without a database or the
 * network.
 *
 * Two independent decisions, because the two fields have different
 * provenance rules (see lib/metadata/provenance.ts and P2-1's audit):
 *
 *   - license is app-level and MAY be a manual override — a row listed in
 *     apps.manual_fields is never proposed a new value, matching
 *     planDescriptionBackfill's own manual-override gate.
 *   - target_sdk is per-build and purely mechanical, like
 *     min_android_version — it has no manual-override concept at all, so
 *     there is no such gate here.
 *
 * Both decisions distinguish "propose" (current value is null, F-Droid has
 * one) from "conflict" (current value is non-null and disagrees with
 * F-Droid) from "match" (already agrees) from "skip" (nothing usable).
 * Phase C never acts on any of these — it only classifies and counts them so
 * a human can review before any future apply phase exists.
 */

// --------------------------------------------------------------- license

export type FdroidAppMatchStatus = "matched" | "not-in-index";

export type LicenseBackfillInput = {
  /** The row's current apps.license value, or null. */
  currentLicense: string | null;
  /** apps.manual_fields for this row. */
  manualFields: readonly string[] | null;
  /** Whether this app's package_name was found in the current F-Droid index. */
  matchStatus: FdroidAppMatchStatus;
  /** licenseFromFdroidApp() on the matched index entry — null if not matched or F-Droid has none. */
  fdroidLicense: string | null;
};

export type LicenseBackfillDecision =
  | { action: "propose"; reason: "license-filled" }
  | { action: "match"; reason: "already-matching" }
  | { action: "conflict"; reason: "existing-license-differs" }
  | { action: "skip"; reason: "manual-override" }
  | { action: "skip"; reason: "no-fdroid-license" }
  | { action: "skip"; reason: "not-in-fdroid-index" };

export const LICENSE_FIELD = "license";

/** True when apps.manual_fields marks license as a human override. */
export function hasManualLicense(manualFields: readonly string[] | null | undefined): boolean {
  return (manualFields ?? []).includes(LICENSE_FIELD);
}

/**
 * The complete, pure decision for one app's license, in a fixed order:
 *   1. not found in the current F-Droid index -> nothing authoritative to compare
 *   2. manual_fields has "license"            -> frozen, never proposed
 *   3. F-Droid has no usable license          -> nothing to propose
 *   4. current is null                        -> propose (fill)
 *   5. current equals F-Droid's value         -> already matching
 *   6. current disagrees with F-Droid         -> conflict, flagged for review
 */
export function planLicenseBackfill(input: LicenseBackfillInput): LicenseBackfillDecision {
  if (input.matchStatus === "not-in-index") {
    return { action: "skip", reason: "not-in-fdroid-index" };
  }
  if (hasManualLicense(input.manualFields)) {
    return { action: "skip", reason: "manual-override" };
  }
  if (!input.fdroidLicense) {
    return { action: "skip", reason: "no-fdroid-license" };
  }
  if (input.currentLicense === null) {
    return { action: "propose", reason: "license-filled" };
  }
  if (input.currentLicense === input.fdroidLicense) {
    return { action: "match", reason: "already-matching" };
  }
  return { action: "conflict", reason: "existing-license-differs" };
}

// ------------------------------------------------------------- target_sdk

export type FdroidBuildMatchStatus = "matched" | "no-matching-build" | "not-in-fdroid-index";

export type TargetSdkBackfillInput = {
  /** The row's current versions.target_sdk value, or null. */
  currentTargetSdk: number | null;
  /** Whether a build with this version's exact version_code was found. */
  matchStatus: FdroidBuildMatchStatus;
  /** targetSdkFromFdroidBuild() on the matched build entry — null if not matched or F-Droid has none. */
  fdroidTargetSdk: number | null;
};

export type TargetSdkBackfillDecision =
  | { action: "propose"; reason: "target-sdk-filled" }
  | { action: "match"; reason: "already-matching" }
  | { action: "conflict"; reason: "existing-target-sdk-differs" }
  | { action: "skip"; reason: "no-fdroid-target-sdk" }
  | { action: "skip"; reason: "no-matching-build" }
  | { action: "skip"; reason: "not-in-fdroid-index" };

/**
 * The complete, pure decision for one version's target_sdk. No
 * manual-override gate — target_sdk is deliberately not in
 * OVERRIDABLE_FIELDS (see lib/metadata/provenance.ts), matching
 * min_android_version's existing precedent of always trusting the
 * authoritative source.
 *
 *   1. app not in the current F-Droid index         -> nothing to compare
 *   2. no build with this exact version_code exists -> nothing to compare
 *   3. F-Droid has no usable targetSdkVersion        -> nothing to propose
 *   4. current is null                               -> propose (fill)
 *   5. current equals F-Droid's value                -> already matching
 *   6. current disagrees with F-Droid                 -> conflict, flagged
 */
export function planTargetSdkBackfill(input: TargetSdkBackfillInput): TargetSdkBackfillDecision {
  if (input.matchStatus === "not-in-fdroid-index") {
    return { action: "skip", reason: "not-in-fdroid-index" };
  }
  if (input.matchStatus === "no-matching-build") {
    return { action: "skip", reason: "no-matching-build" };
  }
  if (input.fdroidTargetSdk === null) {
    return { action: "skip", reason: "no-fdroid-target-sdk" };
  }
  if (input.currentTargetSdk === null) {
    return { action: "propose", reason: "target-sdk-filled" };
  }
  if (input.currentTargetSdk === input.fdroidTargetSdk) {
    return { action: "match", reason: "already-matching" };
  }
  return { action: "conflict", reason: "existing-target-sdk-differs" };
}

// ------------------------------------------------------------ build match

/**
 * Minimal shape of one F-Droid index-v1 build entry this module reads.
 * Callers pass their real build objects straight through.
 */
export type FdroidIndexBuild = {
  versionCode?: unknown;
  targetSdkVersion?: unknown;
};

/**
 * Finds the build entry whose versionCode exactly matches an existing
 * catalogue version row's version_code. Deliberately NOT selectFdroidBuild
 * (which picks the best build for a *new* import) — an existing row already
 * corresponds to one specific build, so it must be compared against that
 * exact build, not whichever one a fresh import would currently prefer.
 */
export function findMatchingFdroidBuild<T extends FdroidIndexBuild>(
  builds: readonly T[],
  versionCode: number,
): T | undefined {
  return builds.find((b) => Number(b.versionCode) === versionCode);
}
