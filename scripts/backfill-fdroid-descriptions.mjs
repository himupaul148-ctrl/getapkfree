#!/usr/bin/env node
/**
 * One-time backfill for the 18 F-Droid apps identified by the catalogue audit
 * as having a description of 40 characters or fewer (or none at all).
 *
 *   node --env-file=.env.local scripts/backfill-fdroid-descriptions.mjs           # dry run (default)
 *   node --env-file=.env.local scripts/backfill-fdroid-descriptions.mjs --apply   # writes descriptions
 *
 * Deliberately scoped to a hardcoded list of 18 package names rather than
 * scanning the catalogue — this is a one-time fix for a specific, already
 * identified set of rows, not a general maintenance tool. Uses the exact
 * description-selection logic introduced in commit c82ebeb
 * (scripts/import-fdroid.mjs), duplicated here rather than imported, so this
 * script stays self-contained and the importer is not touched.
 *
 * On top of the c82ebeb logic, this script (only this script — the importer
 * is unmodified) applies two generic cleanup steps identified by a manual
 * review of the 18 candidates, both narrow and reversible:
 *
 *   1. trimToBoundary — the 400-char cap now prefers cutting at the last
 *      complete sentence, or failing that the last complete word, instead of
 *      slicing mid-word. Never invents text, never exceeds 400 chars, never
 *      produces an empty string from non-empty input.
 *   2. dedupeLeadingName — if a candidate opens with the app's own name
 *      immediately repeated ("Arcade Arcade is...", "🌠 Diadem Diadem is..."),
 *      the leading duplicate is removed, keeping the real sentence that
 *      follows. Anchored to the very start of the string only, so a
 *      legitimate mention of the app name later in the text is never touched.
 *
 * Five candidates needed more than generic cleanup (flattened headings/lists
 * on multi-launcher-home-screen and skylib, a missing separator on
 * ma-astronomy, a boilerplate URL-first opening on inselchaos-2026, an
 * off-tone contributor aside on eve-game-tracker) — the generic logic was
 * deliberately never taught to guess fixes for those, since re-punctuating
 * already-flattened text risks introducing new errors. Instead, each was
 * manually reviewed and hand-written, then approved, and is applied here via
 * MANUAL_OVERRIDES — a fixed map of slug -> exact approved text, used only
 * for these five exact rows, checked in below (not derived from live F-Droid
 * data at all, so no future index change can alter what these five write).
 *
 * Touches ONLY apps.description, and only for these 18 rows, and only when
 * the candidate description is non-empty and longer than what's stored.
 * Nothing else — name, icon, screenshots, versions, category, developer,
 * source_type — is ever read for a write, only for verification.
 */

import { createClient } from "@supabase/supabase-js";

const INDEX_URL = "https://f-droid.org/repo/index-v1.json";

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

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
      "  --apply writes to apps.description, and Row Level Security gives\n" +
      "  anon no write path, so an actual run needs the service role key.\n" +
      "  Dry run (the default, no flag) does not need it.",
  );
}
// Reads work with either key — apps.description is publicly readable, same
// as every other public-catalogue query in this project (see
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
 * The exact 18 rows identified by the audit. Slug is how we read/write the
 * row in our own database; packageName is how we find it in the F-Droid
 * index. Both were confirmed directly against the database immediately
 * before this list was written.
 */
const TARGETS = [
  { slug: "arcade", packageName: "com.arthur.arcade" },
  { slug: "couchy-launcher", packageName: "com.conreo.couchytv" },
  { slug: "diadem", packageName: "ee.malt.diadem" },
  { slug: "droidrops", packageName: "com.droidrops.app" },
  { slug: "emborg", packageName: "nl.renzit.emborg" },
  { slug: "enclavd", packageName: "com.enclavd.app" },
  { slug: "eve-game-tracker", packageName: "eve.game.tracker" },
  { slug: "filmflip", packageName: "org.jumascola.filmflip" },
  { slug: "hermes-mobile", packageName: "com.m57.hermescontrol" },
  { slug: "inselchaos-2026", packageName: "info.metadude.android.inselchaos.schedule" },
  { slug: "kiosk", packageName: "com.shapeshed.kiosk" },
  { slug: "libre-contacts-backup", packageName: "com.ashkanrafiee.librecontactsbackup" },
  { slug: "ma-astronomy", packageName: "com.vayunmathur.astronomy" },
  { slug: "multi-launcher-home-screen", packageName: "app.mlauncher" },
  { slug: "skylib", packageName: "dev.bg.skylib" },
  { slug: "tickdroid", packageName: "com.martinhammer.tickdroid" },
  { slug: "tuner", packageName: "com.bobek.tuner" },
  { slug: "wagebit", packageName: "com.wagebit.app" },
];

// ------------------------------------------------------------------ helpers

// Copied verbatim from scripts/import-fdroid.mjs rather than imported, so
// this one-time script has no dependency on (and makes no change to) the
// importer.
const stripHtml = (html) =>
  String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Cleanup step 1: prefer cutting a too-long candidate at a sentence or word
 * boundary within `max` chars, rather than mid-word. Falls back progressively
 * (sentence -> word -> raw window) so a non-empty input can never come out
 * empty, and the result never exceeds `max` chars.
 */
function trimToBoundary(text, max = 400) {
  const clean = text.trim();
  if (clean.length <= max) return clean;

  const window = clean.slice(0, max);

  const lastSentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (lastSentenceEnd > 0) return window.slice(0, lastSentenceEnd + 1).trim();

  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace > 0) return window.slice(0, lastSpace).trim();

  return window.trim();
}

/**
 * Cleanup step 2: some F-Droid entries open with the app's own name used as
 * a title, immediately followed by the actual sentence starting with the
 * name again ("Arcade Arcade is a minimal…", "🌠 Diadem Diadem is a…"). This
 * strips only that leading duplicate — anchored at the start of the string,
 * so it cannot touch a legitimate mention of the name anywhere else in the
 * text — and leaves everything untouched when the pattern isn't present.
 */
function dedupeLeadingName(text, appName) {
  const name = appName.trim();
  if (!text || !name) return text;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Optional leading symbols (emoji, punctuation) before the first name,
  // then the name repeated as the opening two "words" of the text.
  const pattern = new RegExp(`^[^A-Za-z0-9]*${escaped}\\s+(${escaped}\\b.*)$`, "i");
  const match = text.match(pattern);
  return match ? match[1].trim() : text;
}

/**
 * The exact selection logic from commit c82ebeb
 * (scripts/import-fdroid.mjs), applied here to one already-fetched F-Droid
 * app entry instead of the whole index, plus the two cleanup steps above.
 */
function selectDescription(app) {
  const localized = app.localized?.["en-US"] ?? app.localized?.en ?? {};
  const appName = (localized.name || app.name || "").trim();

  const rawSummary = stripHtml((localized.summary || app.summary || "").trim());
  const rawFullDescription = stripHtml((localized.description || app.description || "").trim());

  const summary = trimToBoundary(dedupeLeadingName(rawSummary, appName), 400);
  const fullDescription = trimToBoundary(dedupeLeadingName(rawFullDescription, appName), 400);

  return (fullDescription.length > summary.length ? fullDescription : summary) || null;
}

/**
 * Hand-written, human-approved replacements for the five rows the generic
 * selection logic couldn't clean up safely on its own. Only these five slugs
 * are affected; every other target still goes through selectDescription()
 * untouched. Every value is trimmed and length-checked below at load time,
 * before any network or database call, so a mistake here fails loudly
 * instead of silently writing something over 400 characters.
 */
const MANUAL_OVERRIDES = Object.fromEntries(
  Object.entries({
    "eve-game-tracker":
      " Eve Game Tracker is a tracker for card game results, currently supporting Skat, Poker, Durak, Gambio, and Uno, with the ability to add custom games. Features include a stats view, persistent player names, the option to disable games you don't play, and data export/import.",
    "inselchaos-2026":
      "A schedule app for the InselChaos conference on the island of Rügen. Browse the program by day and room, search and filter sessions, save favorites, set alarms for individual talks, and add sessions to your personal calendar.",
    "ma-astronomy":
      "An AR night sky viewer. This app helps you find planets, stars, and constellations in the night sky.",
    "multi-launcher-home-screen":
      "Multi Launcher is a minimalist Android launcher that replaces app icons with clear, readable text buttons for easier navigation. It offers customizable layouts, fonts, and gesture shortcuts, using Android's Accessibility service for actions like locking the screen, plus a biometric lock for its settings. It states it does not collect or share personal data.",
    "skylib":
      "Skylib is an alternative frontend for Bluesky that lets you browse local feeds and follows without a Bluesky account. It supports viewing profiles, posts, feeds, and your timeline, following users, and saving posts. All content is proxied through a Skylib instance, which can be self-hosted or public.",
  }).map(([slug, text]) => [slug, text.trim()]),
);

for (const [slug, text] of Object.entries(MANUAL_OVERRIDES)) {
  if (!text) fail(`Manual override for "${slug}" is empty after trimming.`);
  if (text.length > 400) {
    fail(`Manual override for "${slug}" is ${text.length} chars, over the 400-char limit.`);
  }
}

function truncateForDisplay(text, max = 60) {
  if (!text) return "(none)";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// -------------------------------------------------------------------- main

async function main() {
  console.log(
    `\nF-Droid description backfill — ${TARGETS.length} target apps` +
      `${APPLY ? ", APPLY MODE" : ", DRY RUN (default — pass --apply to write)"}\n`,
  );

  process.stdout.write("  Fetching F-Droid index (~59 MB)… ");
  const indexRes = await fetch(INDEX_URL);
  if (!indexRes.ok) fail(`Could not fetch the F-Droid index (${indexRes.status})`);
  const index = await indexRes.json();
  console.log(`${index.apps.length} apps in the repo.\n`);

  // O(1) lookups for 18 targets rather than an 18x scan of ~4000+ entries.
  const byPackage = new Map(index.apps.map((app) => [app.packageName, app]));

  const rows = [];
  const counts = { update: 0, skip: 0, notFound: 0, applied: 0, applyFailed: 0 };

  for (const target of TARGETS) {
    // Read fresh from the database every time — this script never trusts a
    // value from the earlier audit for anything but which rows to look at.
    const { data: current, error: readError } = await supabase
      .from("apps")
      .select("id, slug, name, source_type, description")
      .eq("slug", target.slug)
      .maybeSingle();

    if (readError) {
      rows.push({
        slug: target.slug,
        packageName: target.packageName,
        current: "(read error)",
        currentLen: "-",
        candidate: readError.message,
        candidateLen: "-",
        action: "SKIP",
      });
      counts.skip++;
      continue;
    }

    if (!current) {
      rows.push({
        slug: target.slug,
        packageName: target.packageName,
        current: "(no matching row)",
        currentLen: "-",
        candidate: "-",
        candidateLen: "-",
        action: "NOT FOUND",
      });
      counts.notFound++;
      continue;
    }

    // Safety check: confirm this row is still the F-Droid listing the audit
    // found, not something that changed since (e.g. re-typed as external).
    if (current.source_type !== "fdroid") {
      rows.push({
        slug: target.slug,
        packageName: target.packageName,
        current: truncateForDisplay(current.description),
        currentLen: current.description?.trim().length ?? 0,
        candidate: `(skipped: source_type is now "${current.source_type}", not fdroid)`,
        candidateLen: "-",
        action: "SKIP",
      });
      counts.skip++;
      continue;
    }

    const fdroidApp = byPackage.get(target.packageName);
    if (!fdroidApp) {
      rows.push({
        slug: target.slug,
        packageName: target.packageName,
        current: truncateForDisplay(current.description),
        currentLen: current.description?.trim().length ?? 0,
        candidate: "(package not in current F-Droid index)",
        candidateLen: "-",
        action: "NOT FOUND",
      });
      counts.notFound++;
      continue;
    }

    const currentDescription = current.description;
    const currentLen = currentDescription?.trim().length ?? 0;
    const override = MANUAL_OVERRIDES[target.slug];
    // The package-in-index check above still ran even for override rows —
    // that's a deliberate, separate safety check confirming the app is still
    // the live F-Droid listing this was reviewed against, not a source for
    // the override text itself (which is fixed and pre-approved).
    const candidate = override ?? selectDescription(fdroidApp);
    const candidateLen = candidate?.length ?? 0;

    // Requirement: never propose replacing a non-empty description with an
    // empty/shorter one, and only ever propose UPDATE when strictly longer.
    const shouldUpdate = Boolean(candidate) && candidateLen > currentLen;

    rows.push({
      slug: target.slug,
      packageName: target.packageName,
      current: truncateForDisplay(currentDescription),
      currentLen,
      candidate: truncateForDisplay(candidate),
      candidateLen,
      action: shouldUpdate ? "UPDATE" : "SKIP",
      usedOverride: Boolean(override),
      _appId: current.id,
      _currentDescriptionRaw: currentDescription,
      _candidateRaw: candidate,
      _shouldUpdate: shouldUpdate,
    });
    if (shouldUpdate) counts.update++;
    else counts.skip++;

    if (APPLY && shouldUpdate) {
      // Optimistic-concurrency guard: the WHERE clause requires the row's
      // description to still equal what we just read. If another process
      // changed it in between, this affects 0 rows instead of clobbering it.
      let query = supabase
        .from("apps")
        .update({ description: candidate })
        .eq("id", current.id)
        .eq("source_type", "fdroid");
      query =
        currentDescription === null
          ? query.is("description", null)
          : query.eq("description", currentDescription);

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
        console.log(`    ✓ ${target.slug}: description updated`);
        counts.applied++;
      }
    }
  }

  // ---------------------------------------------------------------- report

  console.log(
    "  slug".padEnd(29) +
      "package".padEnd(32) +
      "cur".padEnd(5) +
      "new".padEnd(5) +
      "action",
  );
  console.log("  " + "-".repeat(90));
  let overrideCount = 0;
  for (const row of rows) {
    const flag = row.usedOverride ? " — MANUAL OVERRIDE" : "";
    if (row.usedOverride) overrideCount++;
    console.log(
      `  ${row.slug}`.padEnd(29) +
        `${row.packageName}`.padEnd(32) +
        `${row.currentLen}`.padEnd(5) +
        `${row.candidateLen}`.padEnd(5) +
        row.action +
        flag,
    );
    console.log(`      current:   ${row.current}`);
    console.log(`      candidate: ${row.candidate}`);
  }

  console.log("\nSummary:");
  console.log(`  ${counts.update} would be updated (proposed, longer & non-empty)`);
  console.log(`  ${counts.skip} skipped (candidate not longer, empty, or ineligible)`);
  console.log(`  ${counts.notFound} not found (missing row or not in F-Droid index)`);
  console.log(`  ${overrideCount} used an approved manual override (see MANUAL_OVERRIDES)`);
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
