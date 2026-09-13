/**
 * Phase 1 (dry-run) + Phase 2 (guarded apply) + Phase 4c (propose) of the
 * Google Play metadata import workflow.
 *
 *   npm run import-play-metadata -- --input=play-urls.txt --dry-run
 *   npm run import-play-metadata -- --input=play-urls.txt --apply --confirm=PLAY-METADATA
 *   npm run import-play-metadata -- --input=play-urls.txt --propose --confirm=PLAY-METADATA
 *
 * Reads an admin-curated list of public Google Play app-listing URLs and,
 * for each one:
 *   --dry-run (default) — reports what would happen, writes nothing.
 *   --apply             — writes directly to apps/versions (Phase 2's
 *                          guarded import — new apps as source_type='external'
 *                          app rows, metadata only, no versions row; see
 *                          lib/metadata/play-apply.ts's own doc comment).
 *   --propose           — writes ONLY to public.play_import_proposals (Phase
 *                          4c) — never touches apps/versions/storage at all.
 *                          Every proposal is created 'pending'; nothing here
 *                          approves, applies, or publishes anything. See
 *                          lib/metadata/play-proposal-store.ts.
 *
 * This is deliberately still metadata-only in every mode. Google Play does
 * not distribute APKs through any public, unauthenticated channel the way
 * F-Droid does (see scripts/import-fdroid.mjs's own comment) — every
 * "download this Play app's APK" tool works by calling Play's private,
 * authenticated client protocol, which this project will not do. So this
 * script never downloads a binary, from Play or anywhere else, in any mode.
 * It also never fabricates version_code/version_name — Play's public
 * listing page exposes neither, so no versions row is created at all,
 * whether an app is created directly (--apply) or only proposed (--propose).
 *
 * Read access uses the public anon key throughout (the same one
 * lib/supabase/public.ts uses) — RLS already makes `apps` publicly
 * readable. Writes (--apply and --propose both) need the service-role key,
 * exactly like scripts/import-fdroid.mjs's own writes do, since RLS's
 * "admins manage apps"/"admins manage versions"/"admins manage play import
 * proposals" policies all gate authenticated writes on is_admin(), which
 * this unattended script has no session to satisfy.
 */

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

import { parseInputLines } from "../lib/metadata/play-input.ts";
import { parsePlayUrl } from "../lib/metadata/play-url.ts";
import { fetchMetadata } from "../lib/metadata/fetchers.ts";
import { planImport, summarize } from "../lib/metadata/play-dry-run.ts";
import { resolveWriteMode } from "../lib/metadata/play-confirm.ts";
import {
  applyPermittedChanges,
  createExternalAppFromPlay,
  summarizeApply,
  writableChangesFor,
} from "../lib/metadata/play-apply.ts";
import { proposeForPackage, summarizeProposeRun } from "../lib/metadata/play-proposal-store.ts";
import { runWatchlistPropose } from "../lib/metadata/play-watchlist-runner.ts";

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
};

const HELP_TEXT = `
Google Play metadata import — dry-run / guarded apply / propose

Usage:
  npm run import-play-metadata -- --input=<file> --dry-run
  npm run import-play-metadata -- --input=<file> --apply --confirm=PLAY-METADATA
  npm run import-play-metadata -- --input=<file> --propose --confirm=PLAY-METADATA
  npm run import-play-metadata -- --watchlist --propose --confirm=PLAY-METADATA

Options:
  --input=<file>    Path to a file with one Google Play app URL per line.
                     Blank lines and lines starting with # are ignored.
                     Cannot be combined with --watchlist.
  --watchlist        Read the finite, admin-curated set of packages from
                     public.play_watchlist (enabled = true rows only)
                     instead of --input=<file>. Never discovers or fetches
                     any package outside that table. Only supported
                     together with --propose — there is no --watchlist
                     --dry-run or --watchlist --apply mode. Disabled rows
                     are skipped entirely, including their health
                     timestamps. See lib/metadata/play-watchlist-runner.ts.
  --dry-run          Plan only — reports what would happen, writes nothing.
                     This is the default posture; running with none of
                     --dry-run/--apply/--propose is treated as --dry-run.
                     Not available with --watchlist.
  --apply            Write directly to apps/versions. Requires
                     --confirm=PLAY-METADATA in the exact same invocation —
                     --apply alone is refused. Not available with
                     --watchlist.
  --propose          Write ONLY to public.play_import_proposals (plus, in
                     --watchlist mode, health fields on public.play_watchlist
                     itself) — never to apps, versions, or Storage, and
                     never publishes anything. Requires
                     --confirm=PLAY-METADATA in the exact same invocation —
                     --propose alone is refused. Cannot be combined with
                     --apply. Required when --watchlist is set.
  --confirm=<value>  Must be exactly PLAY-METADATA to pair with --apply or
                     --propose.
  --help             Show this message.

What --dry-run and --apply do:
  - Validates each line is a public play.google.com app-details URL and
    extracts its package id.
  - Fetches display metadata from the public Play listing page (fromPlay(),
    reused via lib/metadata/fetchers.ts's fetchMetadata() dispatcher).
  - Checks whether the package already exists in the local catalogue.
  - An existing app whose stored source_type is 'fdroid' is left entirely
    alone — that row belongs to the F-Droid/real-APK pipeline, never to
    this tool, regardless of package name overlap.
  - For an existing external app: shows which fields would change, and
    which differing fields would NOT change because they are marked manual
    (apps.manual_fields) — see lib/metadata/provenance.ts. A field Play
    returns as null/missing is NEVER written, even if it differs from a
    real stored value.
  - For a new app: shows (dry-run) or creates (apply) the app row as
    source_type='external', hosted_locally=false, scan_status='external'.
    Metadata only — NO versions row is created. Play's public listing page
    never exposes a version number, and version_code/version_name are both
    NOT NULL columns, so there is no legitimate value to put there; a
    version-less app is already an ordinary, handled state (see
    components/admin/EditMetadataModal.tsx's own "This app has no version
    row yet." case). Turning a draft into a fully published external
    listing with a real version is a separate admin action this tool does
    not perform.

What --propose does instead:
  - Same fetch/classify/manual-field logic as above, but the outcome is
    written as a 'pending' row in public.play_import_proposals rather than
    applied directly — proposal_type ('new_app'/'metadata_update'),
    package_name, play_url, app_id (null for new_app), proposed_fields, and
    previous_fields only. Nothing else.
  - An existing pending proposal for the same (package_name, proposal_type)
    is marked 'superseded' — never deleted — before the fresh one is
    inserted, so proposal history is always preserved.
  - Unchanged or F-Droid-owned/ineligible packages create no proposal row
    at all and are reported as skipped/unchanged.
  - Nothing here is approved, applied, or published — a proposal sits
    'pending' until a future, separate admin action (not part of this
    script) reviews it.

What this never does, in any mode:
  - Never downloads an APK, from Play or anywhere else.
  - Never calls any private/internal Play Store API.
  - Never writes to Storage.
  - Never introduces a new apps.source_type value.
  - Never overwrites a manually-overridden field.
  - Never touches an app whose source_type is 'fdroid'.
  - Never creates a versions row, or any invented version_code, version_name,
    target_sdk, min_android_version, file_size, permissions, or changelog.
  - Never publishes anything — there is no version to publish.
  - --propose specifically never writes to apps or versions at all — only
    to public.play_import_proposals.
`;

if (flag("help") || args.length === 0) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const INPUT_PATH = value("input");
const WATCHLIST = flag("watchlist");
const writeMode = resolveWriteMode({
  apply: flag("apply"),
  propose: flag("propose"),
  confirm: value("confirm"),
});

if (WATCHLIST && INPUT_PATH) {
  console.error("\n  --watchlist cannot be combined with --input=<file> — choose one source.\n");
  process.exit(1);
}
if (!WATCHLIST && !INPUT_PATH) {
  console.error("\n  --input=<file> is required unless --watchlist is set. Run with --help for usage.\n");
  process.exit(1);
}
if (writeMode.mode === "error") {
  console.error(`\n  ${writeMode.reason}\n`);
  process.exit(1);
}
if (WATCHLIST && writeMode.mode !== "propose") {
  console.error(
    "\n  --watchlist requires --propose (and --confirm=PLAY-METADATA) — --dry-run and --apply are not supported in watchlist mode.\n",
  );
  process.exit(1);
}
const APPLYING = writeMode.mode === "apply";
const PROPOSING = writeMode.mode === "propose";

// ------------------------------------------------------------------- setup

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL || !ANON_KEY) {
  fail("NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from .env.local.");
}
if ((APPLYING || PROPOSING) && !SERVICE_KEY) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.\n" +
      "  Apply/propose mode writes to a table RLS only permits for an authenticated\n" +
      "  admin session or the service role — this script has neither session, so it\n" +
      "  needs the service role key, exactly like scripts/import-fdroid.mjs.\n" +
      "  (Dry-run mode never needs it — try --dry-run instead.)",
  );
}

// Reads always use the weakest key that works — this script only ever
// SELECTs against a table RLS already makes public.
const readClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Writes (apply/propose mode only) need the service role, which bypasses
// RLS — local/CI use only, never shipped to a browser, exactly like
// scripts/import-fdroid.mjs's own client. --propose uses this SAME client
// for its one read (the current app row) too — see
// lib/metadata/play-proposal-store.ts's proposeForPackage(); that's a read
// of already-public data either way, so there is no additional exposure
// from reusing it rather than juggling a second client for that one call.
const writeClient =
  APPLYING || PROPOSING
    ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

// No official Play rate-limit contract exists to pace against (unlike
// VirusTotal's documented 4/min — see lib/apk/virustotal.ts), so this is a
// deliberately conservative fixed spacing between requests rather than a
// tuned value.
const PLAY_FETCH_INTERVAL_MS = 3_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EXISTING_APP_SELECT =
  "id, slug, package_name, name, description, icon_url, developer_name, category, rating, rating_count, manual_fields, source_type";

async function findExistingApp(packageName) {
  const { data, error } = await readClient
    .from("apps")
    .select(EXISTING_APP_SELECT)
    .eq("package_name", packageName)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// -------------------------------------------------------------- formatting

function formatValue(v) {
  if (v === null || v === undefined || v === "") return "(none)";
  return String(v);
}

function printChange(label, change) {
  console.log(`      ${label}${change.field}: ${formatValue(change.from)} -> ${formatValue(change.to)}`);
}

function printPlanForNew(plan) {
  console.log(`      NEW APP — proposed (source_type='external'):`);
  console.log(`        name:            ${formatValue(plan.proposed.name)}`);
  console.log(`        developer:       ${formatValue(plan.proposed.developer_name)}`);
  console.log(`        category:        ${formatValue(plan.proposed.category)}`);
  console.log(`        description:     ${plan.proposed.description ? "available" : "(none)"}`);
  console.log(`        icon:            ${plan.proposed.icon_url ? "available" : "(none)"}`);
  console.log(
    `        rating:          ${
      plan.proposed.rating !== null
        ? `${plan.proposed.rating} (${formatValue(plan.proposed.rating_count)} ratings)`
        : "(none)"
    }`,
  );
  console.log(`        source_type:     external`);
  console.log(`        hosted_locally:  false`);
  console.log(`        external_url:    ${plan.proposed.external_url}`);
  console.log(`        scan_status:     external`);
  console.log(`        version:         (none — Play exposes no version number; no versions row is created)`);
}

function printPlanForExisting(plan) {
  console.log(`      package: ${plan.packageName} (existing app, slug="${plan.slug}")`);
  const { applied, skippedNull } = writableChangesFor(plan);
  if (applied.length > 0) {
    console.log(`      would change:`);
    applied.forEach((c) => printChange("", c));
  }
  if (skippedNull.length > 0) {
    console.log(`      would NOT change (Play returned no value — never blanks a stored field):`);
    skippedNull.forEach((c) => printChange("", c));
  }
  if (plan.protectedFields.length > 0) {
    console.log(`      would NOT change (manually overridden):`);
    plan.protectedFields.forEach((c) => printChange("", c));
  }
  if (applied.length === 0 && skippedNull.length === 0 && plan.protectedFields.length === 0) {
    console.log(`      no differences from the stored row`);
  }
  return applied;
}

// -------------------------------------------------------------------- main

async function processUrl(line) {
  const parsed = parsePlayUrl(line);
  if (!parsed.ok) {
    console.log(`  ✗ ${line}`);
    console.log(`      skipped — ${parsed.reason}`);
    return { dryOutcome: { status: "invalid_url", line, reason: parsed.reason }, applyOutcome: { status: "skipped_invalid_url", line } };
  }

  let metadata;
  try {
    // fetchMetadata() dispatches purely on hostname; every URL reaching
    // here has already been confirmed to be play.google.com by
    // parsePlayUrl() above, so this always calls fromPlay() internally.
    metadata = await fetchMetadata(parsed.url);
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    console.log(`  ✗ ${parsed.url}`);
    console.log(`      package: ${parsed.packageName}`);
    console.log(`      fetch failed — ${reason}`);
    return {
      dryOutcome: { status: "fetch_failed", url: parsed.url, packageName: parsed.packageName, reason },
      applyOutcome: { status: "skipped_fetch_failed", packageName: parsed.packageName },
    };
  }

  let existing = null;
  try {
    existing = await findExistingApp(parsed.packageName);
  } catch (caught) {
    const reason = `could not read the catalogue: ${caught?.message ?? caught}`;
    console.log(`  ✗ ${parsed.url}`);
    console.log(`      package: ${parsed.packageName}`);
    console.log(`      ${reason}`);
    return {
      dryOutcome: { status: "fetch_failed", url: parsed.url, packageName: parsed.packageName, reason },
      applyOutcome: { status: "failed", packageName: parsed.packageName, reason },
    };
  }

  // An existing F-Droid-owned row is entirely out of scope — never diffed,
  // never touched, regardless of package overlap with a Play listing.
  if (existing && existing.source_type === "fdroid") {
    console.log(`  · ${parsed.url}`);
    console.log(`      package: ${parsed.packageName} — existing app is F-Droid-sourced, not managed by this tool`);
    return {
      dryOutcome: { status: "ok", url: parsed.url, packageName: parsed.packageName, plan: { kind: "fdroid_owned" } },
      applyOutcome: { status: "skipped_fdroid_owned", packageName: parsed.packageName },
    };
  }

  const plan = planImport(metadata, existing, parsed.url);
  const dryOutcome = { status: "ok", url: parsed.url, packageName: parsed.packageName, plan };

  if (plan.kind === "new") {
    console.log(`  + ${parsed.url}`);
    printPlanForNew(plan);

    if (!APPLYING) {
      console.log(`      (not created — dry run)`);
      return { dryOutcome, applyOutcome: { status: "unchanged", packageName: parsed.packageName } };
    }

    try {
      const result = await createExternalAppFromPlay(writeClient, {
        packageName: parsed.packageName,
        proposed: plan.proposed,
      });
      if (result.created) {
        console.log(`      created (app id ${result.appId}, slug "${result.slug}") — metadata only, no version row`);
        return { dryOutcome, applyOutcome: { status: "created", packageName: parsed.packageName, appId: result.appId, slug: result.slug } };
      }
      console.log(`      already created by a concurrent run (app id ${result.appId}) — nothing new added`);
      return { dryOutcome, applyOutcome: { status: "unchanged", packageName: parsed.packageName } };
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      console.log(`      FAILED to create — ${reason}`);
      return { dryOutcome, applyOutcome: { status: "failed", packageName: parsed.packageName, reason } };
    }
  }

  console.log(`  ${plan.unchanged ? "=" : "~"} ${parsed.url}`);
  const applied = printPlanForExisting(plan);

  if (!APPLYING) {
    return { dryOutcome, applyOutcome: { status: "unchanged", packageName: parsed.packageName } };
  }

  if (applied.length === 0) {
    console.log(`      (nothing to write)`);
    return { dryOutcome, applyOutcome: { status: "unchanged", packageName: parsed.packageName } };
  }

  try {
    await applyPermittedChanges(writeClient, plan.appId, applied);
    console.log(`      updated (${applied.map((c) => c.field).join(", ")})`);
    return {
      dryOutcome,
      applyOutcome: { status: "updated", packageName: parsed.packageName, appId: plan.appId, fields: applied.map((c) => c.field) },
    };
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    console.log(`      FAILED to update — ${reason}`);
    return { dryOutcome, applyOutcome: { status: "failed", packageName: parsed.packageName, reason } };
  }
}

// ----------------------------------------------------------------- propose

/**
 * Prints one proposeForPackage() outcome — shared verbatim between the
 * file-based --propose mode below and --watchlist mode
 * (runWatchlistCli()), so the two never grow diverging copies of the same
 * formatting.
 */
function printProposeOutcome(parsed, outcome) {
  if (outcome.status === "ineligible") {
    console.log(`  · ${parsed.url}`);
    console.log(`      SKIPPED — package: ${parsed.packageName} — ${outcome.reason}`);
    return;
  }

  if (outcome.status === "unchanged") {
    console.log(`  = ${parsed.url}`);
    console.log(`      UNCHANGED — package: ${parsed.packageName} — no proposal created`);
    return;
  }

  if (outcome.status === "new_app") {
    console.log(`  + ${parsed.url}`);
    console.log(`      NEW PROPOSAL — type: new_app, package: ${parsed.packageName}`);
    console.log(`        proposed fields:`);
    for (const [field, val] of Object.entries(outcome.row.proposed_fields)) {
      console.log(`          ${field}: ${formatValue(val)}`);
    }
    if (outcome.superseded) console.log(`        (superseded a previous pending proposal for this package)`);
    console.log(`        proposal id: ${outcome.proposalId}`);
    return;
  }

  // metadata_update
  console.log(`  ~ ${parsed.url}`);
  console.log(
    `      UPDATED PROPOSAL — type: metadata_update, package: ${parsed.packageName}, app slug: "${outcome.appSlug}"`,
  );
  console.log(`        changed fields:`);
  for (const field of Object.keys(outcome.row.proposed_fields)) {
    console.log(`          ${field}: ${formatValue(outcome.row.previous_fields?.[field])} -> ${formatValue(outcome.row.proposed_fields[field])}`);
  }
  if (outcome.superseded) console.log(`        (superseded a previous pending proposal for this package)`);
  console.log(`        proposal id: ${outcome.proposalId}`);
}

/**
 * --propose's own per-line handler — deliberately separate from
 * processUrl() above rather than threaded through its APPLYING branches:
 * propose writes to a different table entirely (play_import_proposals,
 * never apps/versions), through one single call
 * (proposeForPackage — lib/metadata/play-proposal-store.ts) that already
 * does the current-app lookup, classification, shaping, and insert-with-
 * supersede internally. Sharing processUrl()'s control flow would only
 * make it harder to see that propose mode's write surface is exactly one
 * table.
 */
async function processUrlForPropose(line) {
  const parsed = parsePlayUrl(line);
  if (!parsed.ok) {
    console.log(`  ✗ ${line}`);
    console.log(`      skipped — ${parsed.reason}`);
    return { status: "invalid_url" };
  }

  let metadata;
  try {
    // fetchMetadata() dispatches purely on hostname; every URL reaching
    // here has already been confirmed to be play.google.com by
    // parsePlayUrl() above, so this always calls fromPlay() internally.
    metadata = await fetchMetadata(parsed.url);
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    console.log(`  ✗ ${parsed.url}`);
    console.log(`      package: ${parsed.packageName}`);
    console.log(`      fetch failed — ${reason}`);
    return { status: "fetch_failed" };
  }

  try {
    const outcome = await proposeForPackage(writeClient, {
      fetched: metadata,
      packageName: parsed.packageName,
      playUrl: parsed.url,
    });
    printProposeOutcome(parsed, outcome);
    return outcome;
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    console.log(`  ✗ ${parsed.url}`);
    console.log(`      package: ${parsed.packageName}`);
    console.log(`      FAILED — ${reason}`);
    return { status: "failed" };
  }
}

// --------------------------------------------------------------- watchlist

/**
 * --watchlist mode's entire CLI-side job: call runWatchlistPropose() (the
 * real Supabase client, the real fetchMetadata, the real sleep) and print
 * its report. Every decision about WHAT to propose, and every safety rule
 * that governs it, already happened inside runWatchlistPropose() and the
 * functions it calls — this function only formats what came back.
 */
async function runWatchlistCli() {
  console.log(`\nGoogle Play metadata import (WATCHLIST PROPOSE) — reading public.play_watchlist\n`);

  const report = await runWatchlistPropose({
    supabase: writeClient,
    fetchMetadata,
    sleep,
    fetchIntervalMs: PLAY_FETCH_INTERVAL_MS,
  });

  console.log(`  enabled entries:            ${report.enabled.length}`);
  console.log(`  disabled entries (skipped): ${report.disabled.length}\n`);

  if (report.enabled.length === 0) {
    console.log("  0 enabled entries — nothing to check.\n");
  }

  for (const { row, result } of report.rows) {
    if (result.kind === "invalid_url") {
      console.log(`  ✗ ${row.play_url}`);
      console.log(`      package: ${row.package_name} — invalid play_url: ${result.reason}`);
      continue;
    }
    if (result.kind === "fetch_failed") {
      console.log(`  ✗ ${row.play_url}`);
      console.log(`      package: ${row.package_name}`);
      console.log(`      fetch failed — ${result.reason}`);
      continue;
    }
    if (result.kind === "store_failed") {
      console.log(`  ✗ ${row.play_url}`);
      console.log(`      package: ${row.package_name}`);
      console.log(`      FAILED to record proposal — ${result.reason}`);
      continue;
    }
    // "propose" — the fetch succeeded and proposeForPackage() ran; the URL
    // was already confirmed valid by runWatchlistPropose() to reach this
    // point, so re-parsing it here for display purposes cannot fail.
    printProposeOutcome(parsePlayUrl(row.play_url), result.outcome);
  }

  console.log("\n  Watchlist propose summary");
  console.log(`  -------------------------`);
  console.log(`  enabled entries:            ${report.summary.enabledCount}`);
  console.log(`  disabled entries (skipped): ${report.summary.disabledCount}`);
  console.log(`  successful fetches:         ${report.summary.successfulFetches}`);
  console.log(`  failed fetches:             ${report.summary.failedFetches}`);
  console.log(`  new proposals:              ${report.summary.newProposals}`);
  console.log(`  metadata-update proposals:  ${report.summary.metadataUpdateProposals}`);
  console.log(`  unchanged:                  ${report.summary.unchanged}`);
  console.log(`  F-Droid/ineligible:         ${report.summary.ineligible}`);
  console.log(`  superseded:                 ${report.summary.superseded}`);
  console.log(`  other failures (proposal write): ${report.summary.storeFailures}`);

  console.log("\n  WATCHLIST PROPOSE MODE");
  console.log("  Only play_import_proposals and play_watchlist health fields were written.");
  console.log("  No apps, versions, storage, or publishing were changed.\n");
}

function printProposeSummary(summary) {
  console.log("\n  Propose summary");
  console.log(`  ---------------`);
  console.log(`  total URLs:                 ${summary.totalUrls}`);
  console.log(`  successful fetches:         ${summary.successfulFetches}`);
  console.log(`  failures:                   ${summary.failures}`);
  console.log(`  new proposals:              ${summary.newProposals}`);
  console.log(`  metadata-update proposals:  ${summary.metadataUpdateProposals}`);
  console.log(`  unchanged:                  ${summary.unchanged}`);
  console.log(`  skipped:                    ${summary.skipped}`);
  console.log(`  superseded:                 ${summary.superseded}`);
  console.log(`  inserted:                   ${summary.inserted}`);
}

function printPreSummary(summary) {
  console.log("\n  Plan summary");
  console.log(`  ------------`);
  console.log(`  total URLs:            ${summary.totalUrls}`);
  console.log(`  successful fetches:    ${summary.successfulFetches}`);
  console.log(`  failed fetches:        ${summary.failedFetches}`);
  console.log(`  existing apps:         ${summary.existingApps}`);
  console.log(`  new apps:               ${summary.newApps}`);
  console.log(`  apps with changes:      ${summary.appsWithChanges}`);
  console.log(`  unchanged apps:         ${summary.unchangedApps}`);
}

function printApplySummary(summary) {
  console.log("\n  Apply summary");
  console.log(`  -------------`);
  console.log(`  created:   ${summary.created}`);
  console.log(`  updated:   ${summary.updated}`);
  console.log(`  unchanged: ${summary.unchanged}`);
  console.log(`  skipped:   ${summary.skipped}`);
  console.log(`  failed:    ${summary.failed}`);
  console.log(`  total:     ${summary.total}`);
}

async function main() {
  if (WATCHLIST) {
    await runWatchlistCli();
    return;
  }

  const modeLabel = APPLYING ? "APPLY" : PROPOSING ? "PROPOSE" : "DRY RUN";
  console.log(`\nGoogle Play metadata import (${modeLabel}) — reading ${INPUT_PATH}\n`);

  let raw;
  try {
    raw = await readFile(INPUT_PATH, "utf8");
  } catch (caught) {
    fail(`Could not read ${INPUT_PATH}: ${caught?.message ?? caught}`);
    return;
  }

  const lines = parseInputLines(raw);
  if (lines.length === 0) {
    console.log("  No URLs to process (file is empty after filtering blanks/comments).\n");
    return;
  }

  if (PROPOSING) {
    const outcomes = [];
    for (let i = 0; i < lines.length; i++) {
      const outcome = await processUrlForPropose(lines[i]);
      outcomes.push(outcome);
      // Pacing only matters between real network requests; an invalid-URL
      // line is caught before any fetch and costs no delay.
      if (i < lines.length - 1 && outcome.status !== "invalid_url") await sleep(PLAY_FETCH_INTERVAL_MS);
    }

    printProposeSummary(summarizeProposeRun(outcomes));
    console.log(
      "\n  PROPOSE MODE — proposals written to play_import_proposals only.\n" +
        "  No apps, versions, or storage were modified.\n" +
        "  Nothing was published.\n",
    );
    return;
  }

  const dryOutcomes = [];
  const applyOutcomes = [];

  for (let i = 0; i < lines.length; i++) {
    const { dryOutcome, applyOutcome } = await processUrl(lines[i]);
    dryOutcomes.push(dryOutcome);
    applyOutcomes.push(applyOutcome);
    // Pacing only matters between real network requests; an invalid-URL
    // line is caught before any fetch and costs no delay.
    if (i < lines.length - 1 && dryOutcome.status !== "invalid_url") await sleep(PLAY_FETCH_INTERVAL_MS);
  }

  printPreSummary(summarize(dryOutcomes));

  if (APPLYING) {
    printApplySummary(summarizeApply(applyOutcomes));
    console.log("");
  } else {
    console.log("\n  DRY RUN — nothing was written to Supabase or Storage.\n");
  }
}

main().catch((error) => {
  // Only an unexpected failure of the run itself (not a single bad URL,
  // which is always caught and reported inside processUrl) reaches here.
  console.error("\n  Run failed unexpectedly:", error?.message ?? error, "\n");
  process.exit(1);
});
