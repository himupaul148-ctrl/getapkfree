import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sep } from "node:path";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * .github/workflows/play-apk-enrichment.yml — there is no GitHub Actions
 * runner available under plain `node --test`, so this reads the workflow's
 * literal YAML text, the same way lib/metadata/play-watchlist-workflow.test.ts
 * reads play-watchlist.yml. This proves the workflow contains what the
 * implementation spec required — it cannot, and does not, prove the
 * workflow actually succeeds when GitHub runs it (see the session's own
 * real, controlled production test for that).
 */

const workflowPath = fileURLToPath(new URL("../../.github/workflows/play-apk-enrichment.yml", import.meta.url));
const yaml = readFileSync(workflowPath, "utf8");

group("play-apk-enrichment.yml — location and triggers", () => {
  test("lives at the expected workflow path", () => {
    const expected = [".github", "workflows", "play-apk-enrichment.yml"].join(sep);
    assert.ok(workflowPath.endsWith(expected));
  });

  test("has a daily cron schedule at a fixed UTC time", () => {
    assert.match(yaml, /schedule:\s*\n\s*(?:#.*\n\s*)*-\s*cron:\s*"30 4 \* \* \*"/);
  });

  test("supports workflow_dispatch for manual runs, with no required inputs", () => {
    assert.match(yaml, /workflow_dispatch:\s*\{\}/);
  });
});

group("play-apk-enrichment.yml — job shape", () => {
  test("runs on ubuntu-latest", () => {
    assert.match(yaml, /runs-on:\s*ubuntu-latest/);
  });

  test("checks out the repository", () => {
    assert.match(yaml, /uses:\s*actions\/checkout@v4/);
  });

  test("sets up Node 22, matching the project's existing workflow convention", () => {
    assert.match(yaml, /uses:\s*actions\/setup-node@v4/);
    assert.match(yaml, /node-version:\s*"22"/);
  });

  test("installs dependencies with the lockfile-safe command, not a bare `npm install`", () => {
    assert.match(yaml, /run:\s*npm ci\b/);
    assert.doesNotMatch(yaml, /run:\s*npm install\b/);
  });

  test("sets a bounded job timeout", () => {
    assert.match(yaml, /timeout-minutes:\s*\d+/);
  });
});

group("play-apk-enrichment.yml — the exact, and only, run command", () => {
  test("runs exactly `npm run enrich-github-apks`", () => {
    assert.match(yaml, /run:\s*npm run enrich-github-apks\s*$/m);
  });

  test("never passes --apply, --publish, or any Play approve/reject flag", () => {
    const runLines = yaml.match(/run:.*$/gm) ?? [];
    for (const line of runLines) {
      assert.doesNotMatch(line, /--apply/);
      assert.doesNotMatch(line, /--publish/);
      assert.doesNotMatch(line, /approve/i);
      assert.doesNotMatch(line, /reject/i);
    }
  });

  test("the enrichment command appears exactly once in the whole workflow", () => {
    const occurrences = yaml.match(/npm run enrich-github-apks/g) ?? [];
    assert.equal(occurrences.length, 1);
  });
});

group("play-apk-enrichment.yml — secrets", () => {
  test("SUPABASE_SERVICE_ROLE_KEY is sourced from secrets, never hardcoded", () => {
    assert.match(yaml, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/);
  });

  test("NEXT_PUBLIC_SUPABASE_URL is sourced from secrets, never hardcoded", () => {
    assert.match(yaml, /NEXT_PUBLIC_SUPABASE_URL:\s*\$\{\{\s*secrets\.NEXT_PUBLIC_SUPABASE_URL\s*\}\}/);
  });

  test("GITHUB_TOKEN is sourced from secrets (GitHub's own auto-injected token), never hardcoded", () => {
    assert.match(yaml, /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  });

  test("no secret value is ever echoed, printed, or interpolated into a run: command line", () => {
    assert.doesNotMatch(yaml, /echo.*secrets\./i);
    assert.doesNotMatch(yaml, /run:[^\n]*\$\{\{\s*secrets\./);
  });

  test("secrets are scoped to the one step that needs them, not set at job or workflow level", () => {
    // The env: block carrying the three secrets must be indented under the
    // run step, not directly under `jobs.enrich:` at the job's own level.
    const secretsBlockStart = yaml.indexOf("SUPABASE_SERVICE_ROLE_KEY:");
    assert.ok(secretsBlockStart > -1);
    const before = yaml.slice(0, secretsBlockStart);
    const lastEnvIndex = before.lastIndexOf("env:");
    assert.ok(lastEnvIndex > -1);
    const lastStepIndex = before.lastIndexOf("- name:");
    assert.ok(lastStepIndex > lastEnvIndex - 200, "env: block should be inside a step, not at job level");
  });
});

group("play-apk-enrichment.yml — permissions and concurrency", () => {
  test("grants only contents: read, and nothing else", () => {
    assert.match(yaml, /permissions:\s*\n\s*contents:\s*read/);
    const start = yaml.indexOf("permissions:");
    const rest = yaml.slice(start + "permissions:".length);
    const nextTopLevelKey = rest.search(/\n[^\s#]/);
    const permissionsBlock = nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
    assert.doesNotMatch(permissionsBlock, /write/);
  });

  test("has a concurrency group so two enrichment runs can never overlap", () => {
    assert.match(yaml, /concurrency:\s*\n\s*group:\s*play-apk-enrichment\s*\n\s*cancel-in-progress:\s*false/);
  });
});

group("play-apk-enrichment.yml — no Vercel Cron dependency", () => {
  test("this workflow is entirely self-contained on GitHub Actions — no Vercel cron config, secret, or endpoint is referenced", () => {
    assert.doesNotMatch(yaml, /vercel/i);
    assert.doesNotMatch(yaml, /CRON_SECRET/);
  });
});
