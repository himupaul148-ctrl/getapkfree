import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Step 2: static, source-level assertions against
 * scripts/import-play-metadata.mjs's --watchlist wiring — the same
 * constraint documented throughout this project (e.g.
 * lib/metadata/play-proposals-review-component.test.ts): a CLI entry point
 * with top-level argv parsing and process.exit() calls can't be imported
 * directly under plain `node --test` without triggering those side
 * effects, so these assertions read the script's literal text instead.
 * Everything the script actually delegates to (selection, health updates,
 * the propose pipeline itself) is exercised directly and behaviorally in
 * lib/metadata/play-watchlist.test.ts, play-watchlist-store.test.ts, and
 * play-watchlist-runner.test.ts.
 */

const scriptPath = fileURLToPath(new URL("../../scripts/import-play-metadata.mjs", import.meta.url));
const src = readFileSync(scriptPath, "utf8");

group("import-play-metadata.mjs — --watchlist wiring", () => {
  test("delegates to the runner module rather than duplicating its logic", () => {
    assert.match(src, /import \{ runWatchlistPropose \} from "\.\.\/lib\/metadata\/play-watchlist-runner\.ts";/);
    assert.match(src, /await runWatchlistPropose\(\{/);
  });

  test("--watchlist and --input are mutually exclusive", () => {
    assert.match(src, /if \(WATCHLIST && INPUT_PATH\)/);
  });

  test("--watchlist requires --propose — dry-run and apply are refused", () => {
    assert.match(src, /if \(WATCHLIST && writeMode\.mode !== "propose"\)/);
  });

  test("the watchlist footer text matches exactly what the task specified", () => {
    assert.match(src, /WATCHLIST PROPOSE MODE/);
    assert.match(
      src,
      /Only play_import_proposals and play_watchlist health fields were written\./,
    );
    assert.match(src, /No apps, versions, storage, or publishing were changed\./);
  });

  test("prints the required summary fields", () => {
    for (const label of [
      "enabled entries",
      "disabled entries",
      "successful fetches",
      "failed fetches",
      "new proposals",
      "metadata-update proposals",
      "unchanged",
      "F-Droid/ineligible",
      "superseded",
    ]) {
      assert.ok(src.includes(label), `expected the CLI output to mention "${label}"`);
    }
  });

  test("main() dispatches to the watchlist path before touching INPUT_PATH/readFile at all", () => {
    assert.match(src, /if \(WATCHLIST\) \{\s*\n\s*await runWatchlistCli\(\);\s*\n\s*return;\s*\n\s*\}/);
  });

  test("printProposeOutcome is reused by both the file-based propose mode and watchlist mode — no duplicated formatting", () => {
    const definitions = src.match(/function printProposeOutcome\(/g) ?? [];
    assert.equal(definitions.length, 1);
    const callSites = src.match(/printProposeOutcome\(/g) ?? [];
    // One definition + at least two call sites (file-based propose, watchlist).
    assert.ok(callSites.length >= 3, "expected printProposeOutcome to be called from more than one place");
  });
});

group("import-play-metadata.mjs — backward compatibility of --input/--dry-run/--apply", () => {
  test("--input=<file> is still required whenever --watchlist is not set", () => {
    assert.match(src, /if \(!WATCHLIST && !INPUT_PATH\)/);
  });

  test("the original file-reading, per-line dry-run/apply flow (processUrl) is unchanged and still present", () => {
    assert.match(src, /async function processUrl\(line\) \{/);
    assert.match(src, /const plan = planImport\(metadata, existing, parsed\.url\);/);
    assert.match(src, /await createExternalAppFromPlay\(writeClient, \{/);
    assert.match(src, /await applyPermittedChanges\(writeClient, plan\.appId, applied\);/);
  });

  test("the original file-based --propose flow (processUrlForPropose) is unchanged and still present", () => {
    assert.match(src, /async function processUrlForPropose\(line\) \{/);
    assert.match(src, /await proposeForPackage\(writeClient, \{/);
  });

  test("--apply still requires --confirm=PLAY-METADATA via the same resolveWriteMode() gate, untouched by --watchlist", () => {
    assert.match(src, /const writeMode = resolveWriteMode\(\{/);
    assert.match(src, /const APPLYING = writeMode\.mode === "apply";/);
  });

  test("the help text documents --watchlist without removing any existing flag's documentation", () => {
    for (const flagDoc of ["--input=<file>", "--dry-run", "--apply", "--propose", "--confirm=<value>", "--watchlist"]) {
      assert.ok(src.includes(flagDoc), `expected HELP_TEXT to still document ${flagDoc}`);
    }
  });
});

group("import-play-metadata.mjs — watchlist mode never writes outside its allowed surface", () => {
  test("the watchlist-specific CLI section never references apps/versions table calls directly", () => {
    const start = src.indexOf("// --------------------------------------------------------------- watchlist");
    const end = src.indexOf("function printProposeSummary(");
    assert.ok(start > -1 && end > start, "could not locate the watchlist CLI section");
    const section = src.slice(start, end);
    assert.doesNotMatch(section, /\.from\(["']apps["']\)/);
    assert.doesNotMatch(section, /\.from\(["']versions["']\)/);
    // The footer's own disclosure sentence legitimately mentions "storage"
    // (to say none happened) — what must never appear is an actual write
    // call against it.
    assert.doesNotMatch(section, /\.storage\.from\(/);
    assert.doesNotMatch(section, /storageUpload/i);
  });
});
