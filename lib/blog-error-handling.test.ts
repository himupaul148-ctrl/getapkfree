import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * fetchPublished (lib/blog.ts) used to destructure only `{ data }` from its
 * Supabase response, discarding `error` — so a transient query failure
 * collapsed into the same empty result as "no published posts yet", and
 * nothing (not the page, not a log line) ever revealed the difference. This
 * is exactly the bug documented in lib/catalogue-error-handling.test.ts for
 * fetchAppBySlug/fetchPublishedVersions, fixed here the same way: the
 * error-vs-empty decision goes through lib/supabase/query-result.ts's
 * resolveQueryResult(), tested directly and behaviorally in
 * lib/supabase/query-result.test.ts (no next/cache import, loads under plain
 * node --test).
 *
 * lib/blog.ts itself can't be imported here — it imports `unstable_cache`
 * from "next/cache", the same resolution constraint documented in
 * lib/catalogue.test.ts and lib/catalogue-select.test.ts — so these are
 * static, source-level assertions confirming the fix is wired in and that
 * nothing else about the query changed.
 */

const src = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const match = src.match(
    new RegExp(`(?:export\\s+)?async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("lib/blog.ts imports the shared error-vs-not-found helper", () => {
  test("resolveQueryResult is imported from lib/supabase/query-result", () => {
    assert.match(
      src,
      /import\s*\{\s*resolveQueryResult\s*\}\s*from\s*"@\/lib\/supabase\/query-result"/,
    );
  });
});

group("fetchPublished no longer discards the Supabase error", () => {
  const body = bodyOf("fetchPublished");

  test("destructures both data and error from the query", () => {
    assert.match(body, /const\s*\{\s*data,\s*error\s*\}\s*=\s*await supabase/);
  });

  test("passes both through resolveQueryResult, falling back to [] only on a genuine empty result", () => {
    assert.match(body, /resolveQueryResult\(data, error, [^)]+\)\s*\?\?\s*\[\]/);
  });

  test("the query itself (select, filter, order) is unchanged", () => {
    assert.match(body, /\.select\(`\$\{LIST_COLUMNS\}, content`\)/);
    assert.match(body, /\.eq\("published", true\)/);
    assert.match(body, /\.order\("created_at", \{ ascending: false \}\)/);
  });

  test("RETIRED_SLUGS filtering still runs on the resolved rows", () => {
    assert.match(body, /rows\s*\n\s*\.filter\(\(post\) => !RETIRED_SLUGS\.includes\(post\.slug\)\)/);
  });
});

group("unrelated call sites are untouched", () => {
  test("getPostBySlug still only destructures data — out of scope for this fix (maybeSingle, not a list)", () => {
    const body = bodyOf("getPostBySlug");
    assert.match(body, /const \{ data \} = await supabase/);
  });

  test("getAdjacentPosts and getRelatedApps are untouched — this fix was scoped to fetchPublished only", () => {
    assert.match(src, /export async function getAdjacentPosts\(/);
    assert.match(src, /export async function getRelatedApps\(/);
  });
});
