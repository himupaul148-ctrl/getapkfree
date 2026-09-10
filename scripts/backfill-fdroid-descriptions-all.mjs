#!/usr/bin/env node
/**
 * Generalised backfill for thin F-Droid app descriptions across the whole
 * published catalogue — the successor to the one-off
 * scripts/backfill-fdroid-descriptions.mjs (which was hardcoded to 18 rows
 * and has already been applied).
 *
 *   node --env-file=.env.local scripts/backfill-fdroid-descriptions-all.mjs                  # dry run (default, no writes)
 *   node --env-file=.env.local scripts/backfill-fdroid-descriptions-all.mjs --apply          # writes apps.description only
 *   node --env-file=.env.local scripts/backfill-fdroid-descriptions-all.mjs --limit=5        # cap rows examined
 *   node --env-file=.env.local scripts/backfill-fdroid-descriptions-all.mjs --only=slug-a,slug-b  # restrict to specific slugs (for a targeted smoke test)
 *   node --env-file=.env.local scripts/backfill-fdroid-descriptions-all.mjs --report=out/backfill.json  # write a full machine-readable audit trail
 *
 * All selection and text logic lives in lib/apk/fdroid-description.ts and is
 * unit-tested there. This file only: reads the catalogue, fetches the current
 * F-Droid index, asks planDescriptionBackfill() what to do with each row,
 * prints a full report, optionally writes a JSON audit trail (--report), and
 * — only with --apply — performs a single-column, optimistic-concurrency-
 * guarded UPDATE.
 *
 * Guarantees (enforced here and in the shared module):
 *   - Only source_type = 'fdroid' rows, only ones with a published build.
 *   - A description listed in apps.manual_fields is NEVER modified — checked
 *     during selection AND pinned in the UPDATE's WHERE clause.
 *   - Only apps.description is ever written. No other column, no other table.
 *   - The candidate must be non-empty and strictly longer than what's stored.
 *   - The UPDATE requires the row's description to still equal what was read;
 *     a row that changed in between is skipped, never clobbered.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  buildFdroidDescriptionCandidate,
  DESCRIPTION_FIELD,
  MAX_DESCRIPTION_LEN,
  MIN_MEANINGFUL_GAIN,
  planDescriptionBackfill,
  THIN_DESCRIPTION_MAX_LEN,
} from "../lib/apk/fdroid-description.ts";

const INDEX_URL = "https://f-droid.org/repo/index-v1.json";

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg
  ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean))
  : null;
const reportArg = args.find((a) => a.startsWith("--report="));
const REPORT_PATH = reportArg ? reportArg.slice("--report=".length).trim() : null;

// ------------------------------------------------------------------- setup

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("NEXT_PUBLIC_SUPABASE_URL is missing from .env.local");
if (APPLY && !SERVICE_KEY) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.\n" +
      "  --apply writes to apps.description; Row Level Security gives anon no\n" +
      "  write path. A dry run (the default, no flag) needs only the anon key.",
  );
}
const READ_KEY = SERVICE_KEY || ANON_KEY;
if (!READ_KEY) {
  fail("Need NEXT_PUBLIC_SUPABASE_ANON_KEY (dry run) or SUPABASE_SERVICE_ROLE_KEY (--apply) in .env.local");
}

const supabase = createClient(SUPABASE_URL, READ_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ------------------------------------------------------------------ helpers

function truncateForDisplay(text, max = 90) {
  if (!text) return "(none)";
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Bullets, list glyphs, markdown headings/links, stray markup — worth a human glance. */
const ODD_FORMATTING = /[•▪●‣·]|(^|\s)[*\-]\s|(^|\s)#{1,6}\s|\]\(https?:|<[a-z/]/i;

/** Wording that reads like a call to the reader / dev rather than a description. */
const SUSPICIOUS_TEXT = /\b(you will|you must|please note|click here|download now|issue on github|todo|fixme|lorem ipsum)\b/i;

// -------------------------------------------------------------------- main

async function main() {
  console.log(
    `\nGeneralised F-Droid description backfill` +
      `${APPLY ? " — APPLY MODE (writes apps.description)" : " — DRY RUN (default, no writes)"}` +
      `${Number.isFinite(LIMIT) ? `, limit ${LIMIT}` : ""}\n`,
  );
  console.log(`  thin threshold: description trimmed length < ${THIN_DESCRIPTION_MAX_LEN} chars\n`);

  const startedAt = new Date().toISOString();

  process.stdout.write("  Fetching F-Droid index (~59 MB)… ");
  const indexRes = await fetch(INDEX_URL);
  if (!indexRes.ok) fail(`Could not fetch the F-Droid index (${indexRes.status})`);
  const index = await indexRes.json();
  const indexFetchedAt = new Date().toISOString();
  const indexAppCount = index.apps.length;
  const byPackage = new Map(index.apps.map((a) => [a.packageName, a]));
  console.log(`${indexAppCount} apps in the repo.`);

  // Every F-Droid catalogue row, paginated. External apps are excluded at the
  // query so they are never even considered.
  const apps = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("apps")
      .select("id, slug, name, package_name, source_type, description, manual_fields, versions(published)")
      .eq("source_type", "fdroid")
      .order("slug")
      .range(from, from + PAGE - 1);
    if (error) fail(`Could not read the catalogue: ${error.message}`);
    apps.push(...data);
    if (data.length < PAGE) break;
  }

  const scoped = ONLY ? apps.filter((a) => ONLY.has(a.slug)) : apps;
  if (ONLY) {
    console.log(`  --only: restricting to ${scoped.length}/${apps.length} row(s): ${[...ONLY].join(", ")}`);
    const missing = [...ONLY].filter((s) => !apps.some((a) => a.slug === s));
    if (missing.length) console.log(`  (not found as F-Droid rows: ${missing.join(", ")})`);
  }
  console.log(`  ${scoped.length} F-Droid catalogue rows to examine.\n`);

  const stats = {
    publishedFdroid: 0,
    thin: 0,
    manualOverride: 0,
    upstreamMatched: 0,
    noUpstreamDescription: 0,
    wouldUpdate: 0,
    manualReview: 0,
    skipNotLonger: 0,
    skipNotMeaningful: 0,
    skipManual: 0,
    skipNotThin: 0,
    skipNoBuild: 0,
    skipNotFdroid: 0,
    applied: 0,
    applyRaced: 0,
    applyError: 0,
  };

  const updates = []; // { slug, name, currentLen, candidateLen, current, candidate, id }
  const manualReview = []; // { slug, name, currentLen, candidateLen, current, candidate }

  // Per-outcome slug lists, only assembled for the --report audit trail.
  const skippedRows = {
    candidateNotLonger: [],
    candidateNotMeaningfullyLonger: [],
    manualOverride: [],
    notThin: [],
    noUpstreamDescription: [],
    noPublishedBuild: [],
    notFdroid: [],
  };

  let examined = 0;

  for (const app of scoped) {
    if (examined >= LIMIT) break;
    examined++;

    const hasPublishedBuild = (app.versions ?? []).some((v) => v.published);
    if (app.source_type !== "fdroid") {
      stats.skipNotFdroid++;
      skippedRows.notFdroid.push({ slug: app.slug, sourceType: app.source_type });
      continue;
    }
    if (!hasPublishedBuild) {
      stats.skipNoBuild++;
      skippedRows.noPublishedBuild.push({ slug: app.slug, name: app.name });
      continue;
    }
    stats.publishedFdroid++;

    const manualFields = app.manual_fields ?? [];
    if (manualFields.includes(DESCRIPTION_FIELD)) stats.manualOverride++;

    const currentDescription = app.description;
    const currentLen = (currentDescription ?? "").trim().length;
    const isThin = currentLen < THIN_DESCRIPTION_MAX_LEN;
    if (isThin) stats.thin++;

    const indexApp = byPackage.get(app.package_name);
    const candidate = indexApp ? buildFdroidDescriptionCandidate(indexApp) : null;
    if (isThin && !manualFields.includes(DESCRIPTION_FIELD)) {
      if (candidate) stats.upstreamMatched++;
      else stats.noUpstreamDescription++;
    }

    const decision = planDescriptionBackfill({
      sourceType: app.source_type,
      hasPublishedBuild,
      manualFields,
      currentDescription,
      candidate,
    });

    if (decision.action === "skip") {
      const rowRef = {
        slug: app.slug,
        name: app.name,
        packageName: app.package_name,
        currentLen,
        candidateLen: candidate?.length ?? 0,
        current: currentDescription,
        candidate: candidate ?? null,
      };
      if (decision.reason === "manual-override") {
        stats.skipManual++;
        skippedRows.manualOverride.push(rowRef);
      } else if (decision.reason === "not-thin") {
        stats.skipNotThin++;
        skippedRows.notThin.push({ slug: app.slug, name: app.name, currentLen });
      } else if (decision.reason === "candidate-not-longer") {
        stats.skipNotLonger++;
        skippedRows.candidateNotLonger.push(rowRef);
      } else if (decision.reason === "candidate-not-meaningfully-longer") {
        stats.skipNotMeaningful++;
        skippedRows.candidateNotMeaningfullyLonger.push(rowRef);
      } else if (decision.reason === "no-upstream-description") {
        skippedRows.noUpstreamDescription.push({ slug: app.slug, name: app.name, packageName: app.package_name });
      }
      continue;
    }

    if (decision.action === "manual-review") {
      stats.manualReview++;
      manualReview.push({
        slug: app.slug,
        name: app.name,
        currentLen,
        candidateLen: candidate.length,
        current: currentDescription,
        candidate,
      });
      continue;
    }

    stats.wouldUpdate++;
    const updateRow = {
      id: app.id,
      slug: app.slug,
      name: app.name,
      packageName: app.package_name,
      currentLen,
      candidateLen: candidate.length,
      current: currentDescription,
      candidate,
      applyResult: APPLY ? "pending" : null,
    };
    updates.push(updateRow);

    if (APPLY) {
      let q = supabase
        .from("apps")
        .update({ description: candidate })
        .eq("id", app.id)
        .eq("source_type", "fdroid")
        // Defence in depth: even if selection missed it, the DB write refuses
        // a row whose manual_fields contains "description".
        .not("manual_fields", "cs", `{${DESCRIPTION_FIELD}}`);
      q = currentDescription === null
        ? q.is("description", null)
        : q.eq("description", currentDescription);

      const { data: written, error: writeErr } = await q.select("id");
      if (writeErr) {
        console.error(`    ✗ ${app.slug}: ${writeErr.message}`);
        stats.applyError++;
        updateRow.applyResult = `error: ${writeErr.message}`;
      } else if (!written || written.length === 0) {
        console.error(`    ✗ ${app.slug}: row changed since read (or manual override) — skipped`);
        stats.applyRaced++;
        updateRow.applyResult = "raced-or-manual-guard";
      } else {
        console.log(`    ✓ ${app.slug}: description updated (${currentLen} → ${candidate.length} chars)`);
        stats.applied++;
        updateRow.applyResult = "written";
      }
    }
  }

  // ------------------------------------------------------------- reporting

  const longest = [...updates].sort((a, b) => b.candidateLen - a.candidateLen).slice(0, 10);
  const flagged = updates.filter(
    (u) => ODD_FORMATTING.test(u.candidate) || SUSPICIOUS_TEXT.test(u.candidate),
  );
  const lowerQuality = updates.filter((u) => {
    // Heuristics for "candidate may be worse than current" despite being longer:
    const c = u.candidate;
    const cur = (u.current ?? "").trim();
    const endsMidThought = !/[.!?)"']$/.test(c);
    const looksTruncatedList = /[,:;]$/.test(c) || /\b(and|or|with|including|such as|features?)\s*$/i.test(c);
    const currentEndsClean = /[.!?]$/.test(cur);
    return (endsMidThought || looksTruncatedList) && currentEndsClean;
  });

  const sampleForExamples = [
    ...updates.filter((u) => u.candidateLen >= 350).slice(0, 6), // long / edge
    ...updates.filter((u) => u.candidateLen >= 150 && u.candidateLen < 350).slice(0, 10),
    ...updates.filter((u) => u.candidateLen < 150).slice(0, 6), // short upgrades
  ];
  const seen = new Set();
  const examples = sampleForExamples.filter((u) => !seen.has(u.slug) && seen.add(u.slug)).slice(0, 24);

  console.log("\n========================= DRY-RUN STATISTICS =========================\n");
  console.log(`  published F-Droid apps ............................. ${stats.publishedFdroid}`);
  console.log(`  … with thin descriptions (< ${THIN_DESCRIPTION_MAX_LEN} chars) ............ ${stats.thin}`);
  console.log(`  … with a manual description override .............. ${stats.manualOverride}`);
  console.log(`  thin & non-override, matched to an upstream desc .. ${stats.upstreamMatched}`);
  console.log(`  thin & non-override, no usable upstream desc ...... ${stats.noUpstreamDescription}`);
  console.log("");
  console.log(`  WOULD AUTO-UPDATE ............................... ${stats.wouldUpdate}`);
  console.log(`  MANUAL REVIEW (candidate lacks a prose lead-in) . ${stats.manualReview}`);
  console.log(`  skipped — candidate not strictly longer ......... ${stats.skipNotLonger}`);
  console.log(`  skipped — candidate not meaningfully longer ..... ${stats.skipNotMeaningful}`);
  console.log(`  skipped — manual_fields has "description" ....... ${stats.skipManual}`);
  console.log(`  skipped — current description not thin .......... ${stats.skipNotThin}`);
  console.log(`  skipped — no published build (excluded) ......... ${stats.skipNoBuild}`);
  console.log(`  skipped — not F-Droid (should be 0) ............. ${stats.skipNotFdroid}`);
  if (APPLY) {
    console.log("");
    console.log(`  actually applied ................................ ${stats.applied}`);
    console.log(`  write skipped (raced / manual guard) ............ ${stats.applyRaced}`);
    console.log(`  write errored .................................. ${stats.applyError}`);
  }

  console.log(`\n===================== ${examples.length} BEFORE → AFTER EXAMPLES =====================\n`);
  for (const u of examples) {
    console.log(`● ${u.name}  [${u.slug}]   ${u.currentLen} → ${u.candidateLen} chars`);
    console.log(`  BEFORE: ${truncateForDisplay(u.current, 150)}`);
    console.log(`  AFTER:  ${truncateForDisplay(u.candidate, 320)}`);
    console.log("");
  }

  console.log("===================== 10 LONGEST PROPOSED REPLACEMENTS =====================\n");
  for (const u of longest) {
    console.log(`  ${u.candidateLen} chars  ${u.name} [${u.slug}]`);
    console.log(`     ${truncateForDisplay(u.candidate, 320)}`);
  }

  console.log(`\n===================== FLAGGED: bullets / odd formatting / suspicious text (${flagged.length}) =====================\n`);
  if (flagged.length === 0) console.log("  (none)");
  for (const u of flagged) {
    console.log(`  ${u.name} [${u.slug}]`);
    console.log(`     ${truncateForDisplay(u.candidate, 320)}`);
  }

  console.log(`\n===================== MANUAL-REVIEW CANDIDATES — prose-less / bullet-lead (${manualReview.length}) =====================\n`);
  if (manualReview.length === 0) console.log("  (none)");
  for (const u of manualReview) {
    console.log(`  ${u.name} [${u.slug}]   ${u.currentLen} → ${u.candidateLen}`);
    console.log(`     BEFORE: ${truncateForDisplay(u.current, 150)}`);
    console.log(`     AFTER:  ${truncateForDisplay(u.candidate, 260)}`);
  }

  console.log(`\n===================== AUTO-UPDATE CANDIDATE MAY STILL BE AWKWARD (${lowerQuality.length}) =====================\n`);
  if (lowerQuality.length === 0) console.log("  (none)");
  for (const u of lowerQuality) {
    console.log(`  ${u.name} [${u.slug}]   ${u.currentLen} → ${u.candidateLen}`);
    console.log(`     BEFORE: ${truncateForDisplay(u.current, 150)}`);
    console.log(`     AFTER:  ${truncateForDisplay(u.candidate, 220)}`);
  }

  // --------------------------------------------------- --report audit trail

  if (REPORT_PATH) {
    const flaggedForReport = updates.map((u) => {
      const reasons = [];
      if (ODD_FORMATTING.test(u.candidate)) reasons.push("odd-formatting");
      if (SUSPICIOUS_TEXT.test(u.candidate)) reasons.push("suspicious-text");
      return reasons.length ? { slug: u.slug, name: u.name, reasons, candidate: u.candidate } : null;
    }).filter(Boolean);

    const report = {
      tool: "scripts/backfill-fdroid-descriptions-all.mjs",
      generatedAt: new Date().toISOString(),
      startedAt,
      mode: APPLY ? "apply" : "dry-run",
      config: {
        thinThresholdChars: THIN_DESCRIPTION_MAX_LEN,
        maxDescriptionChars: MAX_DESCRIPTION_LEN,
        minMeaningfulGainChars: MIN_MEANINGFUL_GAIN,
        limit: Number.isFinite(LIMIT) ? LIMIT : null,
        only: ONLY ? [...ONLY] : null,
      },
      fdroidIndex: { url: INDEX_URL, appCount: indexAppCount, fetchedAt: indexFetchedAt },
      scope: { fdroidRowsTotal: apps.length, fdroidRowsExamined: examined },
      statistics: stats,
      autoUpdate: updates.map((u) => ({
        slug: u.slug,
        name: u.name,
        packageName: u.packageName,
        id: u.id,
        currentLen: u.currentLen,
        candidateLen: u.candidateLen,
        current: u.current,
        candidate: u.candidate,
        ...(APPLY ? { applyResult: u.applyResult } : {}),
      })),
      manualReview: manualReview.map((u) => ({
        slug: u.slug,
        name: u.name,
        currentLen: u.currentLen,
        candidateLen: u.candidateLen,
        current: u.current,
        candidate: u.candidate,
        reason: "candidate-lacks-prose",
      })),
      skipped: skippedRows,
      flaggedAutoUpdates: flaggedForReport,
      awkwardAutoUpdates: lowerQuality.map((u) => ({
        slug: u.slug,
        name: u.name,
        currentLen: u.currentLen,
        candidateLen: u.candidateLen,
        current: u.current,
        candidate: u.candidate,
      })),
    };

    const outPath = resolve(process.cwd(), REPORT_PATH);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\n  Audit trail written: ${outPath}`);
    console.log(
      `  ${report.autoUpdate.length} auto-update · ${report.manualReview.length} manual-review · ` +
        `${skippedRows.candidateNotLonger.length + skippedRows.candidateNotMeaningfullyLonger.length} length-skip · ` +
        `${skippedRows.noUpstreamDescription.length} no-upstream`,
    );
  }

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing was written. Re-run with --apply (needs the service key) to write.\n");
  } else {
    console.log("");
  }
}

main().catch((error) => {
  console.error("\n  Backfill failed:", error?.message ?? error, "\n");
  process.exit(1);
});
