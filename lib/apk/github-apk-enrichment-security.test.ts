import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Security-focused static assertions for the automatic GitHub APK
 * enrichment feature: the service-role key must exist only inside the
 * GitHub Actions server environment (never client/browser/API-route code),
 * and RLS on the new table must remain admin-only, matching its siblings
 * (play_import_proposals, play_discovery_candidates) exactly. These read
 * literal source/SQL text — the same static-assertion approach
 * lib/search-migration.test.ts already uses for a migration it cannot
 * execute directly.
 */

function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), "utf8");
}

const CLIENT_AND_STORE_FILES = [
  "lib/apk/github-apk-enrichment-store.ts",
  "lib/apk/github-apk-enrichment-run.ts",
  "components/admin/GithubEnrichmentStatus.tsx",
  "app/admin/apps/page.tsx",
  "components/admin/AppsManager.tsx",
];

group("No service-role key in browser/API/shared code", () => {
  for (const path of CLIENT_AND_STORE_FILES) {
    test(`${path} never references SUPABASE_SERVICE_ROLE_KEY`, () => {
      assert.doesNotMatch(readRepoFile(path), /SUPABASE_SERVICE_ROLE_KEY/);
    });
  }

  test("the enrichment script itself (server-only, local/CI use) is the one place the key is legitimately read", () => {
    assert.match(readRepoFile("scripts/enrich-github-apks.mjs"), /SUPABASE_SERVICE_ROLE_KEY/);
  });

  test("the GitHub Actions workflow is the one place the key is legitimately sourced from secrets", () => {
    assert.match(
      readRepoFile(".github/workflows/play-apk-enrichment.yml"),
      /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/,
    );
  });
});

group("The store/run modules use only the caller's own Supabase client — never construct their own", () => {
  for (const path of ["lib/apk/github-apk-enrichment-store.ts", "lib/apk/github-apk-enrichment-run.ts"]) {
    test(`${path} never calls createClient()`, () => {
      assert.doesNotMatch(readRepoFile(path), /createClient\(/);
    });
  }
});

group("RLS on github_apk_enrichment_attempts remains admin-only — no weakening", () => {
  const migration = readRepoFile("supabase/migrations/20260918000000_github_apk_enrichment_attempts.sql");

  test("row level security is enabled on the new table", () => {
    assert.match(migration, /alter table public\.github_apk_enrichment_attempts enable row level security;/);
  });

  test("the only policy gates on is_admin(), matching play_discovery_candidates/play_import_proposals exactly", () => {
    assert.match(migration, /using \(is_admin\(\)\)/);
    assert.match(migration, /with check \(is_admin\(\)\)/);
  });

  test("the policy is scoped to `authenticated`, never `anon` or `public`", () => {
    assert.match(migration, /for all to authenticated/);
    assert.doesNotMatch(migration, /to anon/);
    assert.doesNotMatch(migration, /to public/i);
  });

  test("no anon grant of any kind appears anywhere in the migration", () => {
    assert.doesNotMatch(migration, /grant .* to anon/i);
  });

  test("does not touch any other table's RLS — the migration's only `alter table ... row level security` is for this new table", () => {
    const rlsStatements = migration.match(/alter table[^;]*row level security[^;]*;/g) ?? [];
    assert.equal(rlsStatements.length, 1);
    assert.match(rlsStatements[0], /github_apk_enrichment_attempts/);
  });
});

group("The existing GitHub-release-import security gate is reused, never duplicated", () => {
  test("github-apk-enrichment-run.ts imports importGithubApkForApp from the existing, unmodified module rather than re-implementing it", () => {
    const src = readRepoFile("lib/apk/github-apk-enrichment-run.ts");
    assert.match(src, /import\s*\{[^}]*importGithubApkForApp[^}]*\}\s*from\s*"\.\/github-release-import\.ts"/);
    // No re-implementation of any of the actual security-relevant steps.
    assert.doesNotMatch(src, /downloadSafely/);
    assert.doesNotMatch(src, /validateApkFile/);
    assert.doesNotMatch(src, /parseApkFile/);
  });

  test("neither the store nor the run module ever calls setVersionPublished", () => {
    // Not scripts/enrich-github-apks.mjs — its own doc comment legitimately
    // names setVersionPublished() in prose to document that it's never
    // called; what matters is that no code anywhere actually calls it,
    // which is what the store/run modules (the only files with real logic
    // in this chain) are checked for here.
    for (const path of ["lib/apk/github-apk-enrichment-store.ts", "lib/apk/github-apk-enrichment-run.ts"]) {
      assert.doesNotMatch(readRepoFile(path), /setVersionPublished/);
    }
  });

  test("the enrichment script performs no direct database writes of its own — every write happens inside the existing, unmodified imported functions", () => {
    // The script's own doc comment legitimately mentions play_import_proposals
    // in prose (explaining why it's read-only) — what must never exist is
    // actual code calling .update()/.insert()/.from() itself.
    const script = readRepoFile("scripts/enrich-github-apks.mjs");
    assert.doesNotMatch(script, /\.update\(/);
    assert.doesNotMatch(script, /\.insert\(/);
    assert.doesNotMatch(script, /\.from\(/);
  });
});
