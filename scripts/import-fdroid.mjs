/**
 * Bulk-import apps from F-Droid's public index.
 *
 *   npm run import-fdroid                    # 250 apps
 *   npm run import-fdroid -- --limit=5       # smaller batch
 *   npm run import-fdroid -- --dry-run       # parse and report, write nothing
 *   npm run import-fdroid -- --skip-scan     # no VirusTotal; everything pending
 *
 * No APK is ever downloaded. F-Droid publishes a SHA-256 for every build, and
 * VirusTotal accepts hash lookups, so a verdict costs one cheap GET instead of
 * fetching ~16 MB and uploading it again.
 *
 * Re-runnable: existing package names are skipped, so a second run tops up
 * rather than duplicating, and an interrupted run can simply be restarted.
 */

import { createClient } from "@supabase/supabase-js";

import { resolveMedia } from "./fdroid-media.mjs";
import { createVirusTotalScanner, VT_RETRY_INTERVAL_MS } from "../lib/apk/virustotal.ts";
import { selectFdroidBuild } from "../lib/apk/select-fdroid-build.ts";
import { licenseFromFdroidApp, targetSdkFromFdroidBuild } from "../lib/apk/fdroid-license-sdk.ts";

const INDEX_URL = "https://f-droid.org/repo/index-v1.json";
const REPO_BASE = "https://f-droid.org/repo";

// Same pacing the VirusTotal hash-lookup module retries with internally —
// kept as its own name here since this constant paces the import loop
// between apps, a different purpose from the module's own retry backoff.
const VT_INTERVAL_MS = VT_RETRY_INTERVAL_MS;

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};

const LIMIT = Number(value("limit", "250"));
const DRY_RUN = flag("dry-run");
const SKIP_SCAN = flag("skip-scan");

// ------------------------------------------------------------------- setup

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VT_KEY = process.env.VIRUSTOTAL_API_KEY;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("NEXT_PUBLIC_SUPABASE_URL is missing from .env.local");
if (!DRY_RUN && !SERVICE_KEY) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.\n" +
      "  Supabase Dashboard -> Project Settings -> API Keys -> service_role.\n" +
      "  Row Level Security gives anon no write path, so the import needs it.\n" +
      "  (Try --dry-run to preview without writing.)",
  );
}
if (!SKIP_SCAN && !VT_KEY) {
  fail("VIRUSTOTAL_API_KEY is missing from .env.local (or pass --skip-scan)");
}

// service_role bypasses RLS. Local use only — never ship this to a browser.
const supabase =
  DRY_RUN && !SERVICE_KEY
    ? null
    : createClient(SUPABASE_URL, SERVICE_KEY ?? "", {
        auth: { persistSession: false, autoRefreshToken: false },
      });

// ------------------------------------------------------------------ mapping

/**
 * F-Droid now tags apps with fine-grained sub-categories ("Puzzle Game",
 * "VPN & Proxy", "Note") rather than the old 17 top-level ones, so an exact
 * table alone leaves most apps unmatched. Explicit entries first, then keyword
 * rules, then Tools as the catch-all.
 */
const CATEGORY_MAP = {
  // legacy top-level names, still present on older entries
  Games: "Games",
  Multimedia: "Multimedia",
  Graphics: "Multimedia",
  Internet: "Internet",
  Connectivity: "Internet",
  System: "System",
  Theming: "System",
  Security: "System",
  "Science & Education": "Education",
  Writing: "Writing",
  Reading: "Writing",
  Time: "Productivity",
  Money: "Productivity",
  "Sports & Health": "Productivity",
  Development: "Tools",
  Navigation: "Tools",
  "Phone & SMS": "Tools",

  // current sub-categories, most common first
  Messaging: "Internet",
  "Social Network": "Internet",
  Email: "Internet",
  News: "Internet",
  Browser: "Internet",
  "VPN & Proxy": "Internet",
  Forum: "Internet",
  Download: "Internet",
  "File Transfer": "Internet",
  "Cloud Storage & File Sync": "Internet",
  "Remote Access": "Internet",
  "AI Chat": "Internet",

  Camera: "Multimedia",
  Gallery: "Multimedia",
  Podcast: "Multimedia",
  Radio: "Multimedia",
  Lyrics: "Multimedia",
  Recorder: "Multimedia",
  Cast: "Multimedia",
  Draw: "Multimedia",
  "Local Media Player": "Multimedia",
  "Online Media Player": "Multimedia",
  "Music Practice Tool": "Multimedia",

  Launcher: "System",
  "Keyboard & IME": "System",
  Notification: "System",
  Volume: "System",
  "App Manager": "System",
  Firewall: "System",
  Wallpaper: "System",
  "File Manager": "System",
  "Password & 2FA": "System",
  "File Encryption & Vault": "System",

  Note: "Writing",
  "Text Editor": "Writing",
  "Ebook Reader": "Writing",
  Bookmark: "Writing",

  Task: "Productivity",
  Timer: "Productivity",
  "Time Tracker": "Productivity",
  Schedule: "Productivity",
  "Calendar & Agenda": "Productivity",
  Clock: "Productivity",
  "Alarm Clock": "Productivity",
  "Habit Tracker": "Productivity",
  "Finance Manager": "Productivity",
  Wallet: "Productivity",
  "Pass Wallet": "Productivity",
  "Market & Price": "Productivity",
  "Shopping List": "Productivity",
  "Recipe Manager": "Productivity",
  Inventory: "Productivity",
  Diet: "Productivity",
  "Health Manager": "Productivity",
  Workout: "Productivity",
  Meditation: "Productivity",

  "Translation & Dictionary": "Education",
  "Text to Speech": "Education",
  OCR: "Education",
  Weather: "Education",
  Religion: "Education",

  "Public Transport": "Tools",
  "Network Analyzer": "Tools",
  "Remote Controller": "Tools",
  Contact: "Tools",
};

/** Applied in order when no exact match exists. */
const CATEGORY_RULES = [
  [/game|puzzle|arcade|rpg|shooter|platformer|dice|card|board|party|word|strategy|casual|role-playing/i, "Games"],
  [/media|music|audio|video|player|photo|image|camera|podcast|radio|paint|draw|graphic/i, "Multimedia"],
  [/net|web|chat|messag|social|mail|feed|rss|browser|vpn|proxy|torrent|share|sync|cloud|remote/i, "Internet"],
  [/system|launcher|keyboard|theme|root|firewall|permission|backup|file|storage|battery|device/i, "System"],
  [/learn|educat|science|study|language|dictionar|translat|math|book|reference|weather/i, "Education"],
  [/writ|note|text|editor|journal|diary|markdown|read/i, "Writing"],
  [/task|todo|time|calendar|schedule|habit|money|finance|budget|wallet|shop|health|fitness|sport|food|diet/i, "Productivity"],
];

const API_TO_RELEASE = {
  16: "4.1", 17: "4.2", 18: "4.3", 19: "4.4", 20: "4.4",
  21: "5.0", 22: "5.1", 23: "6.0", 24: "7.0", 25: "7.1",
  26: "8.0", 27: "8.1", 28: "9.0", 29: "10.0", 30: "11.0",
  31: "12.0", 32: "12.1", 33: "13.0", 34: "14.0", 35: "15.0",
  36: "16.0",
};

function mapCategory(categories) {
  const tags = categories ?? [];
  for (const tag of tags) if (CATEGORY_MAP[tag]) return CATEGORY_MAP[tag];
  for (const tag of tags) {
    for (const [pattern, target] of CATEGORY_RULES) {
      if (pattern.test(tag)) return target;
    }
  }
  return "Tools";
}

const releaseFromApiLevel = (level) => {
  const api = Number(level);
  if (!Number.isFinite(api) || api <= 0) return null;
  return API_TO_RELEASE[api] ?? String(api);
};

const stripHtml = (html) =>
  String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function developerFrom(app) {
  if (app.authorName?.trim()) return app.authorName.trim();
  const source = app.sourceCode || app.webSite;
  if (source) {
    try {
      const { hostname, pathname } = new URL(source);
      // github.com/owner/repo -> owner reads better than the bare host.
      const owner = pathname.split("/").filter(Boolean)[0];
      if (/(github|gitlab|codeberg)\./.test(hostname) && owner) return owner;
      return hostname.replace(/^www\./, "");
    } catch {
      /* fall through */
    }
  }
  return "Unknown";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -------------------------------------------------------------- virustotal

// Extracted to lib/apk/virustotal.ts so the URL-import pipeline and the
// admin verify route can reuse the exact same hash-lookup semantics. One
// scanner is created for the whole run, so its call count and exhaustion
// state track the entire batch — exactly what the old module-level
// vtCalls/vtExhausted variables did.
const vtScanner = createVirusTotalScanner({ apiKey: VT_KEY, skipScan: SKIP_SCAN });
const scanByHash = (sha256) => vtScanner.scanByHash(sha256);

// -------------------------------------------------------------------- main

async function main() {
  console.log(
    `\nF-Droid import — limit ${LIMIT}${DRY_RUN ? ", DRY RUN" : ""}${
      SKIP_SCAN ? ", scanning disabled" : ""
    }\n`,
  );

  process.stdout.write("  Fetching index (~59 MB)… ");
  const indexRes = await fetch(INDEX_URL);
  if (!indexRes.ok) fail(`Could not fetch the F-Droid index (${indexRes.status})`);
  const index = await indexRes.json();
  console.log(`${index.apps.length} apps in the repo.`);

  // Everything already in the catalogue, fetched once.
  let known = new Set();
  if (supabase) {
    const { data, error } = await supabase.from("apps").select("package_name");
    if (error) fail(`Could not read existing apps: ${error.message}`);
    known = new Set((data ?? []).map((r) => r.package_name));
    console.log(`  ${known.size} apps already in the catalogue.\n`);
  }

  const skips = { existing: 0, noPackage: 0, badMetadata: 0, failed: 0 };
  let imported = 0;
  let flagged = 0;
  let pending = 0;

  // Newest additions first, so a partial run still brings in current apps.
  const candidates = [...index.apps].sort(
    (a, b) => (b.added ?? 0) - (a.added ?? 0),
  );

  for (const app of candidates) {
    if (imported >= LIMIT) break;

    const packageName = app.packageName;
    if (!packageName) {
      skips.badMetadata++;
      continue;
    }
    if (known.has(packageName)) {
      skips.existing++;
      continue;
    }

    // Index lists every build newest-first. Usually that first entry is the
    // one to use, but some apps ship a separate APK per CPU architecture for
    // the same release — selectFdroidBuild prefers an arm64-v8a/armeabi-v7a
    // build over whichever arch happened to land the highest versionCode.
    const build = selectFdroidBuild(index.packages?.[packageName] ?? []);
    if (!build?.apkName || !build.versionName || !build.versionCode) {
      skips.noPackage++;
      continue;
    }

    const localized = app.localized?.["en-US"] ?? app.localized?.en ?? {};
    const name = (localized.name || app.name || "").trim();
    // Prefer the fuller description when it actually says more than the
    // one-line summary; some entries only ever populate one field or the
    // other, so summary stays the fallback rather than being dropped.
    const summary = stripHtml((localized.summary || app.summary || "").trim()).slice(0, 400);
    const fullDescription = stripHtml((localized.description || app.description || "").trim()).slice(0, 400);
    const description = (fullDescription.length > summary.length ? fullDescription : summary) || null;

    if (!name) {
      skips.badMetadata++;
      continue;
    }

    const verdict = await scanByHash(
      build.hashType === "sha256" ? build.hash : null,
    );
    if (verdict === "flagged") flagged++;
    if (verdict === "pending") pending++;

    // Icon and screenshots both hide in the localized block for roughly half
    // the index; resolveMedia knows where to look.
    const media = resolveMedia(app, packageName);

    const row = {
      name,
      slug: slugify(name) || slugify(packageName),
      package_name: packageName,
      category: mapCategory(app.categories),
      description: description || null,
      icon_url: media.iconUrl,
      screenshots: media.screenshots,
      developer_name: developerFrom(app),
      license: licenseFromFdroidApp(app),
    };

    const version = {
      version_name: String(build.versionName),
      version_code: Number(build.versionCode),
      file_url: `${REPO_BASE}/${build.apkName}`,
      file_size: build.size ?? null,
      min_android_version: releaseFromApiLevel(build.minSdkVersion),
      target_sdk: targetSdkFromFdroidBuild(build),
      permissions: (build["uses-permission"] ?? [])
        .map((p) => (Array.isArray(p) ? p[0] : p))
        .filter((p) => typeof p === "string"),
      changelog: localized.whatsNew?.trim() || null,
      scan_status: verdict,
      // Only a clean verdict goes public — the site claims every listed build
      // passed a scan, and publishing an unscanned one would break that.
      published: verdict === "clean",
      scanned_at: verdict === "pending" ? null : new Date().toISOString(),
    };

    const mark = verdict === "clean" ? "+" : verdict === "flagged" ? "!" : "?";
    console.log(
      `  ${mark} ${name} — ${row.category}, v${version.version_name} [${verdict}]`,
    );

    if (DRY_RUN) {
      imported++;
      known.add(packageName);
      if (!SKIP_SCAN) await sleep(VT_INTERVAL_MS);
      continue;
    }

    try {
      // Slug is unique; suffix on collision rather than losing the app.
      const { data: clash } = await supabase
        .from("apps")
        .select("id")
        .eq("slug", row.slug)
        .maybeSingle();
      if (clash) row.slug = `${row.slug}-${packageName.split(".").pop()}`.slice(0, 60);

      const { data: created, error: appError } = await supabase
        .from("apps")
        .insert(row)
        .select("id")
        .single();
      if (appError) throw appError;

      const { error: versionError } = await supabase
        .from("versions")
        .insert({ ...version, app_id: created.id });
      if (versionError) throw versionError;

      imported++;
      known.add(packageName);
    } catch (caught) {
      skips.failed++;
      console.log(`    skipped: ${caught.message ?? caught}`);
    }

    if (!SKIP_SCAN && !vtScanner.exhausted) await sleep(VT_INTERVAL_MS);
  }

  const skipped =
    skips.existing + skips.noPackage + skips.badMetadata + skips.failed;

  console.log(
    `\nImported ${imported} apps, ${flagged} flagged for review, ${skipped} skipped`,
  );
  console.log(
    `  already present ${skips.existing} · no usable build ${skips.noPackage} · ` +
      `incomplete metadata ${skips.badMetadata} · insert failed ${skips.failed}`,
  );
  if (pending) {
    console.log(
      `  ${pending} saved unpublished with scan_status='pending' — no VirusTotal verdict yet.`,
    );
  }
  console.log(`  VirusTotal requests used: ${vtScanner.callsUsed}`);
  if (DRY_RUN) console.log("  DRY RUN — nothing was written.\n");
  else console.log("");
}

main().catch((error) => {
  console.error("\n  Import failed:", error?.message ?? error, "\n");
  process.exit(1);
});
