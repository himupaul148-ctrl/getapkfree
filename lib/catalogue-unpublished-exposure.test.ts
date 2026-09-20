import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * lib/catalogue.ts can't be imported directly under plain `node --test` —
 * it imports `unstable_cache` from "next/cache" (the same constraint
 * documented in lib/catalogue.test.ts, lib/catalogue-select.test.ts and
 * lib/catalogue-error-handling.test.ts). So these are static, source-level
 * assertions confirming getRelatedApps() and getPopularSlugs() actually
 * gained a published-version constraint, following the same technique this
 * project already relies on wherever a server-only module can't be
 * exercised directly.
 *
 * The behavioral half of this fix — hasPublishedVersion() itself, and the
 * exact filtering it performs on realistic AppSummary rows — is tested
 * directly in lib/catalogue-published.test.ts, which has no such import
 * problem.
 *
 * Background: kinemaster-premium-apk and capcut-premium were correctly
 * unpublished (Step 3 catalogue cleanup) and disappeared from the main
 * catalogue, category pages, public search and the sitemap — all of which
 * already filtered on published-version existence. getRelatedApps() and
 * getPopularSlugs() did not, so an unpublished app could still surface as a
 * "related app" card or be selected for static-page generation purely
 * because of a leftover download_count. This file locks in the fix.
 */

const src = readFileSync(fileURLToPath(new URL("./catalogue.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const match = src.match(new RegExp(`export async function ${fnName}[\\s\\S]*?\\n}`));
  assert.ok(match, `${fnName} not found in lib/catalogue.ts`);
  return match![0];
}

group("lib/catalogue.ts imports the shared published-version guard", () => {
  test("hasPublishedVersion is imported from lib/catalogue-published", () => {
    assert.match(
      src,
      /import\s*\{\s*hasPublishedVersion\s*\}\s*from\s*"@\/lib\/catalogue-published"/,
    );
  });
});

group("getRelatedApps — no longer returns apps with no published version", () => {
  const body = bodyOf("getRelatedApps");

  test("filters the mapped results through hasPublishedVersion", () => {
    assert.match(body, /\.map\(toSummary\)\.filter\(hasPublishedVersion\)/);
  });

  test("category matching, exclusion, ordering and limit are all unchanged", () => {
    assert.match(body, /\.select\(APP_SUMMARY_SELECT\)/);
    assert.match(body, /\.eq\("category", category\)/);
    assert.match(body, /\.neq\("id", excludeId\)/);
    assert.match(body, /\.order\("download_count", \{ ascending: false \}\)/);
    assert.match(body, /\.limit\(limit\)/);
  });

  test("still returns [] early for a null category, unchanged", () => {
    assert.match(body, /if \(!category\) return \[\];/);
  });
});

group("getPopularSlugs — no longer selects slugs for apps with no published version", () => {
  const body = bodyOf("getPopularSlugs");

  test("the versions relationship is embedded as an inner join, gating which apps qualify", () => {
    assert.match(body, /\.select\("slug, versions!inner\(published\)"\)/);
  });

  test("filters to published versions via the existing apps -> versions relationship", () => {
    assert.match(body, /\.eq\("versions\.published", true\)/);
  });

  test("ordering and limit are unchanged", () => {
    assert.match(body, /\.order\("download_count", \{ ascending: false \}\)/);
    assert.match(body, /\.limit\(limit\)/);
  });

  test("still maps to a plain slug array, unchanged", () => {
    assert.match(body, /return \(data \?\? \[\]\)\.map\(\(row\) => row\.slug\);/);
  });
});

group("unrelated exports are untouched", () => {
  test("getCatalogue, getAppBySlug and getPublishedVersions are unchanged by this fix", () => {
    // getCatalogue's own internal caching strategy is unrelated to this fix
    // and legitimately varies independently of it — only that the export
    // itself, and fetchCatalogue as its underlying function, are untouched.
    assert.match(src, /export const getCatalogue = /);
    assert.match(src, /fetchCatalogue, \["catalogue"\]/);
    assert.match(src, /export const getAppBySlug = cache\(fetchAppBySlug\);/);
    assert.match(src, /export const getPublishedVersions = cache\(fetchPublishedVersions\);/);
  });

  test("fetchCatalogue's own filter is untouched — this fix did not touch the homepage catalogue query", () => {
    assert.match(src, /\.filter\(\(app\) => app\.latestVersion !== null\)/);
  });
});
