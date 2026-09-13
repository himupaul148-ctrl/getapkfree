/**
 * Daily New-App Discovery — the thin CLI entry point that ties together
 * the already-completed pipeline:
 *
 *   GitHub discovery (lib/metadata/github-discovery.ts)
 *   -> Play URL resolution (lib/metadata/github-play-resolution.ts)
 *   -> Play metadata verification (lib/metadata/fetchers.ts's fetchMetadata())
 *   -> new_app proposal creation (lib/metadata/play-discovery-pipeline.ts,
 *      lib/metadata/play-proposal-store.ts)
 *
 * This script decides nothing about WHAT counts as a good candidate or
 * WHAT a proposal should contain — every one of those decisions already
 * lives in the modules above, unmodified. This script only wires them
 * together with a real Supabase client and a real GitHub token, and
 * prints a run summary.
 *
 *   npm run discover-play-apps
 *   npm run discover-play-apps -- --max=5
 *   npm run discover-play-apps -- --since=2026-09-01
 *
 * Writes ONLY to public.play_discovery_candidates and
 * public.play_import_proposals — every proposal this creates is a
 * 'pending' new_app proposal, exactly like every other caller of
 * proposeForPackage(). Nothing here approves, rejects, applies, or
 * publishes anything, and nothing here downloads an APK.
 */
import { createClient } from "@supabase/supabase-js";

import { discoverGithubCandidates } from "../lib/metadata/github-discovery.ts";
import { contentFromCandidate } from "../lib/metadata/github-play-resolution.ts";
import { processDiscoveryCandidate } from "../lib/metadata/play-discovery-pipeline.ts";
import {
  findDiscoveryCandidate,
  findLatestDiscoveredAt,
  insertDiscoveryCandidate,
  updateDiscoveryCandidate,
} from "../lib/metadata/play-discovery-store.ts";
import { findAnyProposalForPackage, findCurrentApp, proposeForPackage } from "../lib/metadata/play-proposal-store.ts";
import { fetchMetadata } from "../lib/metadata/fetchers.ts";

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
};

const HELP_TEXT = `
Daily Play app discovery — GitHub candidates -> Play verification -> pending proposals

Usage:
  npm run discover-play-apps
  npm run discover-play-apps -- --max=<n>
  npm run discover-play-apps -- --since=<ISO date>

Options:
  --max=<n>     Caps how many candidates this run will process — a cap, not
                a requirement. 0 proposals on a legitimate low-quality day is
                a normal, successful outcome. Defaults to the MAX_CANDIDATES
                environment variable, or 10 if that is also unset.
  --since=<ISO date>
                Overrides the search window's start. Without this, the run
                searches since the last recorded discovery (the most recent
                play_discovery_candidates.discovered_at for source='github'),
                so a daily run never rescans the same historical window
                twice. On the very first run ever (no prior rows), falls
                back to a fixed lookback window.
  --help        Show this message.

What this never does:
  - Never approves, rejects, applies, or publishes a proposal.
  - Never writes to apps, versions, or Storage.
  - Never downloads an APK.
  - Never calls a private/internal Play or GitHub API — only the public
    GitHub REST Search API and the same public Play listing page fetch
    every other part of this project already uses.
`;

if (flag("help")) {
  console.log(HELP_TEXT);
  process.exit(0);
}

// ------------------------------------------------------------------- setup

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("NEXT_PUBLIC_SUPABASE_URL is missing from .env.local.");
if (!SERVICE_KEY) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.\n" +
      "  play_discovery_candidates and play_import_proposals both have no anon\n" +
      "  RLS policy at all, so this unattended script needs the service role key,\n" +
      "  exactly like scripts/import-play-metadata.mjs's own writes.",
  );
}

// Writes to play_discovery_candidates/play_import_proposals — local/CI use
// only, never shipped to a browser, exactly like every other importer script
// in this project.
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MAX_CANDIDATES = Number(value("max") ?? process.env.MAX_CANDIDATES ?? 10);

// A daily run's own fallback window when no prior checkpoint exists yet —
// slightly over 24h so a run that starts a little late (or a scheduler
// hiccup) still can't leave a gap. Only ever used once, on the very first
// run; every run after that uses the real checkpoint instead.
const FIRST_RUN_LOOKBACK_HOURS = 26;

// GITHUB_TOKEN is optional (unauthenticated Search API access still works,
// just at a much lower rate limit) but never hardcoded and never printed —
// only ever read from the environment and passed as a header.
const githubHeaders = {
  "User-Agent": "GetApkFree-Daily-Discovery",
  Accept: "application/vnd.github+json",
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
};

async function resolveSinceBoundary(now) {
  const override = value("since");
  if (override) return override;
  const checkpoint = await findLatestDiscoveredAt(supabase, "github");
  if (checkpoint) return checkpoint;
  return new Date(now.getTime() - FIRST_RUN_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
}

function printRejections(rejected) {
  for (const r of rejected) {
    console.log(`  ✗ ${r.source_ref}`);
    console.log(`      ${r.reasons.join("; ")}`);
  }
}

function printDiscoveryErrors(errors) {
  for (const e of errors) {
    console.log(`  ! ${e.kind}${"status" in e ? ` (${e.status})` : ""}: ${e.message}`);
  }
}

async function main() {
  const now = new Date();
  const since = await resolveSinceBoundary(now);

  console.log(`\nDaily Play app discovery\n`);
  console.log(`  search window:   since ${since}`);
  console.log(`  candidate cap:   ${MAX_CANDIDATES} (a cap, not a requirement — 0 proposals is a valid outcome)\n`);

  const report = await discoverGithubCandidates({
    fetchFn: fetch,
    since,
    now,
    maxResults: MAX_CANDIDATES,
    maxPages: 3,
    headers: githubHeaders,
  });

  console.log(`  pages fetched from GitHub Search API: ${report.pagesFetched}`);
  console.log(`  candidates examined and rejected:     ${report.rejected.length}`);
  printRejections(report.rejected);
  console.log(`  discovery-layer errors:               ${report.errors.length}`);
  printDiscoveryErrors(report.errors);
  console.log(`  candidates passing hard filters:      ${report.candidates.length}\n`);

  let proposed = 0;
  let disqualified = 0;
  let skippedTerminal = 0;
  let pipelineErrors = 0;

  for (const found of report.candidates) {
    // The UNIQUE(source, source_ref) constraint is the real, authoritative
    // dedup guard — insert first; on a conflict, load the existing row
    // instead of ever creating a second one for the same repo.
    let row;
    try {
      row = await insertDiscoveryCandidate(supabase, {
        source: found.source,
        source_ref: found.source_ref,
        candidate_name: found.candidate_name,
        score: found.score,
      });
      console.log(`  + recorded new discovery candidate: ${found.source_ref}`);
    } catch (caught) {
      const isDuplicate =
        caught?.code === "23505" || String(caught?.message ?? "").includes("play_discovery_candidates_source_ref_unique");
      if (!isDuplicate) {
        console.log(`  ✗ FAILED to record ${found.source_ref}: ${caught?.message ?? caught}`);
        pipelineErrors++;
        continue;
      }
      row = await findDiscoveryCandidate(supabase, found.source, found.source_ref);
      console.log(`  = already known: ${found.source_ref} (status: ${row?.status ?? "unknown"})`);
    }
    if (!row) {
      pipelineErrors++;
      continue;
    }

    const deps = {
      fetchMetadata,
      findCurrentApp: (packageName) => findCurrentApp(supabase, packageName),
      findExistingProposal: (packageName) => findAnyProposalForPackage(supabase, packageName, "new_app"),
      proposeForPackage: (input) => proposeForPackage(supabase, input),
      updateDiscoveryCandidate: (id, patch) => updateDiscoveryCandidate(supabase, id, patch),
      now,
    };

    let result;
    try {
      result = await processDiscoveryCandidate({ id: row.id, status: row.status }, contentFromCandidate(found), deps);
    } catch (caught) {
      console.log(`      pipeline FAILED for ${found.source_ref}: ${caught?.message ?? caught}`);
      pipelineErrors++;
      continue;
    }

    switch (result.outcome) {
      case "skipped_terminal":
        skippedTerminal++;
        console.log(`      skipped — already ${result.status}`);
        break;
      case "disqualified_no_play_link":
        disqualified++;
        console.log(`      disqualified — no Play link found`);
        break;
      case "disqualified_exists":
        disqualified++;
        console.log(`      disqualified — ${result.reason}`);
        break;
      case "error":
        pipelineErrors++;
        console.log(`      error — ${result.reason}`);
        break;
      case "proposed":
        proposed++;
        console.log(`      PROPOSED — package ${result.packageName}, proposal id ${result.proposalId}`);
        break;
    }
  }

  console.log("\n  Discovery run summary");
  console.log(`  ---------------------`);
  console.log(`  search window since:          ${since}`);
  console.log(`  raw candidates passing filters: ${report.candidates.length}`);
  console.log(`  candidates rejected pre-Play:  ${report.rejected.length}`);
  console.log(`  discovery-layer errors:       ${report.errors.length}`);
  console.log(`  proposals created:            ${proposed}`);
  console.log(`  disqualified (already exists): ${disqualified}`);
  console.log(`  already-terminal (skipped):   ${skippedTerminal}`);
  console.log(`  pipeline errors:              ${pipelineErrors}`);

  console.log("\n  DAILY DISCOVERY MODE");
  console.log("  Only play_discovery_candidates and play_import_proposals were written.");
  console.log("  No apps, versions, storage, or publishing were changed. Nothing was approved.\n");
}

main().catch((error) => {
  // Every individual candidate's own failure is already caught and
  // reported above without stopping the run — only an unexpected failure
  // of the run itself (e.g. the initial GitHub search page also failing
  // outright, or a Supabase connection error) reaches here.
  console.error("\n  Discovery run failed unexpectedly:", error?.message ?? error, "\n");
  process.exit(1);
});
