import { describePermissions, type PermissionInfo } from "./permissions.ts";

/**
 * Pure, per-build derived data for the Version History section
 * (components/VersionHistory.tsx) — pulled out so it can be unit-tested
 * without a React render, which this project has no harness for (JSX/.tsx
 * needs a transform `node --test` doesn't provide; see lib/version-history.test.ts).
 *
 * Nothing here duplicates lib/permissions.ts's label/description mapping —
 * this only decides *whether* a build's permissions are worth a summary line
 * and builds that line's text; describePermissions() remains the single
 * source of truth for what each permission actually means.
 */

export type VersionPermissionsSummary = {
  described: PermissionInfo[];
  sensitiveCount: number;
  /** e.g. "7 permissions · 2 worth reviewing" */
  summaryText: string;
};

/**
 * Null when the build has zero permissions — callers must render nothing in
 * that case (no "0 permissions" line, no empty list), never a placeholder.
 */
export function summarizeVersionPermissions(
  permissions: readonly string[] | null | undefined,
): VersionPermissionsSummary | null {
  const described = describePermissions([...(permissions ?? [])]);
  if (described.length === 0) return null;

  const sensitiveCount = described.filter((p) => p.sensitive).length;
  const summaryText =
    `${described.length} permission${described.length === 1 ? "" : "s"}` +
    (sensitiveCount > 0 ? ` · ${sensitiveCount} worth reviewing` : "");

  return { described, sensitiveCount, summaryText };
}

/**
 * True only for a genuine, finite target SDK value. A build with no target
 * SDK on record must never render an "Unknown" placeholder — the caller
 * simply omits the fact when this returns false.
 */
export function hasTargetSdk(
  targetSdk: number | null | undefined,
): targetSdk is number {
  return typeof targetSdk === "number" && Number.isFinite(targetSdk);
}
