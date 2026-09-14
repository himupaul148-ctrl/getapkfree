/**
 * The per-batch orchestration for automatic GitHub APK enrichment,
 * extracted from scripts/enrich-github-apks.mjs so it can be exercised
 * directly by tests with every dependency faked — mirrors
 * lib/apk/import-pipeline.ts's runApkUrlImport() and
 * lib/apk/verify-version.ts's runVersionVerify() in being the actual
 * "run*" logic a thin script/route just wires up.
 *
 * Calls lib/apk/github-release-import.ts's importGithubApkForApp()
 * UNCHANGED (never re-implemented, never duplicated) once per eligible
 * app, and records every outcome via
 * lib/apk/github-apk-enrichment-store.ts's recordAttempt(), also
 * UNCHANGED. One app's unexpected failure never stops the batch — every
 * other app is still attempted, exactly like
 * scripts/discover-play-apps.mjs's own per-candidate try/catch.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  importGithubApkForApp as importGithubApkForAppImpl,
  type GithubApkImportResult,
} from "./github-release-import.ts";
import {
  recordAttempt as recordAttemptImpl,
  type EligibleApp,
  type RecordAttemptInput,
} from "./github-apk-enrichment-store.ts";

export type EnrichmentSummary = {
  eligible: number;
  processed: number;
  imported: number;
  no_apk: number;
  no_release: number;
  mismatch: number;
  failed: number;
  already_had_version: number;
};

export type EnrichmentRunDeps = {
  importGithubApkForApp: (
    supabase: SupabaseClient,
    targetApp: { id: string; packageName: string },
  ) => Promise<GithubApkImportResult>;
  recordAttempt: (supabase: SupabaseClient, input: RecordAttemptInput) => Promise<void>;
  /** One line per app outcome — defaults to console.log; tests capture instead. */
  log: (line: string) => void;
};

export const defaultEnrichmentRunDeps: EnrichmentRunDeps = {
  importGithubApkForApp: importGithubApkForAppImpl,
  recordAttempt: recordAttemptImpl,
  log: (line: string) => console.log(line),
};

function newSummary(eligibleCount: number): EnrichmentSummary {
  return {
    eligible: eligibleCount,
    processed: 0,
    imported: 0,
    no_apk: 0,
    no_release: 0,
    mismatch: 0,
    failed: 0,
    already_had_version: 0,
  };
}

type CounterKey = keyof Omit<EnrichmentSummary, "eligible" | "processed">;

/**
 * Everything about one outcome EXCEPT whether it actually got recorded —
 * the log line, which summary counter it belongs to, and the exact
 * recordAttempt() payload. Kept separate from actually incrementing the
 * counter or calling recordAttempt() so a recordAttempt() failure can
 * never leave an app double-counted (once for its real outcome, again for
 * `failed`) — see runEnrichmentBatch()'s own doc comment.
 */
function describeOutcome(
  app: EligibleApp,
  result: GithubApkImportResult,
): { logLine: string; counter: CounterKey; input: RecordAttemptInput } {
  switch (result.status) {
    case "imported_unpublished":
      return {
        logLine: `  [${app.name}] imported_unpublished (v${result.versionName}, code ${result.versionCode}, scan: ${result.scanStatus})`,
        counter: "imported",
        input: {
          appId: app.appId,
          status: result.status,
          ownerRepo: result.ownerRepo,
          versionId: result.versionId,
          message: `Imported ${result.versionName} (code ${result.versionCode}) from ${result.ownerRepo}@${result.tagName}.`,
        },
      };

    case "no_apk_asset":
      return {
        logLine: `  [${app.name}] no_apk_asset (${result.ownerRepo}@${result.tagName})`,
        counter: "no_apk",
        input: {
          appId: app.appId,
          status: result.status,
          ownerRepo: result.ownerRepo,
          message: `Release ${result.tagName} has no APK asset.`,
        },
      };

    case "no_release":
      return {
        logLine: `  [${app.name}] no_release (${result.ownerRepo})`,
        counter: "no_release",
        input: { appId: app.appId, status: result.status, ownerRepo: result.ownerRepo, message: "No GitHub Release exists yet." },
      };

    case "package_mismatch":
      return {
        logLine: `  [${app.name}] package_mismatch (expected ${result.expectedPackageName}, got ${result.actualPackageName ?? "none"})`,
        counter: "mismatch",
        input: {
          appId: app.appId,
          status: result.status,
          ownerRepo: result.ownerRepo,
          message: `APK package "${result.actualPackageName ?? "none"}" does not match "${result.expectedPackageName}".`,
        },
      };

    case "already_has_version":
      return {
        logLine: `  [${app.name}] already_has_version`,
        counter: "already_had_version",
        input: {
          appId: app.appId,
          status: result.status,
          ownerRepo: result.ownerRepo ?? null,
          message: "This app already has a version.",
        },
      };

    case "github_repo_not_found":
      return {
        logLine: `  [${app.name}] github_repo_not_found (${result.ownerRepo})`,
        counter: "failed",
        input: {
          appId: app.appId,
          status: result.status,
          ownerRepo: result.ownerRepo,
          message: "The linked GitHub repository could not be found.",
        },
      };

    case "multiple_apk_assets":
      return {
        logLine: `  [${app.name}] multiple_apk_assets (${result.assets.length} candidates, ${result.ownerRepo}@${result.tagName})`,
        counter: "failed",
        input: {
          appId: app.appId,
          status: result.status,
          ownerRepo: result.ownerRepo,
          message: `${result.assets.length} APK assets found — needs manual selection in the admin UI.`,
        },
      };

    case "no_github_source":
      // Should not normally occur — selectEligibleApps() already filters to
      // apps with a resolvable source — but handled defensively rather
      // than assumed impossible.
      return {
        logLine: `  [${app.name}] no_github_source`,
        counter: "failed",
        input: { appId: app.appId, status: result.status, message: "No GitHub source is linked to this app." },
      };

    case "import_failed":
    default:
      return {
        logLine: `  [${app.name}] import_failed: ${result.message ?? "unknown error"}`,
        counter: "failed",
        input: {
          appId: app.appId,
          status: "import_failed",
          ownerRepo: app.ownerRepo,
          message: result.message ?? "Import failed.",
        },
      };
  }
}

/**
 * Logs and records one app's outcome, then increments exactly ONE summary
 * counter — but only once recordAttempt() has actually succeeded. If
 * recordAttempt() throws, no counter is incremented here at all; the
 * caller's own try/catch (runEnrichmentBatch) is what counts that app as
 * `failed`, so every app ever contributes to exactly one bucket, never
 * two.
 */
async function recordOutcome(
  supabase: SupabaseClient,
  app: EligibleApp,
  result: GithubApkImportResult,
  summary: EnrichmentSummary,
  deps: EnrichmentRunDeps,
): Promise<void> {
  const { logLine, counter, input } = describeOutcome(app, result);
  deps.log(logLine);
  await deps.recordAttempt(supabase, input);
  summary[counter]++;
}

/**
 * Runs the whole batch: one importGithubApkForApp() + one recordAttempt()
 * call per eligible app, sequentially (never in parallel — the same
 * GitHub-API-consciousness scripts/discover-play-apps.mjs already commits
 * to for its own search pagination). An unexpected throw from either call
 * (e.g. a transient database error) is caught, logged, and counted as
 * `failed` — it never stops the loop; every remaining app is still
 * attempted.
 */
export async function runEnrichmentBatch(
  supabase: SupabaseClient,
  eligibleApps: EligibleApp[],
  overrides: Partial<EnrichmentRunDeps> = {},
): Promise<EnrichmentSummary> {
  const deps: EnrichmentRunDeps = { ...defaultEnrichmentRunDeps, ...overrides };
  const summary = newSummary(eligibleApps.length);

  for (const app of eligibleApps) {
    summary.processed++;
    try {
      const result = await deps.importGithubApkForApp(supabase, { id: app.appId, packageName: app.packageName });
      await recordOutcome(supabase, app, result, summary, deps);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      deps.log(`  [${app.name}] ERROR: ${message}`);
      summary.failed++;
    }
  }

  return summary;
}
