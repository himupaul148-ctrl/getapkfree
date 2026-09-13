/**
 * Phase 1 + Phase 2: Google Play metadata discovery, and (with explicit
 * confirmation) guarded database import.
 *
 *   npm run import-play-metadata -- --input=play-urls.txt --dry-run
 *   npm run import-play-metadata -- --input=play-urls.txt --apply --confirm=PLAY-METADATA
 *
 * Reads an admin-curated list of public Google Play app-listing URLs and,
 * for each one, either reports (dry-run, the default) or actually applies
 * (apply mode, explicitly confirmed) what an import would do — new apps as
 * source_type='external' app rows (metadata only, no versions row — see
 * lib/metadata/play-apply.ts's own doc comment for why), existing apps
 * updated only on their Play-provided display fields, respecting
 * apps.manual_fields throughout.
 *
 * This is deliberately still metadata-only. Google Play does not distribute
 * APKs through any public, unauthenticated channel the way F-Droid does
 * (see scripts/import-fdroid.mjs's own comment) — every "download this
 * Play app's APK" tool works by calling Play's private, authenticated
 * client protocol, which this project will not do. So this script never
 * downloads a binary, from Play or anywhere else, in either mode. It also
 * never fabricates version_code/version_name — Play's public listing page
 * exposes neither, so no versions row is created at all for a new app.
 *
 * Read access uses the public anon key throughout (the same one
 * lib/supabase/public.ts uses) — RLS already makes `apps` publicly
 * readable. Writes (apply mode only) need the service-role key, exactly
 * like scripts/import-fdroid.mjs's own writes do, since RLS's "admins
 * manage apps"/"admins manage versions" policies gate authenticated writes
 * on is_admin(), which this unattended script has no session to satisfy.
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

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
};

const HELP_TEXT = `
Google Play metadata import — Phase 1 (dry-run) + Phase 2 (guarded apply)

Usage:
  npm run import-play-metadata -- --input=<file> --dry-run
  npm run import-play-metadata -- --input=<file> --apply --confirm=PLAY-METADATA

Options:
  --input=<file>    Path to a file with one Google Play app URL per line.
                     Blank lines and lines starting with # are ignored.
  --dry-run          Plan only — reports what would happen, writes nothing.
                     This is the default posture; running with neither
                     --dry-run nor --apply is treated as --dry-run.
  --apply            Actually write to the database. Requires
                     --confirm=PLAY-METADATA in the exact same invocation —
                     --apply alone is refused.
  --confirm=<value>  Must be exactly PLAY-METADATA to pair with --apply.
  --help             Show this message.

What this does, in both modes:
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

What this never does, in either mode:
  - Never downloads an APK, from Play or anywhere else.
  - Never calls any private/internal Play Store API.
  - Never writes to Storage.
  - Never introduces a new apps.source_type value.
  - Never overwrites a manually-overridden field.
  - Never touches an app whose source_type is 'fdroid'.
  - Never creates a versions row, or any invented version_code, version_name,
    target_sdk, min_android_version, file_size, permissions, or changelog.
  - Never publishes anything — there is no version to publish.
`;

if (flag("help") || args.length === 0) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const INPUT_PATH = value("input");
const writeMode = resolveWriteMode({ apply: flag("apply"), confirm: value("confirm") });

if (!INPUT_PATH) {
  console.error("\n  --input=<file> is required. Run with --help for usage.\n");
  process.exit(1);
}
if (writeMode.mode === "error") {
  console.error(`\n  ${writeMode.reason}\n`);
  process.exit(1);
}
const APPLYING = writeMode.mode === "apply";

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
if (APPLYING && !SERVICE_KEY) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.\n" +
      "  Apply mode writes to the apps/versions tables, which RLS only permits for an\n" +
      "  authenticated admin session or the service role — this script has neither\n" +
      "  session, so it needs the service role key, exactly like scripts/import-fdroid.mjs.\n" +
      "  (Dry-run mode never needs it — try --dry-run instead.)",
  );
}

// Reads always use the weakest key that works — this script only ever
// SELECTs against a table RLS already makes public.
const readClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Writes (apply mode only) need the service role, which bypasses RLS —
// local/CI use only, never shipped to a browser, exactly like
// scripts/import-fdroid.mjs's own client.
const writeClient = APPLYING
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
  console.log(
    `\nGoogle Play metadata import (${APPLYING ? "APPLY" : "DRY RUN"}) — reading ${INPUT_PATH}\n`,
  );

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
