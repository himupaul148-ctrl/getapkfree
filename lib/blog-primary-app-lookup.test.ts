import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against getPrimaryBlogPostsForApp()
 * (lib/blog.ts) — the three-type blog system's App-Relationship-Layer task:
 * given an app's id, return published posts whose target_app_id is exactly
 * that app AND whose article_type is 'app_related' (target required) or
 * 'review_other' (target optional — e.g. a single-app review) — the "written
 * specifically about this app" relationship, distinct from Task 4's
 * getBlogPostsForApp() (which finds posts that merely mention the app via
 * related_app_ids). Originally app_related-only; broadened to also include
 * review_other by the P1 "make REVIEW_OTHER target-app relationship
 * functional" fix, since a single-app review is exactly the same "written
 * specifically about this app" relationship app_related represents — see
 * lib/blog-article-view-target-app.test.ts for the matching public/preview
 * gating-condition coverage.
 *
 * Same import-time constraint as lib/blog-app-reverse-lookup.test.ts (its
 * direct sibling, tested the identical way): lib/blog.ts imports
 * `unstable_cache` from "next/cache", not importable under plain
 * `node --test`.
 */

const src = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const match = src.match(
    new RegExp(`export async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("getPrimaryBlogPostsForApp exists and is exported", () => {
  test("exported from lib/blog.ts, taking an appId and returning AppRelatedPost[] — reuses the existing type, no new one invented", () => {
    assert.match(
      src,
      /export async function getPrimaryBlogPostsForApp\(\s*appId: string,\s*limit = APP_RELATED_POSTS_LIMIT,\s*\): Promise<AppRelatedPost\[\]>/,
    );
  });

  test("getBlogPostsForApp() itself is untouched — still present, still its own separate export", () => {
    assert.match(src, /export async function getBlogPostsForApp\(/);
  });
});

group("A. published required", () => {
  const body = bodyOf("getPrimaryBlogPostsForApp");

  test("filters .eq(\"published\", true)", () => {
    assert.match(body, /\.eq\("published", true\)/);
  });
});

group("B. article_type IN (app_related, review_other) filter", () => {
  const body = bodyOf("getPrimaryBlogPostsForApp");

  test("filters .in(\"article_type\", [\"app_related\", \"review_other\"]) at the database layer, not a JS comparison", () => {
    assert.match(body, /\.in\("article_type", \["app_related", "review_other"\]\)/);
  });

  test("no longer restricts to .eq(\"article_type\", \"app_related\") alone — that was the P1 bug (review_other's target app was invisible everywhere)", () => {
    assert.doesNotMatch(body, /\.eq\("article_type", "app_related"\)/);
  });

  test("GENERAL is excluded — the filter is an allowlist of exactly the two types, not simply 'not general'", () => {
    assert.doesNotMatch(body, /\.neq\("article_type", "general"\)/);
    assert.doesNotMatch(body, /article_type.*general/);
  });
});

group("A. target_app_id = appId filter", () => {
  const body = bodyOf("getPrimaryBlogPostsForApp");

  test("filters .eq(\"target_app_id\", appId) — a real database filter, not a JS comparison", () => {
    assert.match(body, /\.eq\("target_app_id", appId\)/);
  });

  test("never re-implements the target-app comparison in JavaScript", () => {
    assert.doesNotMatch(body, /\.target_app_id === appId/);
    assert.doesNotMatch(body, /post\.target_app_id/);
  });
});

group("A. deterministic ordering", () => {
  const body = bodyOf("getPrimaryBlogPostsForApp");

  test("orders by created_at descending, the same default convention every other listing query in this file uses", () => {
    assert.match(body, /\.order\("created_at", \{ ascending: false \}\)/);
  });

  test("has a secondary id-descending tiebreaker — required by this task even though its sibling getBlogPostsForApp() doesn't have one", () => {
    assert.match(
      body,
      /\.order\("created_at", \{ ascending: false \}\)\s*\n\s*\.order\("id", \{ ascending: false \}\)/,
    );
  });
});

group("A. configurable limit, bounded", () => {
  const body = bodyOf("getPrimaryBlogPostsForApp");

  test("calls .limit(limit), not an unbounded query", () => {
    assert.match(body, /\.limit\(limit\)/);
  });

  test("defaults to the existing APP_RELATED_POSTS_LIMIT (4) — the same existing app-page card count, not a newly invented number", () => {
    assert.match(
      src,
      /export async function getPrimaryBlogPostsForApp\(\s*appId: string,\s*limit = APP_RELATED_POSTS_LIMIT,/,
    );
  });
});

group("A. retired slugs excluded", () => {
  const body = bodyOf("getPrimaryBlogPostsForApp");

  test("filters RETIRED_SLUGS out after the fetch, the same pattern its sibling getBlogPostsForApp() uses", () => {
    assert.match(body, /\.filter\(\(post\) => !RETIRED_SLUGS\.includes\(post\.slug\)\)/);
  });
});

group("preserves the current blog-summary card shape", () => {
  const body = bodyOf("getPrimaryBlogPostsForApp");

  test("selects exactly id, slug, title, category — the same narrow AppRelatedPost shape getBlogPostsForApp() already selects, not a new/wider one", () => {
    assert.match(body, /\.select\("id, slug, title, category"\)/);
  });

  test("returns AppRelatedPost[], reusing the existing type rather than declaring a second identically-shaped one", () => {
    const occurrences = [...src.matchAll(/export type AppRelatedPost = /g)];
    assert.equal(occurrences.length, 1, "AppRelatedPost must only be declared once, shared by both functions");
  });
});

group("bounded, database-level query — never fetch-everything-then-filter in JS", () => {
  const body = bodyOf("getPrimaryBlogPostsForApp");

  test("issues exactly one .from(\"blog_posts\") call", () => {
    const fromCalls = [...body.matchAll(/\.from\("blog_posts"\)/g)];
    assert.equal(fromCalls.length, 1);
  });

  test("never calls getBlogPostsForApp() or getPublishedPosts() internally — its own independent, bounded query", () => {
    assert.doesNotMatch(body, /getBlogPostsForApp\(/);
    assert.doesNotMatch(body, /getPublishedPosts\(\)/);
  });

  test("falls back to [] via resolveQueryResult(...) ?? [], the same null-safety pattern as every sibling function", () => {
    assert.match(
      body,
      /resolveQueryResult\(\s*data,\s*error,\s*`getPrimaryBlogPostsForApp: Supabase query failed for app "\$\{appId\}"`,\s*\)\s*\?\?\s*\[\]/,
    );
  });
});

group("uses the public, cookie-less client — no admin/service-role client", () => {
  test("reads through the same public `supabase` import as every other function in this file", () => {
    assert.match(src, /import \{ supabase \} from "@\/lib\/supabase\/public";/);
    assert.doesNotMatch(src, /service.?role/i);
  });
});
