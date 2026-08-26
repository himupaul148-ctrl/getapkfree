/**
 * One-off repair for apps imported before the media resolver existed.
 *
 * The original importer read only `app.icon` and never looked at
 * `phoneScreenshots`, so every F-Droid row landed with an empty gallery and
 * roughly a third of them with no icon. This walks the current index and
 * fills in what is missing.
 *
 * Only ever writes to a field that is currently empty, so re-running is safe
 * and hand-corrected rows are left alone.
 *
 *   node --env-file=.env.local scripts/backfill-media.mjs [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";

import { resolveMedia } from "./fdroid-media.mjs";

const INDEX_URL = "https://f-droid.org/repo/index-v1.json";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

console.log(`Fetching ${INDEX_URL} …`);
const index = await (await fetch(INDEX_URL)).json();
const byPackage = new Map(index.apps.map((a) => [a.packageName, a]));
console.log(`  ${byPackage.size} apps in index\n`);

const { data: rows, error } = await db
  .from("apps")
  .select("id, name, package_name, icon_url, screenshots")
  .not("package_name", "is", null);

if (error) {
  console.error("Could not read apps:", error.message);
  process.exit(1);
}

let fixedIcon = 0;
let fixedShots = 0;
let notInIndex = 0;
let nothingToDo = 0;

for (const row of rows) {
  const app = byPackage.get(row.package_name);
  if (!app) {
    notInIndex++;
    continue;
  }

  const media = resolveMedia(app, row.package_name);
  const patch = {};

  if (!row.icon_url && media.iconUrl) patch.icon_url = media.iconUrl;

  const hasShots = (row.screenshots ?? []).length > 0;
  if (!hasShots && media.screenshots.length) patch.screenshots = media.screenshots;

  if (Object.keys(patch).length === 0) {
    nothingToDo++;
    continue;
  }

  if (patch.icon_url) fixedIcon++;
  if (patch.screenshots) fixedShots++;

  if (!DRY_RUN) {
    const { error: upErr } = await db.from("apps").update(patch).eq("id", row.id);
    if (upErr) {
      console.error(`  ! ${row.name}: ${upErr.message}`);
      continue;
    }
  }

  console.log(
    `  ${DRY_RUN ? "would fix" : "fixed"} ${row.name} —` +
      `${patch.icon_url ? " icon" : ""}` +
      `${patch.screenshots ? ` ${patch.screenshots.length} screenshots` : ""}`,
  );
}

console.log(`
${DRY_RUN ? "Dry run" : "Done"}:
  icons filled in    ${fixedIcon}
  galleries filled   ${fixedShots}
  already complete   ${nothingToDo}
  not in index       ${notInIndex}
`);
