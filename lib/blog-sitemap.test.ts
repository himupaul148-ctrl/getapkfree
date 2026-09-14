import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * getPublishedPostsForSitemap (lib/blog.ts) is the fix for a real production
 * bug: /sitemap.xml consistently rendered zero /blog/<slug> URLs while
 * /blog and /blog/feed.xml — which both call the pre-existing, cached
 * getPublishedPosts() — showed every published post correctly. The
 * unstable_cache entry app/sitemap.ts read from getPublishedPosts() was
 * stale/empty and, on a route that already re-executes on every request
 * (`export const dynamic = "force-dynamic"`), added nothing but staleness
 * risk. getPublishedPostsForSitemap() is a direct, uncached read used only
 * by the sitemap, so a bad cache entry can no longer suppress every blog URL
 * indefinitely.
 *
 * lib/blog.ts can't be imported here — it imports `unstable_cache` from
 * "next/cache", the same resolution constraint documented throughout this
 * project (see lib/catalogue.test.ts, lib/blog-error-handling.test.ts) — so
 * these are static, source-level assertions.
 */

const src = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const match = src.match(
    new RegExp(`export async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("getPublishedPostsForSitemap exists as its own exported function", () => {
  test("exported from lib/blog.ts", () => {
    assert.match(src, /export async function getPublishedPostsForSitemap\(\)/);
  });

  test("returns the SitemapBlogPost[] shape ({ slug, updated_at })", () => {
    assert.match(src, /export type SitemapBlogPost = \{ slug: string; updated_at: string \};/);
    assert.match(
      src,
      /export async function getPublishedPostsForSitemap\(\): Promise<SitemapBlogPost\[\]>/,
    );
  });
});

group("getPublishedPostsForSitemap bypasses unstable_cache entirely", () => {
  const body = bodyOf("getPublishedPostsForSitemap");

  test("the function body contains no unstable_cache call", () => {
    assert.doesNotMatch(body, /unstable_cache/);
  });

  test("is not itself passed to unstable_cache anywhere in the file (unlike getPublishedPosts)", () => {
    assert.doesNotMatch(src, /unstable_cache\(\s*getPublishedPostsForSitemap/);
  });
});

group("getPublishedPostsForSitemap — the query itself", () => {
  const body = bodyOf("getPublishedPostsForSitemap");

  test("selects only slug and updated_at — no content, no full BlogSummary derivation", () => {
    assert.match(body, /\.select\("slug, updated_at"\)/);
  });

  test("filters to published posts only", () => {
    assert.match(body, /\.eq\("published", true\)/);
  });

  test("issues exactly one .from(...) call — no N+1 (one query, not one per post)", () => {
    const fromCalls = body.match(/\.from\(/g) ?? [];
    assert.equal(fromCalls.length, 1);
  });

  test("surfaces a genuine Supabase error via resolveQueryResult rather than discarding it", () => {
    assert.match(body, /const\s*\{\s*data,\s*error\s*\}\s*=\s*await supabase/);
    assert.match(body, /resolveQueryResult\(data, error, [^)]+\)\s*\?\?\s*\[\]/);
  });

  test("excludes RETIRED_SLUGS, same as fetchPublished", () => {
    assert.match(body, /\.filter\(\(post\) => !RETIRED_SLUGS\.includes\(post\.slug\)\)/);
  });
});
