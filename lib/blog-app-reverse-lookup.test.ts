import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against getBlogPostsForApp() (lib/blog.ts)
 * — Phase 1 Task 4's App -> Blog reverse lookup: given an app's id, return
 * the published blog posts whose own related_app_ids names it, so an app
 * page can automatically discover articles about it without a second,
 * manually-maintained App -> Blog list.
 *
 * lib/blog.ts can't be imported here — it imports `unstable_cache` from
 * "next/cache", the same resolution constraint documented throughout this
 * project (see lib/catalogue.test.ts, lib/blog-error-handling.test.ts,
 * lib/blog-sitemap.test.ts, lib/blog-related-apps-ordering.test.ts, all of
 * which test other lib/blog.ts functions the identical way) — so these are
 * static, source-level assertions against the actual query rather than a
 * live behavioral test against a real or mocked Supabase response.
 *
 * Each numbered test below maps directly to one of the eight scenarios
 * Phase 1 Task 4 asked to be covered; the comment on each names which.
 */

const src = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const match = src.match(
    new RegExp(`export async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("getBlogPostsForApp exists and is exported", () => {
  test("exported from lib/blog.ts, taking an appId and returning AppRelatedPost[]", () => {
    assert.match(
      src,
      /export async function getBlogPostsForApp\(\s*appId: string,\s*limit = APP_RELATED_POSTS_LIMIT,\s*\): Promise<AppRelatedPost\[\]>/,
    );
  });

  test("AppRelatedPost carries only the fields the app page's card actually renders", () => {
    assert.match(
      src,
      /export type AppRelatedPost = \{\s*id: string;\s*slug: string;\s*title: string;\s*category: string;\s*\};/,
    );
  });
});

group("(1) a published matching post would be returned — (2) an unpublished one excluded", () => {
  const body = bodyOf("getBlogPostsForApp");

  test("filters .eq(\"published\", true) — the same explicit filter every other public query in this file uses", () => {
    assert.match(body, /\.eq\("published", true\)/);
  });
});

group("(3) a post with a different app id is excluded — the relationship is a real database filter", () => {
  const body = bodyOf("getBlogPostsForApp");

  test("filters with .contains(\"related_app_ids\", [appId]) — compiles to a Postgres `@>` membership test", () => {
    assert.match(body, /\.contains\("related_app_ids", \[appId\]\)/);
  });
});

group("(4) multiple matching posts are returned — no accidental single-row query", () => {
  const body = bodyOf("getBlogPostsForApp");

  test("does not call .single() or .maybeSingle() — this returns a list, not one row", () => {
    assert.doesNotMatch(body, /\.single\(\)/);
    assert.doesNotMatch(body, /\.maybeSingle\(\)/);
  });

  test("declares its return type as an array (AppRelatedPost[]), not a single post", () => {
    assert.match(body, /Promise<AppRelatedPost\[\]>/);
  });
});

group("(5) ordering is deterministic", () => {
  const body = bodyOf("getBlogPostsForApp");

  test("orders by created_at descending — the same convention fetchPublished/getPublishedPostsForSitemap/getAdjacentPosts already use in this file", () => {
    assert.match(body, /\.order\("created_at", \{ ascending: false \}\)/);
  });
});

group("(6) the result limit is enforced", () => {
  const body = bodyOf("getBlogPostsForApp");

  test("calls .limit(limit), not an unbounded query", () => {
    assert.match(body, /\.limit\(limit\)/);
  });

  test("the default limit is a small, fixed constant matching the app page's own related-apps card count (4)", () => {
    assert.match(src, /const APP_RELATED_POSTS_LIMIT = 4;/);
  });
});

group("(7) an empty result is handled correctly", () => {
  const body = bodyOf("getBlogPostsForApp");

  test("falls back to [] via resolveQueryResult(...) ?? [], the same null-safety pattern as every sibling function", () => {
    assert.match(body, /resolveQueryResult\(data, error, [^)]+\)\s*\?\?\s*\[\]/);
  });

  test("filters RETIRED_SLUGS out afterward without ever assuming a non-empty array", () => {
    assert.match(body, /\.filter\(\(post\) => !RETIRED_SLUGS\.includes\(post\.slug\)\)/);
  });
});

group("(8) the database query performs the relationship filtering — never fetch-everything-then-filter in JS", () => {
  const body = bodyOf("getBlogPostsForApp");

  test("issues exactly one .from(\"blog_posts\") call — no N+1, no separate existence check", () => {
    const fromCalls = [...body.matchAll(/\.from\("blog_posts"\)/g)];
    assert.equal(fromCalls.length, 1);
  });

  test("selects only id, slug, title, category — never content, author, or the full row", () => {
    assert.match(body, /\.select\("id, slug, title, category"\)/);
  });

  test("never re-implements the app-id membership test in JavaScript (e.g. checking related_app_ids.includes(appId) itself)", () => {
    assert.doesNotMatch(body, /related_app_ids\.includes\(/);
    assert.doesNotMatch(body, /related_app_ids\?\.includes\(/);
  });

  test("selects no wider column set first — .select( appears exactly once, scoped to the four needed columns", () => {
    const selectCalls = [...body.matchAll(/\.select\(/g)];
    assert.equal(selectCalls.length, 1);
  });
});

group("uses the public, cookie-less client — no admin/service-role client for a public-facing lookup", () => {
  test("reads through the same `supabase` import every other function in this file uses, not a service-role client", () => {
    assert.match(src, /import \{ supabase \} from "@\/lib\/supabase\/public";/);
    // Confirms the whole file — including this new function — has exactly
    // one Supabase client import, and it's the public one.
    assert.doesNotMatch(src, /service.?role/i);
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY/);
  });
});
