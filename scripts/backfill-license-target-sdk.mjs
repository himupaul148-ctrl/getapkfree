#!/usr/bin/env node
/**
 * P2-1 Phase E — GUARDED apply script for the license/target_sdk backfill.
 *
 *   node --env-file=.env.local scripts/backfill-license-target-sdk.mjs                          # dry run (default, no writes)
 *   node --env-file=.env.local scripts/backfill-license-target-sdk.mjs --apply --confirm=P2-1   # writes, guarded, NULL-only
 *   node --env-file=.env.local scripts/backfill-license-target-sdk.mjs --limit=5                # cap rows examined
 *   node --env-file=.env.local scripts/backfill-license-target-sdk.mjs --report=out/p2-1.json   # override the report path
 *
 * This is the sibling of scripts/backfill-license-target-sdk-dry-run.mjs
 * (P2-1 Phase C), which stays read-only forever and has no --apply path at
 * all. This file adds the guarded WRITE path on top of the exact same
 * matching and decision logic — reused, not reimplemented:
 *
 *   - lib/apk/fdroid-license-sdk.ts           (licenseFromFdroidApp, targetSdkFromFdroidBuild)
 *   - lib/apk/license-target-sdk-backfill.ts  (planLicenseBackfill, planTargetSdkBackfill, findMatchingFdroidBuild)
 *   - lib/apk/license-target-sdk-apply.ts     (write eligibility, the guarded UPDATE itself, --apply gating)
 *
 * THE SAFETY RULE, enforced in two independent places (belt and braces,
 * matching this project's existing backfill precedent):
 *   1. licenseWriteInstruction/targetSdkWriteInstruction only ever produce a
 *      write for a Phase C "propose" decision — current value null, F-Droid
 *      has a usable value. A "conflict" (non-null, disagrees) or "match"
 *      (non-null, agrees) never reaches a write call at all.
 *   2. The guarded UPDATE itself repeats the check in SQL:
 *      `.eq("id", <exact row id>).is(<column>, null)` — so even if a row
 *      changed in the gap between the read and the write, the database
 *      itself refuses the write rather than trusting this script's earlier
 *      snapshot. A guarded write that matches zero rows is recorded as
 *      "skipped-concurrent-change", never as a success.
 *
 * Every write is scoped to exactly one row by its own primary key. There is
 * no update by package_name, no multi-row update, and no column written
 * other than the one intended column (license on `apps`, target_sdk on
 * `versions`). manual_fields is never written by this script.
 *
 * Default invocation is a dry run — no network write, no database write.
 * A real write additionally requires BOTH `--apply` and the exact token
 * `--confirm=P2-1`; `--apply` without that confirmation is a hard error, not
 * a silent downgrade to dry-run.
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
import {
  applyGuardedLicenseUpdate,
  applyGuardedTargetSdkUpdate,
  licenseWriteInstruction,
  parseApplyFlags,
  targetSdkWriteInstruction,
} from "../lib/apk/license-target-sdk-apply.ts";

const INDEX_URL = "https://f-droid.org/repo/index-v1.json";

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const reportArg = args.find((a) => a.startsWith("--report="));
const REPORT_PATH = reportArg ? reportArg.slice("--report=".length).trim() : "out/p2-1-license-target-sdk-backfill.json";

const { applyRequested, authorized: APPLY } = parseApplyFlags(args);

// ------------------------------------------------------------------- setup

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (applyRequested && !APPLY) {
  fail(
    '--apply requires the exact confirmation flag --confirm=P2-1 as well.\n' +
      "  This is a hard refusal, not a silent dry-run — re-run with both flags\n" +
      "  once you have reviewed the dry-run report, or omit --apply entirely.",
  );
}

if (!SUPABASE_URL) fail("NEXT_PUBLIC_SUPABASE_URL is missing from .env.local");
if (APPLY && !SERVICE_KEY) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.\n" +
      "  --apply writes to apps.license / versions.target_sdk; Row Level\n" +
      "  Security gives anon no write path. A dry run needs only the anon key.",
  );
}
const READ_KEY = SERVICE_KEY || ANON_KEY;
if (!READ_KEY) {
  fail("Need NEXT_PUBLIC_SUPABASE_ANON_KEY (dry run) or SUPABASE_SERVICE_ROLE_KEY (--apply) in .env.local");
}

const supabase = createClient(SUPABASE_URL, READ_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// -------------------------------------------------------------------- main

async function main() {
  console.log(
    `\nP2-1 Phase E — license/target_sdk backfill` +
      `${APPLY ? " — APPLY MODE (guarded writes, NULL-only)" : " — DRY RUN (default, no writes)"}` +
      `${Number.isFinite(LIMIT) ? `, limit ${LIMIT}` : ""}\n`,
  );

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

  // Only published F-Droid apps/versions are ever in scope — matches Phase
  // C exactly. Non-F-Droid (external) apps are excluded at the query.
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
          "  has not been applied to this database yet.)",
      );
    }
    apps.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`  ${apps.length} F-Droid catalogue rows total.\n`);

  const counts = {
    licenseEligible: 0,
    licenseSkippedNonNull: 0, // "match" + "conflict" — already non-null, never overwritten
    licenseUnmatched: 0,
    licenseMissingSource: 0,
    licenseConflicts: 0,
    licenseApplied: 0,
    licenseSkippedConcurrent: 0,
    licenseErrors: 0,

    targetSdkEligible: 0,
    targetSdkSkippedNonNull: 0,
    targetSdkUnmatched: 0,
    targetSdkMissingSource: 0,
    targetSdkConflicts: 0,
    targetSdkApplied: 0,
    targetSdkSkippedConcurrent: 0,
    targetSdkErrors: 0,
  };

  const licenseWrites = []; // { appId, slug, packageName, oldValue, newValue, status }
  const targetSdkWrites = []; // { versionId, appId, slug, packageName, versionCode, oldValue, newValue, status }

  let examined = 0;
  for (const app of apps) {
    if (examined >= LIMIT) break;

    const publishedVersions = (app.versions ?? []).filter((v) => v.published);
    if (publishedVersions.length === 0) continue;
    examined++;

    const indexApp = byPackage.get(app.package_name);
    const appMatchStatus = indexApp ? "matched" : "not-in-index";
    const fdroidLicense = indexApp ? licenseFromFdroidApp(indexApp) : null;

    const licenseDecision = planLicenseBackfill({
      currentLicense: app.license ?? null,
      manualFields: app.manual_fields ?? [],
      matchStatus: appMatchStatus,
      fdroidLicense,
    });
    const licenseInstruction = licenseWriteInstruction(licenseDecision, fdroidLicense);

    if (licenseDecision.action === "conflict") counts.licenseConflicts++;
    if (licenseDecision.action === "match" || licenseDecision.action === "conflict") {
      counts.licenseSkippedNonNull++;
    } else if (licenseDecision.reason === "not-in-fdroid-index") {
      counts.licenseUnmatched++;
    } else if (licenseDecision.reason === "no-fdroid-license") {
      counts.licenseMissingSource++;
    }

    if (licenseInstruction.eligible) {
      counts.licenseEligible++;
      const writeRow = {
        appId: app.id,
        slug: app.slug,
        packageName: app.package_name,
        oldValue: app.license ?? null,
        newValue: licenseInstruction.value,
        status: APPLY ? "pending" : "proposed",
      };
      licenseWrites.push(writeRow);

      if (APPLY) {
        try {
          const outcome = await applyGuardedLicenseUpdate(supabase, app.id, licenseInstruction.value);
          writeRow.status = outcome;
          if (outcome === "applied") counts.licenseApplied++;
          else counts.licenseSkippedConcurrent++;
        } catch (caught) {
          writeRow.status = `error: ${caught?.message ?? caught}`;
          counts.licenseErrors++;
        }
      }
    }

    // -------------------------------------------------------- target_sdk

    const packageBuilds = buildsByPackage[app.package_name] ?? [];

    for (const version of publishedVersions) {
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
      const sdkInstruction = targetSdkWriteInstruction(sdkDecision, fdroidTargetSdk);

      if (sdkDecision.action === "conflict") counts.targetSdkConflicts++;
      if (sdkDecision.action === "match" || sdkDecision.action === "conflict") {
        counts.targetSdkSkippedNonNull++;
      } else if (sdkDecision.reason === "not-in-fdroid-index" || sdkDecision.reason === "no-matching-build") {
        counts.targetSdkUnmatched++;
      } else if (sdkDecision.reason === "no-fdroid-target-sdk") {
        counts.targetSdkMissingSource++;
      }

      if (sdkInstruction.eligible) {
        counts.targetSdkEligible++;
        const writeRow = {
          versionId: version.id,
          appId: app.id,
          slug: app.slug,
          packageName: app.package_name,
          versionCode: version.version_code,
          oldValue: version.target_sdk ?? null,
          newValue: sdkInstruction.value,
          status: APPLY ? "pending" : "proposed",
        };
        targetSdkWrites.push(writeRow);

        if (APPLY) {
          try {
            const outcome = await applyGuardedTargetSdkUpdate(supabase, version.id, sdkInstruction.value);
            writeRow.status = outcome;
            if (outcome === "applied") counts.targetSdkApplied++;
            else counts.targetSdkSkippedConcurrent++;
          } catch (caught) {
            writeRow.status = `error: ${caught?.message ?? caught}`;
            counts.targetSdkErrors++;
          }
        }
      }
    }
  }

  // ------------------------------------------------- pre-apply / summary

  console.log("========================= PRE-APPLY SUMMARY =========================\n");
  console.log("  -- apps / license --");
  console.log(`  eligible for license fill .......................... ${counts.licenseEligible}`);
  console.log(`  skipped — already non-null (match or conflict) .... ${counts.licenseSkippedNonNull}`);
  console.log(`    of which conflicts (disagrees with F-Droid) ..... ${counts.licenseConflicts}`);
  console.log(`  unmatched (not in current F-Droid index) ........... ${counts.licenseUnmatched}`);
  console.log(`  missing source value (F-Droid has none) ............ ${counts.licenseMissingSource}`);
  console.log("");
  console.log("  -- versions / target_sdk --");
  console.log(`  eligible for target SDK fill ........................ ${counts.targetSdkEligible}`);
  console.log(`  skipped — already non-null (match or conflict) ..... ${counts.targetSdkSkippedNonNull}`);
  console.log(`    of which conflicts (disagrees with F-Droid) ....... ${counts.targetSdkConflicts}`);
  console.log(`  unmatched (no build with this version_code) ........ ${counts.targetSdkUnmatched}`);
  console.log(`  missing source value (F-Droid build has none) ....... ${counts.targetSdkMissingSource}`);
  console.log("");
  console.log("  -- total intended writes by column --");
  console.log(`  apps.license ......................................... ${counts.licenseEligible}`);
  console.log(`  versions.target_sdk .................................. ${counts.targetSdkEligible}`);

  if (APPLY) {
    console.log("\n========================= APPLY RESULTS =========================\n");
    console.log(`  apps.license       applied ${counts.licenseApplied} · skipped-concurrent ${counts.licenseSkippedConcurrent} · errors ${counts.licenseErrors}`);
    console.log(`  versions.target_sdk applied ${counts.targetSdkApplied} · skipped-concurrent ${counts.targetSdkSkippedConcurrent} · errors ${counts.targetSdkErrors}`);
  }

  // ------------------------------------------------------------- report

  const report = {
    tool: "scripts/backfill-license-target-sdk.mjs",
    mode: APPLY ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    startedAt,
    fdroidIndex: { url: INDEX_URL, appCount: indexAppCount, fetchedAt: indexFetchedAt },
    scope: {
      fdroidRowsTotal: apps.length,
      fdroidRowsExamined: examined,
      limit: Number.isFinite(LIMIT) ? LIMIT : null,
    },
    counts,
    licenseWrites,
    targetSdkWrites,
  };

  const outPath = resolve(process.cwd(), REPORT_PATH);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n  JSON report written: ${outPath}`);

  if (!APPLY) {
    console.log(
      "\n  DRY RUN — nothing was written. Re-run with --apply --confirm=P2-1 " +
        "(needs the service key) to write.\n",
    );
  } else {
    console.log("");
  }
}

main().catch((error) => {
  console.error("\n  Backfill failed:", error?.message ?? error, "\n");
  process.exit(1);
});
