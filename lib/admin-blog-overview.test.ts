import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against lib/admin.ts's
 * getAdminBlogOverview() — Phase 1 Task 9's replacement for the header/
 * Overview-tab stats that previously came from the same unbounded fetch as
 * the "All Posts" table. Same import-time constraint as
 * lib/admin-blog-pagination.test.ts (lib/admin.ts imports
 * lib/supabase/server.ts, which imports "next/headers").
 *
 * Not one of Task 9's required checklist items on its own, but touching it
 * was necessary to actually eliminate the prior unbounded query — see the
 * function's own doc comment in lib/admin.ts. These assertions prove the
 * replacement stayed a set of small, targeted queries rather than
 * reintroducing a full unbounded fetch under a new name.
 */

const src = readFileSync(fileURLToPath(new URL("./admin.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const start = src.indexOf(`export async function ${fnName}(`);
  assert.ok(start !== -1, `${fnName} not found in lib/admin.ts`);
  const nextExport = src.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? src.slice(start) : src.slice(start, nextExport);
}

const body = bodyOf("getAdminBlogOverview");

group("getAdminBlogOverview exists and returns the shape the page needs", () => {
  test("exported from lib/admin.ts, returning { stats, recent }", () => {
    assert.match(
      src,
      /export async function getAdminBlogOverview\(\): Promise<\{\s*\n\s*stats: AdminBlogOverviewStats;\s*\n\s*recent: AdminBlogRecentPost\[\];\s*\n\s*\}>/,
    );
  });
});

group("total/published counts use count-only queries — never a full-row fetch just to count", () => {
  test("both use { count: \"exact\", head: true } — no rows are transferred, just a count", () => {
    const countCalls = [...body.matchAll(/\{ count: "exact", head: true \}/g)];
    assert.equal(countCalls.length, 2, "expected exactly 2 head-count queries (total, published)");
  });

  test("the published count filters .eq(\"published\", true); the total count has no status filter", () => {
    assert.match(
      body,
      /supabase\s*\n\s*\.from\("blog_posts"\)\s*\n\s*\.select\("id", \{ count: "exact", head: true \}\)\s*\n\s*\.eq\("published", true\),/,
    );
  });
});

group("total views sums a single narrow column — matches the existing no-RPC-SUM convention in this file", () => {
  test("selects only view_count, not the full blog_posts row shape", () => {
    assert.match(body, /supabase\.from\("blog_posts"\)\.select\("view_count"\),/);
  });

  test("sums client-side via .reduce(), the same technique getAdminStats() above already uses for `downloads`", () => {
    assert.match(
      body,
      /const totalViews = \(viewsRes\.data \?\? \[\]\)\.reduce\(\s*\n\s*\(sum, row: \{ view_count: number \}\) => sum \+ \(row\.view_count \?\? 0\),\s*\n\s*0,\s*\n\s*\);/,
    );
  });
});

group("mostViewed and recent are both bounded, single-purpose queries", () => {
  test("mostViewed selects only title/view_count and is capped to .limit(1)", () => {
    assert.match(
      body,
      /supabase\s*\n\s*\.from\("blog_posts"\)\s*\n\s*\.select\("title, view_count"\)\s*\n\s*\.order\("view_count", \{ ascending: false \}\)\s*\n\s*\.limit\(1\)/,
    );
  });

  test("recent selects only the five columns the Overview list actually renders and is capped to .limit(5)", () => {
    assert.match(
      body,
      /supabase\s*\n\s*\.from\("blog_posts"\)\s*\n\s*\.select\("id, title, published, created_at, view_count"\)\s*\n\s*\.order\("created_at", \{ ascending: false \}\)\s*\n\s*\.limit\(5\)/,
    );
  });

  test("recent orders by created_at descending — identical to the original posts.slice(0, 5) over a created_at-desc query", () => {
    assert.match(body, /\.order\("created_at", \{ ascending: false \}\)\s*\n\s*\.limit\(5\)/);
  });
});

group("no unbounded fetch of every column of every post remains for stats", () => {
  test("this function never selects the full BLOG_LIST_COLUMNS set", () => {
    assert.doesNotMatch(body, /BLOG_LIST_COLUMNS/);
  });

  test("every one of the five parallel queries is either a head-count, a single narrow column, or capped with .limit()", () => {
    const selects = [...body.matchAll(/\.select\([^)]*\)/g)].map((m) => m[0]);
    assert.equal(selects.length, 5);
    for (const s of selects) {
      const isHeadCount = /count: "exact", head: true/.test(s);
      const isNarrowColumn = s === '.select("view_count")';
      const isSmallProjection = /"title, view_count"|"id, title, published, created_at, view_count"/.test(s);
      assert.ok(
        isHeadCount || isNarrowColumn || isSmallProjection,
        `unexpected unbounded-looking select: ${s}`,
      );
    }
  });
});

group("runs through the same authenticated admin client as the rest of this file", () => {
  test("calls createClient() from lib/supabase/server, same as getAdminBlogPosts and getAdminStats", () => {
    assert.match(body, /const supabase = await createClient\(\);/);
  });
});
