#!/usr/bin/env node
/**
 * P2-1 Phase C — READ-ONLY dry-run for the license/target_sdk backfill.
 *
 *   node --env-file=.env.local scripts/backfill-license-target-sdk-dry-run.mjs
 *   node --env-file=.env.local scripts/backfill-license-target-sdk-dry-run.mjs --limit=20
 *   node --env-file=.env.local scripts/backfill-license-target-sdk-dry-run.mjs --report=out/p2-1-dry-run.json
 *
 * This script performs SELECT reads only — against the live F-Droid index
 * and the catalogue's `apps`/`versions` tables — and computes what a future
 * apply phase would propose. It never calls .insert()/.update()/.delete()/
 * .upsert() and never runs any DDL. There is deliberately no --apply flag on
 * this file at all, unlike scripts/backfill-fdroid-descriptions-all.mjs's
 * combined dry-run/apply script: Phase C's whole purpose is to be reviewed
 * before any write path is even built.
 *
 * All decision logic lives in lib/apk/license-target-sdk-backfill.ts and
 * lib/apk/fdroid-license-sdk.ts, and is unit-tested there. This file only:
 * reads the catalogue's currently published F-Droid apps/versions, fetches
 * the current F-Droid index, asks the two plan*() functions what to do with
 * each row, and prints/writes the result.
 *
 * Scope, matching the audit's safety requirements:
 *   - Only source_type = 'fdroid' apps, only their published versions.
 *   - license comparisons respect apps.manual_fields (never propose over a
 *     human override); target_sdk has no such gate — it is purely
 *     mechanical, matching min_android_version's existing precedent.
 *   - Nothing is inferred from APKs, descriptions, package names, app names,
 *     or any source other than F-Droid's own index-v1.json.
 *   - Every proposal/conflict entry carries the row's id and the exact
 *     current value read, so a later apply phase can guard its UPDATE on
 *     that same value (optimistic concurrency) rather than re-deriving it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { licenseFromFdroidApp, targetSdkFromFdroidBuild } from "../lib/apk/fdroid-license-sdk.ts";
import {
  findMatchingFdroidBuild,
  planLicenseBackfill,
  planTargetSdkBackfill,
} from "../lib/apk/license-target-sdk-backfill.ts";

const INDEX_URL = "https://f-droid.org/repo/index-v1.json";

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const reportArg = args.find((a) => a.startsWith("--report="));
const REPORT_PATH = reportArg ? reportArg.slice("--report=".length).trim() : "out/p2-1-license-target-sdk-dry-run.json";

// ------------------------------------------------------------------- setup

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("NEXT_PUBLIC_SUPABASE_URL is missing from .env.local");
// Read-only, so the anon key is enough; service key (if present) works too,
// but this script never needs write access and never requests it that way.
const READ_KEY = ANON_KEY || SERVICE_KEY;
if (!READ_KEY) {
  fail("Need NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.local for read access");
}

const supabase = createClient(SUPABASE_URL, READ_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// -------------------------------------------------------------------- main

async function main() {
  console.log("\nP2-1 Phase C — license/target_sdk dry-run (READ-ONLY, no writes)\n");
  if (Number.isFinite(LIMIT)) console.log(`  limit: ${LIMIT} app(s)\n`);

  const startedAt = new Date().toISOString();

  process.stdout.write("  Fetching F-Droid index (~59 MB)… ");
  const indexRes = await fetch(INDEX_URL);
  if (!indexRes.ok) fail(`Could not fetch the F-Droid index (${indexRes.status})`);
  const index = await indexRes.json();
  const indexFetchedAt = new Date().toISOString();
  const indexAppCount = index.apps.length;
  const byPackage = new Map(index.apps.map((a) => [a.packageName, a]));
  const buildsByPackage = index.packages ?? {};
  console.log(`${indexAppCount} apps in the repo.`);

  // Every published F-Droid catalogue row, paginated. Non-F-Droid apps are
  // excluded at the query so they are never even considered.
  const apps = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("apps")
      .select(
        "id, slug, name, package_name, source_type, license, manual_fields, " +
          "versions(id, version_code, version_name, target_sdk, published)",
      )
      .eq("source_type", "fdroid")
      .order("slug")
      .range(from, from + PAGE - 1);
    if (error) {
      fail(
        `Could not read the catalogue: ${error.message}\n` +
          "  (If this mentions an unknown column, the P2-1 schema migration\n" +
          "  (supabase/migrations/20260911000000_app_license_and_target_sdk.sql)\n" +
          "  has not been applied to this database yet — apply it before re-running.)",
      );
    }
    apps.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`  ${apps.length} F-Droid catalogue rows total.\n`);

  // ---------------------------------------------------------------- stats

  const stats = {
    // apps / license
    publishedFdroidAppsExamined: 0,
    licenseProposed: 0,
    licenseAlreadyMatching: 0,
    licenseConflicts: 0,
    licenseSkippedManualOverride: 0,
    licenseSkippedNoFdroidLicense: 0,
    appsNoFdroidMatch: 0,
    // versions / target_sdk
    publishedFdroidVersionsExamined: 0,
    targetSdkProposed: 0,
    targetSdkAlreadyMatching: 0,
    targetSdkConflicts: 0,
    targetSdkSkippedNoFdroidValue: 0,
    versionsNoUsableFdroidTargetSdk: 0, // no-matching-build + no-fdroid-target-sdk, combined
    versionsNoFdroidMatch: 0,
    // catalogue-vs-index coverage, informational
    fdroidIndexAppsNotInDatabase: 0,
  };

  const licenseProposals = [];
  const licenseConflicts = [];
  const licenseSkipped = { manualOverride: [], noFdroidLicense: [], notInIndex: [] };

  const targetSdkProposals = [];
  const targetSdkConflicts = [];
  const targetSdkSkipped = { noMatchingBuild: [], noFdroidValue: [], notInIndex: [] };

  const knownPackageNames = new Set();

  let examined = 0;
  for (const app of apps) {
    if (examined >= LIMIT) break;

    const versionsAll = app.versions ?? [];
    const publishedVersions = versionsAll.filter((v) => v.published);
    if (publishedVersions.length === 0) continue; // in scope only if currently published

    examined++;
    knownPackageNames.add(app.package_name);
    stats.publishedFdroidAppsExamined++;

    const indexApp = byPackage.get(app.package_name);
    const appMatchStatus = indexApp ? "matched" : "not-in-index";
    if (appMatchStatus === "not-in-index") stats.appsNoFdroidMatch++;
    const fdroidLicense = indexApp ? licenseFromFdroidApp(indexApp) : null;

    const licenseDecision = planLicenseBackfill({
      currentLicense: app.license ?? null,
      manualFields: app.manual_fields ?? [],
      matchStatus: appMatchStatus,
      fdroidLicense,
    });

    const licenseRowRef = {
      id: app.id,
      slug: app.slug,
      name: app.name,
      packageName: app.package_name,
      currentLicense: app.license ?? null,
      fdroidLicense,
    };

    if (licenseDecision.action === "propose") {
      stats.licenseProposed++;
      licenseProposals.push(licenseRowRef);
    } else if (licenseDecision.action === "match") {
      stats.licenseAlreadyMatching++;
    } else if (licenseDecision.action === "conflict") {
      stats.licenseConflicts++;
      licenseConflicts.push(licenseRowRef);
    } else if (licenseDecision.reason === "manual-override") {
      stats.licenseSkippedManualOverride++;
      licenseSkipped.manualOverride.push({ slug: app.slug, currentLicense: app.license ?? null });
    } else if (licenseDecision.reason === "no-fdroid-license") {
      stats.licenseSkippedNoFdroidLicense++;
      licenseSkipped.noFdroidLicense.push({ slug: app.slug, packageName: app.package_name });
    } else {
      licenseSkipped.notInIndex.push({ slug: app.slug, packageName: app.package_name });
    }

    // -------------------------------------------------------- target_sdk

    const packageBuilds = buildsByPackage[app.package_name] ?? [];

    for (const version of publishedVersions) {
      stats.publishedFdroidVersionsExamined++;

      let matchStatus;
      let build;
      if (appMatchStatus === "not-in-index") {
        matchStatus = "not-in-fdroid-index";
      } else {
        build = findMatchingFdroidBuild(packageBuilds, version.version_code);
        matchStatus = build ? "matched" : "no-matching-build";
      }
      const fdroidTargetSdk = build ? targetSdkFromFdroidBuild(build) : null;

      const sdkDecision = planTargetSdkBackfill({
        currentTargetSdk: version.target_sdk ?? null,
        matchStatus,
        fdroidTargetSdk,
      });

      const versionRowRef = {
        versionId: version.id,
        appId: app.id,
        slug: app.slug,
        packageName: app.package_name,
        versionCode: version.version_code,
        versionName: version.version_name,
        currentTargetSdk: version.target_sdk ?? null,
        fdroidTargetSdk,
      };

      if (sdkDecision.action === "propose") {
        stats.targetSdkProposed++;
        targetSdkProposals.push(versionRowRef);
      } else if (sdkDecision.action === "match") {
        stats.targetSdkAlreadyMatching++;
      } else if (sdkDecision.action === "conflict") {
        stats.targetSdkConflicts++;
        targetSdkConflicts.push(versionRowRef);
      } else if (sdkDecision.reason === "no-matching-build") {
        stats.versionsNoUsableFdroidTargetSdk++;
        stats.versionsNoFdroidMatch++;
        targetSdkSkipped.noMatchingBuild.push({ slug: app.slug, versionCode: version.version_code });
      } else if (sdkDecision.reason === "no-fdroid-target-sdk") {
        stats.targetSdkSkippedNoFdroidValue++;
        stats.versionsNoUsableFdroidTargetSdk++;
        targetSdkSkipped.noFdroidValue.push({ slug: app.slug, versionCode: version.version_code });
      } else {
        stats.versionsNoFdroidMatch++;
        targetSdkSkipped.notInIndex.push({ slug: app.slug, versionCode: version.version_code });
      }
    }
  }

  // F-Droid index apps this catalogue has never imported at all (informational
  // coverage figure — not part of the license/target_sdk decision for any
  // existing row, since there is no existing row to compare).
  const sampleMissingFromDb = [];
  for (const a of index.apps) {
    if (!knownPackageNames.has(a.packageName)) {
      stats.fdroidIndexAppsNotInDatabase++;
      if (sampleMissingFromDb.length < 20) sampleMissingFromDb.push(a.packageName);
    }
  }

  // ------------------------------------------------------------- reporting

  console.log("========================= DRY-RUN COUNTS =========================\n");
  console.log("  -- apps / license --");
  console.log(`  published F-Droid apps examined .................... ${stats.publishedFdroidAppsExamined}`);
  console.log(`  license values proposed ............................ ${stats.licenseProposed}`);
  console.log(`  licenses already matching .......................... ${stats.licenseAlreadyMatching}`);
  console.log(`  license conflicts .................................. ${stats.licenseConflicts}`);
  console.log(`  skipped — manual override .......................... ${stats.licenseSkippedManualOverride}`);
  console.log(`  skipped — F-Droid has no usable license ............ ${stats.licenseSkippedNoFdroidLicense}`);
  console.log(`  apps without a current F-Droid match ............... ${stats.appsNoFdroidMatch}`);
  console.log("");
  console.log("  -- versions / target_sdk --");
  console.log(`  published F-Droid versions examined ................ ${stats.publishedFdroidVersionsExamined}`);
  console.log(`  target SDK values proposed .......................... ${stats.targetSdkProposed}`);
  console.log(`  target SDK values already matching .................. ${stats.targetSdkAlreadyMatching}`);
  console.log(`  target SDK conflicts ................................ ${stats.targetSdkConflicts}`);
  console.log(`  versions without a usable F-Droid target SDK ........ ${stats.versionsNoUsableFdroidTargetSdk}`);
  console.log(`  versions without any current F-Droid match ......... ${stats.versionsNoFdroidMatch}`);
  console.log("");
  console.log("  -- catalogue vs. index coverage (informational) --");
  console.log(`  F-Droid index apps not present in the database ..... ${stats.fdroidIndexAppsNotInDatabase}`);

  if (licenseConflicts.length) {
    console.log(`\n===================== LICENSE CONFLICTS (${licenseConflicts.length}) =====================\n`);
    for (const c of licenseConflicts) {
      console.log(`  ${c.name} [${c.slug}]   current="${c.currentLicense}"  f-droid="${c.fdroidLicense}"`);
    }
  }

  if (targetSdkConflicts.length) {
    console.log(`\n===================== TARGET SDK CONFLICTS (${targetSdkConflicts.length}) =====================\n`);
    for (const c of targetSdkConflicts) {
      console.log(`  ${c.slug} v${c.versionName} (code ${c.versionCode})   current=${c.currentTargetSdk}  f-droid=${c.fdroidTargetSdk}`);
    }
  }

  const report = {
    tool: "scripts/backfill-license-target-sdk-dry-run.mjs",
    mode: "dry-run-read-only",
    generatedAt: new Date().toISOString(),
    startedAt,
    fdroidIndex: { url: INDEX_URL, appCount: indexAppCount, fetchedAt: indexFetchedAt },
    scope: {
      fdroidRowsTotal: apps.length,
      fdroidRowsExamined: examined,
      limit: Number.isFinite(LIMIT) ? LIMIT : null,
    },
    counts: stats,
    license: {
      proposed: licenseProposals,
      conflicts: licenseConflicts,
      skipped: licenseSkipped,
    },
    targetSdk: {
      proposed: targetSdkProposals,
      conflicts: targetSdkConflicts,
      skipped: targetSdkSkipped,
    },
    fdroidIndexAppsNotInDatabaseSample: sampleMissingFromDb,
  };

  const outPath = resolve(process.cwd(), REPORT_PATH);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n  JSON report written: ${outPath}`);
  console.log("\n  READ-ONLY DRY RUN — no INSERT, UPDATE, DELETE, UPSERT, or DDL was ever issued.\n");
}

main().catch((error) => {
  console.error("\n  Dry run failed:", error?.message ?? error, "\n");
  process.exit(1);
});
