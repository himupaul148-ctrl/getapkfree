#!/usr/bin/env node
/**
 * One-time backfill for the 7 F-Droid apps identified by the media-gap
 * investigation as having a screenshot and/or icon available in the current
 * F-Droid index that our database doesn't have yet.
 *
 *   node --env-file=.env.local scripts/backfill-fdroid-media.mjs           # dry run (default)
 *   node --env-file=.env.local scripts/backfill-fdroid-media.mjs --apply   # writes icon_url/screenshots
 *
 * Deliberately scoped to a hardcoded list of 7 package names rather than
 * scanning the catalogue — this is a one-time fix for a specific,
 * already-identified set of rows, not a general maintenance tool. Reuses
 * resolveMedia() from scripts/fdroid-media.mjs completely unmodified — no
 * new media-resolution logic, same function scripts/import-fdroid.mjs
 * already calls at import time.
 *
 * Touches ONLY apps.icon_url and apps.screenshots, and only for these 7
 * rows, and only for whichever of those two fields is currently null/empty
 * AND has a resolved value available — an app that already has an icon
 * keeps it untouched even if it's also missing screenshots, and vice versa.
 * Nothing else — name, description, versions, category, developer,
 * source_type, external listings — is ever read for a write, only for
 * verification.
 */

import { createClient } from "@supabase/supabase-js";
import { resolveMedia } from "./fdroid-media.mjs";

const INDEX_URL = "https://f-droid.org/repo/index-v1.json";

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
// Optional --only=slug1,slug2 to scope a run to specific targets without
// touching the ones that already succeeded — e.g. re-running just the rows
// a prior --apply failed on, without re-processing everything.
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").filter(Boolean)) : null;

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
      "  --apply writes to apps.icon_url/screenshots, and Row Level Security\n" +
      "  gives anon no write path, so an actual run needs the service role key.\n" +
      "  Dry run (the default, no flag) does not need it.",
  );
}
// Reads work with either key — apps.icon_url/screenshots are publicly
// readable, same as every other public-catalogue query in this project (see
// lib/supabase/public.ts). Prefer the service key when it's already set so
// dry-run and --apply see the database through the same client.
const READ_KEY = SERVICE_KEY || ANON_KEY;
if (!READ_KEY) {
  fail(
    "Need NEXT_PUBLIC_SUPABASE_ANON_KEY (for a dry run) or " +
      "SUPABASE_SERVICE_ROLE_KEY (required for --apply) in .env.local",
  );
}

const supabase = createClient(SUPABASE_URL, READ_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ----------------------------------------------------------------- targets

/**
 * The exact 7 rows identified by the media-gap investigation as having a
 * screenshot and/or icon available in the current F-Droid index right now.
 * Confirmed directly against a live fetch of the index immediately before
 * this list was written. Which field(s) each app actually needs is decided
 * at run time (see the per-row "only if currently missing" guard below),
 * not hardcoded here, so a row with only one gap never touches the other.
 */
const TARGETS = [
  { slug: "cyclauncher", packageName: "dev.msbs.cyclauncher" },
  { slug: "hermes-mobile", packageName: "com.m57.hermescontrol" },
  { slug: "inselchaos-2026", packageName: "info.metadude.android.inselchaos.schedule" },
  { slug: "kifossk", packageName: "com.shinydiscoballsdev.kifossk" },
  { slug: "bayesianbahn", packageName: "io.github.derweh.bayesianbahn" },
  { slug: "filmflip", packageName: "org.jumascola.filmflip" },
  { slug: "tryst", packageName: "app.tryst" },
];

// ------------------------------------------------------------------ helpers

function hasIcon(url) {
  return typeof url === "string" && url.trim().length > 0;
}

function hasScreenshots(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

// -------------------------------------------------------------------- main

async function main() {
  console.log(
    `\nF-Droid media backfill — ${TARGETS.length} target apps` +
      `${APPLY ? ", APPLY MODE" : ", DRY RUN (default — pass --apply to write)"}\n`,
  );

  process.stdout.write("  Fetching F-Droid index (~59 MB)… ");
  const indexRes = await fetch(INDEX_URL);
  if (!indexRes.ok) fail(`Could not fetch the F-Droid index (${indexRes.status})`);
  const index = await indexRes.json();
  console.log(`${index.apps.length} apps in the repo.\n`);

  const byPackage = new Map(index.apps.map((app) => [app.packageName, app]));

  const rows = [];
  const counts = { update: 0, skip: 0, notFound: 0, applied: 0, applyFailed: 0 };

  for (const target of TARGETS) {
    if (ONLY && !ONLY.has(target.slug)) continue;

    // Read fresh from the database every time — this script never trusts a
    // value from the earlier investigation for anything but which rows to
    // look at.
    const { data: current, error: readError } = await supabase
      .from("apps")
      .select("id, slug, name, source_type, icon_url, screenshots")
      .eq("slug", target.slug)
      .maybeSingle();

    if (readError) {
      rows.push({ slug: target.slug, note: `read error: ${readError.message}`, action: "SKIP" });
      counts.skip++;
      continue;
    }

    if (!current) {
      rows.push({ slug: target.slug, note: "no matching row", action: "NOT FOUND" });
      counts.notFound++;
      continue;
    }

    // Safety check: confirm this row is still the F-Droid listing the
    // investigation found, not something that changed since.
    if (current.source_type !== "fdroid") {
      rows.push({
        slug: target.slug,
        note: `skipped: source_type is now "${current.source_type}", not fdroid`,
        action: "SKIP",
      });
      counts.skip++;
      continue;
    }

    const fdroidApp = byPackage.get(target.packageName);
    if (!fdroidApp) {
      rows.push({ slug: target.slug, note: "package not in current F-Droid index", action: "NOT FOUND" });
      counts.notFound++;
      continue;
    }

    const media = resolveMedia(fdroidApp, target.packageName);

    const currentHasIcon = hasIcon(current.icon_url);
    const currentHasScreens = hasScreenshots(current.screenshots);

    const canFillIcon = !currentHasIcon && hasIcon(media.iconUrl);
    const canFillScreens = !currentHasScreens && hasScreenshots(media.screenshots);

    const willUpdate = canFillIcon || canFillScreens;

    const update = {};
    if (canFillIcon) update.icon_url = media.iconUrl;
    if (canFillScreens) update.screenshots = media.screenshots;

    rows.push({
      slug: target.slug,
      currentIcon: currentHasIcon ? "present" : "(none)",
      newIcon: canFillIcon ? media.iconUrl : currentHasIcon ? "(unchanged)" : "(still none upstream)",
      currentScreens: currentHasScreens ? `${current.screenshots.length} present` : "(none)",
      newScreens: canFillScreens
        ? `${media.screenshots.length} resolved`
        : currentHasScreens
          ? "(unchanged)"
          : "(still none upstream)",
      action: willUpdate ? "UPDATE" : "SKIP",
      _appId: current.id,
      _current: { icon_url: current.icon_url, screenshots: current.screenshots },
      _update: update,
      _willUpdate: willUpdate,
    });
    if (willUpdate) counts.update++;
    else counts.skip++;

    if (APPLY && willUpdate) {
      // Optimistic-concurrency guard: the WHERE clause requires each touched
      // field to still hold the value we just read (null/empty), so a
      // concurrent change lands as 0 rows affected instead of being
      // clobbered.
      let query = supabase
        .from("apps")
        .update(update)
        .eq("id", current.id)
        .eq("source_type", "fdroid");

      if (canFillIcon) {
        query = current.icon_url === null ? query.is("icon_url", null) : query.eq("icon_url", current.icon_url);
      }
      if (canFillScreens) {
        // canFillScreens only ever fires when the current value failed
        // hasScreenshots() — i.e. it's either null or an empty array, never
        // a non-empty one — so the only two guard shapes needed here are
        // "is null" and "equals the empty array". Passing a JS `[]` to
        // .eq() for a text[] column produces "malformed array literal: ''"
        // from PostgREST; the fix is passing Postgres's own empty-array
        // literal string instead.
        query =
          current.screenshots === null
            ? query.is("screenshots", null)
            : query.eq("screenshots", "{}");
      }

      const { data: updated, error: updateError } = await query.select("id");

      if (updateError) {
        console.error(`    ✗ ${target.slug}: ${updateError.message}`);
        counts.applyFailed++;
      } else if (!updated || updated.length === 0) {
        console.error(
          `    ✗ ${target.slug}: row changed since it was read — skipped rather than overwritten`,
        );
        counts.applyFailed++;
      } else {
        console.log(`    ✓ ${target.slug}: media updated`);
        counts.applied++;
      }
    }
  }

  // ---------------------------------------------------------------- report

  for (const row of rows) {
    console.log(`  ${row.slug} — ${row.action}`);
    if (row.note) {
      console.log(`      ${row.note}`);
      continue;
    }
    console.log(`      icon:        ${row.currentIcon}  ->  ${row.newIcon}`);
    console.log(`      screenshots: ${row.currentScreens}  ->  ${row.newScreens}`);
  }

  console.log("\nSummary:");
  console.log(`  ${counts.update} would be updated (icon and/or screenshots newly filled)`);
  console.log(`  ${counts.skip} skipped (nothing new to fill, or ineligible)`);
  console.log(`  ${counts.notFound} not found (missing row or not in F-Droid index)`);
  if (APPLY) {
    console.log(`  ${counts.applied} actually updated`);
    console.log(`  ${counts.applyFailed} failed / skipped at write time (concurrency guard or error)`);
  } else {
    console.log("\n  DRY RUN — nothing was written. Re-run with --apply to write.\n");
  }
}

main().catch((error) => {
  console.error("\n  Backfill failed:", error?.message ?? error, "\n");
  process.exit(1);
});
