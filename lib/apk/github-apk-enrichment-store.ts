/**
 * The Supabase I/O layer for public.github_apk_enrichment_attempts —
 * bookkeeping for the scheduled GitHub APK enrichment job
 * (scripts/enrich-github-apks.mjs). Every function here writes to exactly
 * one table (github_apk_enrichment_attempts) or reads a small, bounded set
 * of others purely to decide eligibility — mirrors
 * lib/metadata/play-discovery-store.ts's own scope discipline.
 *
 * This module NEVER imports or calls anything from
 * lib/apk/github-release-import.ts directly — it only records what that
 * module's own, unmodified importGithubApkForApp() already decided. It also
 * never touches apps/versions/Storage itself; findOrCreateApp,
 * createVersion, and the download/validate/parse pipeline all remain
 * exactly as they are.
 *
 * RLS on github_apk_enrichment_attempts has no anon policy at all (see its
 * own migration) — every function here must be called with a service-role
 * or authenticated-admin client, never the public anon client, exactly like
 * lib/metadata/play-discovery-store.ts's own requirement.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAppGithubSource } from "./app-github-source.ts";

export type EnrichmentStatus =
  | "no_github_source"
  | "github_repo_not_found"
  | "no_release"
  | "no_apk_asset"
  | "multiple_apk_assets"
  | "package_mismatch"
  | "import_failed"
  | "already_has_version"
  | "imported_unpublished";

/**
 * A status that will never resolve itself on its own — importing again
 * would either repeat a genuine safety rejection (package_mismatch) or
 * require a human decision the scheduled job must never make on its own
 * (multiple_apk_assets), or there is simply nothing left to do
 * (imported_unpublished, already_has_version). The selection query below
 * never re-selects an app sitting at one of these.
 */
const TERMINAL_STATUSES: ReadonlySet<EnrichmentStatus> = new Set([
  "imported_unpublished",
  "already_has_version",
  "package_mismatch",
  "multiple_apk_assets",
]);

/**
 * A status that plausibly changes on its own with time — a repository
 * might gain a release, a release might gain an APK asset, a rate limit or
 * network hiccup clears up. Eligible for a retry once the cooldown
 * (DEFAULT_RETRY_COOLDOWN_HOURS) has elapsed since the last attempt.
 */
const RETRYABLE_STATUSES: ReadonlySet<EnrichmentStatus> = new Set([
  "github_repo_not_found",
  "no_release",
  "no_apk_asset",
  "import_failed",
]);

export const DEFAULT_RETRY_COOLDOWN_HOURS = 24;
export const DEFAULT_MAX_ENRICHMENTS = 10;

export type EnrichmentAttemptRow = {
  id: string;
  app_id: string;
  status: EnrichmentStatus;
  message: string | null;
  owner_repo: string | null;
  version_id: string | null;
  attempt_count: number;
  last_attempted_at: string;
  created_at: string;
};

export const ENRICHMENT_ATTEMPT_SELECT =
  "id, app_id, status, message, owner_repo, version_id, attempt_count, last_attempted_at, created_at";

function isUniqueViolation(
  error: { message?: string | null; code?: string | null } | null | undefined,
  constraint: string,
): boolean {
  if (!error) return false;
  return error.code === "23505" || Boolean(error.message?.includes(constraint));
}

/** The current (only) attempt row for one app, or null if it has never been attempted. */
export async function getAttempt(
  supabase: SupabaseClient,
  appId: string,
): Promise<EnrichmentAttemptRow | null> {
  const { data, error } = await supabase
    .from("github_apk_enrichment_attempts")
    .select(ENRICHMENT_ATTEMPT_SELECT)
    .eq("app_id", appId)
    .maybeSingle<EnrichmentAttemptRow>();
  if (error) throw error;
  return data;
}

export type RecordAttemptInput = {
  appId: string;
  status: EnrichmentStatus;
  message?: string | null;
  ownerRepo?: string | null;
  versionId?: string | null;
};

async function writeAttempt(
  supabase: SupabaseClient,
  input: RecordAttemptInput,
  attemptCount: number,
  now: string,
): Promise<void> {
  const { error } = await supabase
    .from("github_apk_enrichment_attempts")
    .update({
      status: input.status,
      message: input.message ?? null,
      owner_repo: input.ownerRepo ?? null,
      version_id: input.versionId ?? null,
      attempt_count: attemptCount,
      last_attempted_at: now,
    })
    .eq("app_id", input.appId);
  if (error) throw error;
}

/**
 * Records the outcome of one enrichment attempt for one app — the single
 * write path for github_apk_enrichment_attempts, covering both "this app
 * has never been attempted before" (inserts attempt_count=1) and "this app
 * already has a row" (updates it in place, incrementing attempt_count) —
 * there is deliberately only ever one row per app_id (see the table's own
 * UNIQUE(app_id) constraint), never a growing log, since only the most
 * recent decision is ever actually needed by the selection query or the
 * admin UI.
 *
 * Race-safe the same way lib/apk/save-build.ts's findOrCreateApp() and
 * lib/metadata/play-proposal-store.ts's insertProposal() already are:
 * insert first, and on a unique-violation (a concurrent run's attempt for
 * the same app_id landed first), recover by updating whichever row
 * actually won rather than erroring out or leaving this attempt
 * unrecorded.
 */
export async function recordAttempt(
  supabase: SupabaseClient,
  input: RecordAttemptInput,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getAttempt(supabase, input.appId);

  if (existing) {
    await writeAttempt(supabase, input, existing.attempt_count + 1, now);
    return;
  }

  const { error } = await supabase.from("github_apk_enrichment_attempts").insert({
    app_id: input.appId,
    status: input.status,
    message: input.message ?? null,
    owner_repo: input.ownerRepo ?? null,
    version_id: input.versionId ?? null,
    attempt_count: 1,
    last_attempted_at: now,
  });

  if (error) {
    if (isUniqueViolation(error, "github_apk_enrichment_attempts_app_id_key")) {
      const winner = await getAttempt(supabase, input.appId);
      if (winner) {
        await writeAttempt(supabase, input, winner.attempt_count + 1, now);
        return;
      }
    }
    throw error;
  }
}

export type EligibleApp = {
  appId: string;
  packageName: string;
  name: string;
  ownerRepo: string;
};

export type SelectEligibleAppsOptions = {
  maxResults?: number;
  /** Hours a retryable attempt must sit before it becomes eligible again. */
  cooldownHours?: number;
  /** Injectable for deterministic tests; defaults to the real current time. */
  now?: Date;
};

/**
 * Finds apps the scheduled enrichment job should attempt next.
 *
 * Eligibility, in order:
 *   1. The app's package traces back to an applied `new_app` Play proposal
 *      at all (the only apps that could ever have a GitHub source — starts
 *      from play_import_proposals rather than scanning every app in the
 *      catalogue, which would be both wasteful and pointless for an
 *      F-Droid-sourced or manually-added app).
 *   2. A GitHub source actually resolves for it — reuses
 *      lib/apk/app-github-source.ts's resolveAppGithubSource() UNCHANGED;
 *      this function never re-derives that join itself.
 *   3. The app currently has ZERO versions — an app with any version is
 *      never re-attempted by this scheduled path, regardless of how that
 *      version got there (manual import, an earlier enrichment run, or
 *      anything else). This is re-checked here even though
 *      importGithubApkForApp() enforces the same rule itself, purely so a
 *      batch run doesn't waste a GitHub API call finding that out one app
 *      at a time.
 *   4. No TERMINAL attempt already exists for it (imported_unpublished,
 *      already_has_version, package_mismatch, multiple_apk_assets) — never
 *      blindly retried.
 *   5. If a RETRYABLE attempt exists (github_repo_not_found, no_release,
 *      no_apk_asset, import_failed), at least `cooldownHours` (default
 *      DEFAULT_RETRY_COOLDOWN_HOURS) must have elapsed since
 *      last_attempted_at — never hammering the same repo every run.
 *
 * Proposals are de-duplicated by package_name (most recent applied first,
 * via play_import_proposals' own applied_at ordering) before any of the
 * above is even checked, so a package with more than one applied proposal
 * in its history is still only ever considered once per run.
 *
 * Capped at `maxResults` (default DEFAULT_MAX_ENRICHMENTS) real candidates
 * — a cap, not a requirement; zero eligible apps on a given run is a
 * normal, successful outcome, exactly like the existing discovery
 * pipeline's own "0 proposals is fine" philosophy.
 */
export async function selectEligibleApps(
  supabase: SupabaseClient,
  options: SelectEligibleAppsOptions = {},
): Promise<EligibleApp[]> {
  const maxResults = options.maxResults ?? DEFAULT_MAX_ENRICHMENTS;
  const cooldownHours = options.cooldownHours ?? DEFAULT_RETRY_COOLDOWN_HOURS;
  const now = options.now ?? new Date();
  const cooldownMs = cooldownHours * 60 * 60 * 1000;

  if (maxResults <= 0) return [];

  const { data: proposals, error: proposalsError } = await supabase
    .from("play_import_proposals")
    .select("package_name")
    .eq("proposal_type", "new_app")
    .eq("status", "applied")
    .order("applied_at", { ascending: false });
  if (proposalsError) throw proposalsError;

  const seenPackages = new Set<string>();
  const eligible: EligibleApp[] = [];

  for (const proposal of proposals ?? []) {
    if (eligible.length >= maxResults) break;

    const packageName = proposal.package_name as string;
    if (seenPackages.has(packageName)) continue;
    seenPackages.add(packageName);

    const ownerRepo = await resolveAppGithubSource(supabase, packageName);
    if (!ownerRepo) continue;

    const { data: app, error: appError } = await supabase
      .from("apps")
      .select("id, package_name, name")
      .eq("package_name", packageName)
      .maybeSingle<{ id: string; package_name: string; name: string }>();
    if (appError) throw appError;
    if (!app) continue;

    const { data: versions, error: versionsError } = await supabase
      .from("versions")
      .select("id")
      .eq("app_id", app.id);
    if (versionsError) throw versionsError;
    if (Array.isArray(versions) && versions.length > 0) continue;

    const attempt = await getAttempt(supabase, app.id);
    if (attempt) {
      if (TERMINAL_STATUSES.has(attempt.status)) continue;
      if (RETRYABLE_STATUSES.has(attempt.status)) {
        const lastAttemptMs = Date.parse(attempt.last_attempted_at);
        if (Number.isFinite(lastAttemptMs) && now.getTime() - lastAttemptMs < cooldownMs) continue;
      }
    }

    eligible.push({ appId: app.id, packageName: app.package_name, name: app.name, ownerRepo });
  }

  return eligible;
}

export { TERMINAL_STATUSES, RETRYABLE_STATUSES };
