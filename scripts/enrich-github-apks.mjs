/**
 * Automatic GitHub APK enrichment — the scheduled counterpart to the
 * existing manual "Import GitHub APK" admin button (see the completed
 * audit this script implements). This script decides nothing on its own:
 * it wires together already-completed, unmodified pieces and prints their
 * results —
 *
 *   selectEligibleApps() (lib/apk/github-apk-enrichment-store.ts)
 *   -> runEnrichmentBatch() (lib/apk/github-apk-enrichment-run.ts), which
 *      itself calls importGithubApkForApp() (lib/apk/github-release-import.ts,
 *      UNCHANGED) once per app and recordAttempt() (the store module,
 *      also UNCHANGED) for every outcome.
 *
 * This script has no per-status branching of its own at all — that logic
 * lives in lib/apk/github-apk-enrichment-run.ts, exercised directly by its
 * own tests, exactly like lib/metadata/play-discovery-pipeline.ts's
 * processDiscoveryCandidate() backs scripts/discover-play-apps.mjs.
 *
 *   node --env-file=.env.local scripts/enrich-github-apks.mjs
 *   node --env-file=.env.local scripts/enrich-github-apks.mjs -- --max=3
 *   MAX_ENRICHMENTS=3 node --env-file=.env.local scripts/enrich-github-apks.mjs
 *
 * NEVER publishes anything: every successful import is created with
 * published: false by importGithubApkForApp() itself, and nothing in this
 * script (or anything it calls) ever calls setVersionPublished(). NEVER
 * modifies a Play proposal's status — every read of play_import_proposals
 * anywhere in this chain (via selectEligibleApps()/resolveAppGithubSource())
 * is read-only.
 */
import { createClient } from "@supabase/supabase-js";

import { selectEligibleApps, DEFAULT_MAX_ENRICHMENTS } from "../lib/apk/github-apk-enrichment-store.ts";
import { runEnrichmentBatch } from "../lib/apk/github-apk-enrichment-run.ts";

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
};

const HELP_TEXT = `
Automatic GitHub APK enrichment — approved, GitHub-discovered, zero-version
apps get their latest GitHub Release APK imported as an unpublished build.

Usage:
  npm run enrich-github-apks
  npm run enrich-github-apks -- --max=<n>

Options:
  --max=<n>  Caps how many eligible apps this run will attempt — a cap, not
             a requirement. 0 attempted on a legitimate quiet day is a
             normal, successful outcome. Defaults to the MAX_ENRICHMENTS
             environment variable, or ${DEFAULT_MAX_ENRICHMENTS} if that is also unset.
  --help     Show this message.

What this never does:
  - Never publishes a version (published stays false for every import).
  - Never approves, rejects, or changes a Play proposal's status.
  - Never scrapes Google Play or bypasses Play protections.
  - Never uses an unofficial APK mirror.
  - Never retries a terminal outcome (package_mismatch, multiple_apk_assets,
    imported_unpublished, already_has_version) automatically.
`;

if (flag("help")) {
  console.log(HELP_TEXT);
  process.exit(0);
}

// ------------------------------------------------------------------- setup

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("NEXT_PUBLIC_SUPABASE_URL is missing from .env.local.");
if (!SERVICE_KEY) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.\n" +
      "  github_apk_enrichment_attempts, play_import_proposals, and\n" +
      "  play_discovery_candidates all have no anon RLS policy at all, so this\n" +
      "  unattended script needs the service role key, exactly like\n" +
      "  scripts/discover-play-apps.mjs's own writes. This key is read from the\n" +
      "  environment only — it must never reach browser or client-side code.",
  );
}

// Writes ONLY to github_apk_enrichment_attempts, and (via the completely
// unchanged importGithubApkForApp()) to Storage and versions — never to
// play_import_proposals, never to apps' own display fields. Local/CI use
// only, never shipped to a browser, exactly like every other importer
// script in this project.
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MAX_ENRICHMENTS = Number(value("max") ?? process.env.MAX_ENRICHMENTS ?? DEFAULT_MAX_ENRICHMENTS);

// GITHUB_TOKEN is optional (unauthenticated GitHub API access still works,
// just at a much lower rate limit) — never read or passed explicitly here:
// importGithubApkForApp()'s own default dependencies already read
// process.env.GITHUB_TOKEN internally when no override is given, exactly
// the same wiring this project's own real, controlled production
// verification already exercised for this feature.

async function main() {
  console.log(`\nAutomatic GitHub APK enrichment\n`);
  console.log(`  batch cap: ${MAX_ENRICHMENTS} (a cap, not a requirement — 0 eligible apps is a valid outcome)\n`);

  const eligible = await selectEligibleApps(supabase, { maxResults: MAX_ENRICHMENTS });
  console.log(`  eligible apps found: ${eligible.length}\n`);

  const summary = await runEnrichmentBatch(supabase, eligible);

  console.log("\n  Enrichment run summary");
  console.log(`  ----------------------`);
  console.log(`  eligible:             ${summary.eligible}`);
  console.log(`  processed:            ${summary.processed}`);
  console.log(`  imported:             ${summary.imported}`);
  console.log(`  no_apk:               ${summary.no_apk}`);
  console.log(`  no_release:           ${summary.no_release}`);
  console.log(`  mismatch:             ${summary.mismatch}`);
  console.log(`  failed:               ${summary.failed}`);
  console.log(`  already_had_version:  ${summary.already_had_version}`);

  console.log("\n  Every import above was created UNPUBLISHED. Nothing was published,");
  console.log("  and no Play proposal status was changed. An admin must publish manually.\n");
}

main().catch((error) => {
  console.error("\n  Enrichment run failed unexpectedly:", error?.message ?? error, "\n");
  process.exit(1);
});
