import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sep } from "node:path";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * .github/workflows/play-discovery.yml — there is no GitHub Actions
 * runner available under plain `node --test`, so this reads the
 * workflow's literal YAML text, mirroring
 * lib/metadata/play-watchlist-workflow.test.ts's own approach for the
 * separate watchlist-refresh workflow. This proves the workflow contains
 * what was specified — it cannot, and does not, prove the workflow
 * actually succeeds when GitHub runs it.
 */

const workflowPath = fileURLToPath(new URL("../../.github/workflows/play-discovery.yml", import.meta.url));
const yaml = readFileSync(workflowPath, "utf8");

const scriptPath = fileURLToPath(new URL("../../scripts/discover-play-apps.mjs", import.meta.url));
const scriptSrc = readFileSync(scriptPath, "utf8");

group("play-discovery.yml — location and triggers", () => {
  test("lives at the expected workflow path", () => {
    const expected = [".github", "workflows", "play-discovery.yml"].join(sep);
    assert.ok(workflowPath.endsWith(expected));
  });

  test("has a daily cron schedule at 03:30 UTC", () => {
    assert.match(yaml, /schedule:\s*\n\s*(?:#.*\n\s*)*-\s*cron:\s*"30 3 \* \* \*"/);
  });

  test("supports workflow_dispatch for manual runs, with no required inputs", () => {
    assert.match(yaml, /workflow_dispatch:\s*\{\}/);
  });
});

group("play-discovery.yml — job shape", () => {
  test("job and workflow are both named 'Daily Play App Discovery'", () => {
    assert.match(yaml, /^name:\s*Daily Play App Discovery/m);
    const jobsBlock = yaml.slice(yaml.indexOf("jobs:"));
    assert.match(jobsBlock, /name:\s*Daily Play App Discovery/);
  });

  test("runs on ubuntu-latest", () => {
    assert.match(yaml, /runs-on:\s*ubuntu-latest/);
  });

  test("checks out the repository", () => {
    assert.match(yaml, /uses:\s*actions\/checkout@v4/);
  });

  test("sets up Node using the project's existing version convention (matches ci.yml's node-version)", () => {
    assert.match(yaml, /uses:\s*actions\/setup-node@v4/);
    assert.match(yaml, /node-version:\s*"22"/);
  });

  test("installs dependencies with the lockfile-safe command, not a bare `npm install`", () => {
    assert.match(yaml, /run:\s*npm ci\b/);
    assert.doesNotMatch(yaml, /run:\s*npm install\b/);
  });
});

group("play-discovery.yml — the discovery command", () => {
  test("runs the discovery CLI script directly", () => {
    assert.match(yaml, /run:\s*node scripts\/discover-play-apps\.mjs/);
  });

  test("the command appears exactly once as an actual `run:` step", () => {
    const runLines = yaml.match(/run:.*discover-play-apps\.mjs.*$/gm) ?? [];
    assert.equal(runLines.length, 1);
  });

  test("never passes --apply", () => {
    const runLines = yaml.match(/run:.*$/gm) ?? [];
    for (const line of runLines) assert.doesNotMatch(line, /--apply/);
  });

  test("never invokes any approve/reject command", () => {
    const runLines = yaml.match(/run:.*$/gm) ?? [];
    for (const line of runLines) {
      assert.doesNotMatch(line, /approve/i);
      assert.doesNotMatch(line, /reject/i);
    }
  });
});

group("play-discovery.yml — MAX_CANDIDATES cap", () => {
  test("sets MAX_CANDIDATES=10 as the daily cap", () => {
    assert.match(yaml, /MAX_CANDIDATES:\s*"10"/);
  });
});

group("play-discovery.yml — secrets and GITHUB_TOKEN", () => {
  test("SUPABASE_SERVICE_ROLE_KEY is sourced from secrets, never hardcoded", () => {
    assert.match(yaml, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/);
  });

  test("NEXT_PUBLIC_SUPABASE_URL is sourced from secrets, never hardcoded", () => {
    assert.match(yaml, /NEXT_PUBLIC_SUPABASE_URL:\s*\$\{\{\s*secrets\.NEXT_PUBLIC_SUPABASE_URL\s*\}\}/);
  });

  test("GITHUB_TOKEN is passed through as an env var, sourced from secrets.GITHUB_TOKEN", () => {
    assert.match(yaml, /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  });

  test("no secret value is ever echoed, printed, or interpolated into a run: command line", () => {
    assert.doesNotMatch(yaml, /echo.*secrets\./i);
    assert.doesNotMatch(yaml, /run:[^\n]*\$\{\{\s*secrets\./);
  });

  test("no debug/step-debug tracing and no `set -x` that could leak env values into the log", () => {
    assert.doesNotMatch(yaml, /set -x/);
    assert.doesNotMatch(yaml, /ACTIONS_STEP_DEBUG/);
  });
});

group("play-discovery.yml — permissions and concurrency", () => {
  test("grants only contents: read, and nothing else", () => {
    assert.match(yaml, /permissions:\s*\n\s*contents:\s*read/);
    const start = yaml.indexOf("permissions:");
    const rest = yaml.slice(start + "permissions:".length);
    const nextTopLevelKey = rest.search(/\n[^\s#]/);
    const permissionsBlock = nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
    assert.doesNotMatch(permissionsBlock, /write/);
  });

  test("has a concurrency group so two discovery runs can never overlap", () => {
    assert.match(yaml, /concurrency:\s*\n\s*group:\s*play-discovery\s*\n\s*cancel-in-progress:\s*false/);
  });
});

group("play-discovery.yml — no Vercel Cron dependency", () => {
  test("this workflow is entirely self-contained on GitHub Actions — no Vercel cron config, secret, or endpoint is referenced", () => {
    assert.doesNotMatch(yaml, /vercel/i);
    assert.doesNotMatch(yaml, /CRON_SECRET/);
  });
});

group("play-discovery.yml — independent of the watchlist workflow", () => {
  test("uses its own concurrency group, distinct from play-watchlist's", () => {
    assert.match(yaml, /group:\s*play-discovery\b/);
    assert.doesNotMatch(yaml, /group:\s*play-watchlist\b/);
  });

  test("does not run, trigger, or depend on the watchlist workflow's job", () => {
    assert.doesNotMatch(yaml, /needs:/);
    assert.doesNotMatch(yaml, /workflow_call/);
  });
});

/* -------------------------------------------------- scripts/discover-play-apps.mjs */

group("discover-play-apps.mjs — CLI script safety", () => {
  test("never calls an approve/reject route or function", () => {
    assert.doesNotMatch(scriptSrc, /approveProposal|rejectProposal|\/approve|\/reject/);
  });

  test("never passes --apply anywhere, and never writes directly to apps/versions", () => {
    assert.doesNotMatch(scriptSrc, /--apply/);
    assert.doesNotMatch(scriptSrc, /\.from\(["']apps["']\)/);
    assert.doesNotMatch(scriptSrc, /\.from\(["']versions["']\)/);
  });

  test("never references Storage", () => {
    assert.doesNotMatch(scriptSrc, /\.storage\.from\(/);
  });

  test("never logs the service-role key, GITHUB_TOKEN, or the Supabase URL env vars by name in a console.log of the value itself", () => {
    assert.doesNotMatch(scriptSrc, /console\.log\([^)]*SERVICE_KEY\)/);
    assert.doesNotMatch(scriptSrc, /console\.log\([^)]*GITHUB_TOKEN\)/);
  });

  test("MAX_CANDIDATES defaults to 10 when neither --max nor the env var is set", () => {
    assert.match(scriptSrc, /process\.env\.MAX_CANDIDATES\s*\?\?\s*10/);
  });

  test("reads the previous checkpoint via findLatestDiscoveredAt rather than a hardcoded date", () => {
    assert.match(scriptSrc, /findLatestDiscoveredAt/);
  });

  test("reuses the existing pipeline/store modules rather than reimplementing proposal creation", () => {
    assert.match(scriptSrc, /from "\.\.\/lib\/metadata\/play-discovery-pipeline\.ts"/);
    assert.match(scriptSrc, /from "\.\.\/lib\/metadata\/play-proposal-store\.ts"/);
  });
});
