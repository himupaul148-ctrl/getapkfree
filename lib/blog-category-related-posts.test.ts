import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against getPublishedPostsByCategory()
 * (lib/blog.ts) — Phase 1 Task 7's category-page reverse blog query: given a
 * blog category (already resolved from an app category via Task 6's
 * mapping), return the small, bounded set of published posts in it.
 *
 * lib/blog.ts can't be imported here — it imports `unstable_cache` from
 * "next/cache", the same resolution constraint documented throughout this
 * project (see lib/blog-app-reverse-lookup.test.ts, which tests
 * getBlogPostsForApp() in this exact file the same way) — so these are
 * static, source-level assertions against the actual query rather than a
 * live behavioral test.
 */

const src = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const match = src.match(
    new RegExp(`export async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("getPublishedPostsByCategory exists and is exported", () => {
  test("exported from lib/blog.ts, taking a BlogCategory and returning BlogSummary[]", () => {
    assert.match(
      src,
      /export async function getPublishedPostsByCategory\(\s*category: BlogCategory,\s*limit = CATEGORY_RELATED_POSTS_LIMIT,\s*\): Promise<BlogSummary\[\]>/,
    );
  });
});

group("(6) only published posts are queried/returned", () => {
  const body = bodyOf("getPublishedPostsByCategory");

  test("filters .eq(\"published\", true) — the same explicit filter every public query in this file uses", () => {
    assert.match(body, /\.eq\("published", true\)/);
  });
});

group("(7) the query filters by the mapped blog category at the database layer", () => {
  const body = bodyOf("getPublishedPostsByCategory");

  test("filters .eq(\"category\", category) — a real database-side filter, not a JS .filter() over every post", () => {
    assert.match(body, /\.eq\("category", category\)/);
  });

  test("does not fetch getPublishedPosts()'s full unbounded set and filter it in JavaScript", () => {
    assert.doesNotMatch(body, /getPublishedPosts\(\)/);
    assert.doesNotMatch(body, /\.filter\(\(post\) => post\.category === category\)/);
  });

  test("issues exactly one .from(\"blog_posts\") call — no N+1", () => {
    const fromCalls = [...body.matchAll(/\.from\("blog_posts"\)/g)];
    assert.equal(fromCalls.length, 1);
  });
});

group("(8) the result is bounded", () => {
  const body = bodyOf("getPublishedPostsByCategory");

  test("calls .limit(limit), not an unbounded query", () => {
    assert.match(body, /\.limit\(limit\)/);
  });

  test("the default limit is a small, fixed constant matching the site's other secondary-section card counts (4)", () => {
    assert.match(src, /const CATEGORY_RELATED_POSTS_LIMIT = 4;/);
  });
});

group("(9) ordering is deterministic", () => {
  const body = bodyOf("getPublishedPostsByCategory");

  test("orders by created_at descending — the same convention every other listing in this file uses", () => {
    assert.match(body, /\.order\("created_at", \{ ascending: false \}\)/);
  });
});

group("retired slugs are excluded, matching the existing repository convention", () => {
  const body = bodyOf("getPublishedPostsByCategory");

  test("filters RETIRED_SLUGS out, same as fetchPublished/getBlogPostsForApp", () => {
    assert.match(body, /\.filter\(\(post\) => !RETIRED_SLUGS\.includes\(post\.slug\)\)/);
  });
});

group("returns full BlogSummary rows so the existing BlogCard component can render them unchanged", () => {
  const body = bodyOf("getPublishedPostsByCategory");

  test("selects the full LIST_COLUMNS plus content, computes excerptText/readMinutes the same way fetchPublished() does", () => {
    assert.match(body, /\.select\(`\$\{LIST_COLUMNS\}, content`\)/);
    assert.match(body, /excerptText: rest\.description \|\| excerpt\(content\)/);
    assert.match(body, /readMinutes: readingTime\(content\)/);
  });

  test("falls back to [] via resolveQueryResult(...) ?? [] on a query failure, never throwing to the caller unhandled", () => {
    assert.match(body, /resolveQueryResult\(\s*data,\s*error,[\s\S]*?\)\s*\?\?\s*\[\]/);
  });
});

group("uses the public, cookie-less client — no admin/service-role client", () => {
  test("this module's only Supabase client import is the public one", () => {
    assert.match(src, /import \{ supabase \} from "@\/lib\/supabase\/public";/);
    assert.doesNotMatch(src, /service.?role/i);
  });
});
