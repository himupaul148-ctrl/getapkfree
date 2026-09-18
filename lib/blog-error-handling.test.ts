import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * fetchPublished, getPostBySlug and getPublishedSlugs (lib/blog.ts) used to
 * destructure only `{ data }` from their Supabase response, discarding
 * `error` — so a transient query failure collapsed into the same result as a
 * genuine "no published posts"/"no post at this slug" empty case, with
 * nothing (not the page, not a log line) ever revealing the difference. For
 * getPostBySlug specifically, that meant a transient failure could reach
 * app/blog/[slug]/page.tsx's notFound() and get cached as a false 404 for up
 * to an hour — the ISR route runs on a 3600s revalidate. This is exactly the
 * bug documented in lib/catalogue-error-handling.test.ts for
 * fetchAppBySlug/fetchPublishedVersions, fixed here the same way for all
 * three functions: the error-vs-empty/error-vs-not-found decision goes
 * through lib/supabase/query-result.ts's resolveQueryResult(), tested
 * directly and behaviorally in lib/supabase/query-result.test.ts (no
 * next/cache import, loads under plain node --test) — that file is the
 * actual proof that a genuine no-row result still resolves to null/[] while
 * a real Supabase error is thrown rather than swallowed; these tests only
 * confirm each call site here is actually wired to it.
 *
 * fetchPublished was fixed first, with getPostBySlug and getPublishedSlugs
 * explicitly called out as out of scope at the time. Both are fixed in this
 * pass — getPostBySlug because it is the one that gates notFound() on an ISR
 * route (the real risk), getPublishedSlugs alongside it because it shares
 * the same unsafe shape, even though its own blast radius is lower (a
 * build-time generateStaticParams failure there would produce fewer
 * prerendered pages, not a runtime false 404).
 *
 * lib/blog.ts itself can't be imported here — it imports `unstable_cache`
 * from "next/cache", the same resolution constraint documented in
 * lib/catalogue.test.ts and lib/catalogue-select.test.ts — so these are
 * static, source-level assertions confirming the fix is wired in and that
 * nothing else about each query changed.
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

group("getPostBySlug no longer discards the Supabase error", () => {
  const body = bodyOf("getPostBySlug");

  test("destructures both data and error from the query", () => {
    assert.match(body, /const\s*\{\s*data,\s*error\s*\}\s*=\s*await supabase/);
  });

  test("passes both through resolveQueryResult rather than returning data directly", () => {
    assert.match(body, /return resolveQueryResult\(data, error, /);
  });

  test("the context message names the slug being looked up, matching fetchAppBySlug's convention", () => {
    assert.match(body, /return resolveQueryResult\(data, error, `getPostBySlug: Supabase query failed for slug "\$\{slug\}"`\)/);
  });

  test("the query itself (select, filters, maybeSingle) is unchanged", () => {
    assert.match(body, /\.select\(`\$\{LIST_COLUMNS\}, content`\)/);
    assert.match(body, /\.eq\("slug", slug\)/);
    assert.match(body, /\.eq\("published", true\)/);
    assert.match(body, /\.maybeSingle<BlogPost>\(\)/);
  });
});

group("getPublishedSlugs no longer discards the Supabase error", () => {
  const body = bodyOf("getPublishedSlugs");

  test("destructures both data and error from the query", () => {
    assert.match(body, /const\s*\{\s*data,\s*error\s*\}\s*=\s*await supabase/);
  });

  test("passes both through resolveQueryResult, falling back to [] only on a genuine empty result", () => {
    assert.match(body, /resolveQueryResult\(data, error, [^)]+\)\s*\?\?\s*\[\]/);
  });

  test("the query itself (select, filter) is unchanged", () => {
    assert.match(body, /\.select\("slug"\)/);
    assert.match(body, /\.eq\("published", true\)/);
  });

  test("still maps rows to their slug string, same as before the fix", () => {
    assert.match(body, /rows\.map\(\(row\) => row\.slug\)/);
  });
});

group("unrelated call sites are untouched", () => {
  test("getAdjacentPosts and getRelatedApps are untouched — this fix was scoped to fetchPublished, getPostBySlug and getPublishedSlugs only", () => {
    assert.match(src, /export async function getAdjacentPosts\(/);
    assert.match(src, /export async function getRelatedApps\(/);
    // getAdjacentPosts destructures its two parallel queries via
    // `const [olderRes, newerRes] = await Promise.all([...])`, not the
    // `{ data }` shape, so it has no occurrences of its own to count here —
    // getRelatedApps's two queries (named-ids path, most-downloaded
    // fallback) are the only remaining unfixed `{ data }`-only destructures
    // left in the file, confirming neither function was touched.
    const plainDataOccurrences = (src.match(/const \{ data \} = await supabase/g) ?? []).length;
    assert.equal(
      plainDataOccurrences,
      2,
      "expected exactly 2 remaining unfixed `{ data }`-only destructures, both inside getRelatedApps",
    );
  });
});
