import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * fetchAppBySlug and fetchPublishedVersions (lib/catalogue.ts) used to
 * destructure only `{ data }` from their Supabase response, discarding
 * `error` — so a transient query failure collapsed into the same `null`/`[]`
 * as a genuine "no row found", and app/app/[slug]/page.tsx's notFound() (on
 * an ISR route) could then cache that false negative as a 404 for up to an
 * hour. The actual error-vs-not-found decision now lives in
 * lib/supabase/query-result.ts's resolveQueryResult(), which is tested
 * directly and behaviorally in lib/supabase/query-result.test.ts — that file
 * has no next/cache import, so it can load under plain `node --test`.
 *
 * lib/catalogue.ts itself still can't be imported here (same next/cache
 * resolution constraint documented in lib/catalogue.test.ts and
 * lib/catalogue-select.test.ts), so these are static, source-level
 * assertions confirming the fix is actually wired into both call sites and
 * that nothing else about the queries changed.
 */

const src = readFileSync(fileURLToPath(new URL("./catalogue.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const match = src.match(new RegExp(`async function ${fnName}[\\s\\S]*?\\n}`));
  assert.ok(match, `${fnName} not found in lib/catalogue.ts`);
  return match![0];
}

group("lib/catalogue.ts imports the shared error-vs-not-found helper", () => {
  test("resolveQueryResult is imported from lib/supabase/query-result", () => {
    assert.match(
      src,
      /import\s*\{\s*resolveQueryResult\s*\}\s*from\s*"@\/lib\/supabase\/query-result"/,
    );
  });
});

group("fetchAppBySlug no longer discards the Supabase error", () => {
  const body = bodyOf("fetchAppBySlug");

  test("destructures both data and error from the query", () => {
    assert.match(body, /const\s*\{\s*data,\s*error\s*\}\s*=\s*await supabase/);
  });

  test("passes both through resolveQueryResult rather than returning data directly", () => {
    assert.match(body, /return resolveQueryResult\(data, error, /);
  });

  test("the query itself (select list, filter) is unchanged", () => {
    assert.match(body, /\.select\(APP_DETAIL_SELECT\)/);
    assert.match(body, /\.eq\("slug", slug\)/);
    assert.match(body, /\.maybeSingle<App>\(\)/);
  });
});

group("fetchPublishedVersions no longer discards the Supabase error", () => {
  const body = bodyOf("fetchPublishedVersions");

  test("destructures both data and error from the query", () => {
    assert.match(body, /const\s*\{\s*data,\s*error\s*\}\s*=\s*await supabase/);
  });

  test("passes both through resolveQueryResult, falling back to [] only on a genuine empty result", () => {
    assert.match(body, /resolveQueryResult\(data, error, [^)]+\)\s*\?\?\s*\[\]/);
  });

  test("the query itself (select, filters, ordering) is unchanged", () => {
    assert.match(body, /\.select\("\*"\)/);
    assert.match(body, /\.eq\("app_id", appId\)/);
    assert.match(body, /\.eq\("published", true\)/);
    assert.match(body, /\.order\("version_code", \{ ascending: false \}\)/);
  });
});

group("unrelated exports and call sites are untouched", () => {
  test("getAppBySlug and getPublishedVersions are still wrapped in cache(), unchanged from P3-2", () => {
    assert.match(src, /export const getAppBySlug = cache\(fetchAppBySlug\);/);
    assert.match(src, /export const getPublishedVersions = cache\(fetchPublishedVersions\);/);
  });

  test("getRelatedApps and getPopularSlugs are untouched — this fix was scoped to the two named functions only", () => {
    assert.match(src, /export async function getRelatedApps\(/);
    const related = src.match(/export async function getRelatedApps[\s\S]*?\n}/)![0];
    assert.match(related, /const \{ data \} = await supabase/);

    assert.match(src, /export async function getPopularSlugs\(/);
    const popular = src.match(/export async function getPopularSlugs[\s\S]*?\n}/)![0];
    assert.match(popular, /const \{ data \} = await supabase/);
  });
});
