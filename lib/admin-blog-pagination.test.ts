import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against lib/admin.ts's getAdminBlogPosts()
 * — Phase 1 Task 9's server-side pagination/filtering for the admin Blog
 * list. lib/admin.ts imports lib/supabase/server.ts, which imports
 * "next/headers" — not importable under plain `node --test` (no server
 * request context), the same constraint documented throughout this project
 * for other server-only modules (see lib/blog-category-related-posts.test.ts
 * for the identical justification against lib/blog.ts).
 *
 * These assertions specifically target the QUERY, not the UI: the whole
 * point of this task is that the database receives real WHERE/ORDER
 * BY/LIMIT/OFFSET clauses — .eq()/.ilike()/.order()/.range() — rather than
 * the previous "fetch every row, then filter/sort/slice in JavaScript".
 */

const src = readFileSync(fileURLToPath(new URL("./admin.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const start = src.indexOf(`export async function ${fnName}(`);
  assert.ok(start !== -1, `${fnName} not found in lib/admin.ts`);
  const nextExport = src.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? src.slice(start) : src.slice(start, nextExport);
}

const body = bodyOf("getAdminBlogPosts");

group("getAdminBlogPosts exists and is exported with the expected shape", () => {
  test("exported from lib/admin.ts, taking AdminBlogListParams and returning AdminBlogListResult", () => {
    assert.match(
      src,
      /export async function getAdminBlogPosts\(\s*params: AdminBlogListParams,\s*\): Promise<AdminBlogListResult>/,
    );
  });
});

group("(2)+(3) default page is page 1, default page size is a fixed, small constant", () => {
  test("no established page size existed before — ADMIN_BLOG_PAGE_SIZE = 20 per the task's fallback default", () => {
    assert.match(src, /export const ADMIN_BLOG_PAGE_SIZE = 20;/);
  });

  test("page comes from the canonical normalisePage() (from lib/blog.ts) — no second page-number parser", () => {
    assert.match(body, /const requestedPage = normalisePage\(params\.page\);/);
    assert.match(src, /import \{ normaliseBlogCategory, normalisePage, type BlogSummary \} from "@\/lib\/blog";/);
  });
});

group("(3) page 2 (and beyond) compute the correct .range() offset", () => {
  test("from/to are derived from (requestedPage - 1) * pageSize, not a hardcoded page", () => {
    assert.match(body, /const from = \(requestedPage - 1\) \* pageSize;/);
    assert.match(body, /const to = from \+ pageSize - 1;/);
    assert.match(body, /\.range\(from, to\)/);
  });
});

group("(4) invalid page values normalise safely — no thrown error for page=0/-1/abc/excessively large", () => {
  test("normalisePage already clamps non-numeric/zero/negative input to 1 (reused, not reimplemented)", () => {
    // normalisePage's own behaviour is covered by lib/blog.ts's existing
    // callers; this file only needs to prove it reuses that function rather
    // than rolling its own parsing.
    assert.doesNotMatch(body, /Number\(params\.page\)/);
  });

  test("an excessively large page is clamped down to the real last page, not left to request an empty out-of-range slice", () => {
    assert.match(body, /const totalPages = Math\.max\(1, Math\.ceil\(total \/ pageSize\)\);/);
    assert.match(body, /const page = Math\.min\(requestedPage, totalPages\);/);
    assert.match(body, /if \(!error && page !== requestedPage\) \{/);
  });

  test("never throws to the caller on a Supabase error — returns { error } so the page can render its existing inline banner", () => {
    assert.doesNotMatch(body, /throw new Error/);
    assert.match(body, /error: error\?\.message \?\? null,/);
  });
});

group("(5) category filtering happens at the database layer", () => {
  test("filters .eq(\"category\", category) — not a JS .filter() over every row", () => {
    assert.match(body, /if \(category\) query = query\.eq\("category", category\);/);
  });

  test("(12) category comes from the canonical normaliseBlogCategory()/BLOG_CATEGORIES — no second category list", () => {
    assert.match(body, /const category = normaliseBlogCategory\(params\.category\);/);
    assert.doesNotMatch(src, /BLOG_CATEGORIES\s*=\s*\[/);
  });
});

group("(6) published/draft filtering happens at the database layer", () => {
  test("draft maps to .eq(\"published\", false), published maps to .eq(\"published\", true) — matching BlogPostsTable's prior client-side semantics exactly", () => {
    assert.match(body, /if \(status === "published"\) query = query\.eq\("published", true\);/);
    assert.match(body, /else if \(status === "draft"\) query = query\.eq\("published", false\);/);
  });

  test("\"all\" applies no published filter — every post (draft and published) stays visible to the admin, same as before", () => {
    const statusBlock = body.slice(body.indexOf('if (status === "published")'), body.indexOf("if (category)"));
    assert.doesNotMatch(statusBlock, /else \{/, "an \"all\" branch that applies its own filter would be new, unrequested behaviour");
  });
});

group("(7) search filtering happens at the database layer, preserving the exact prior semantics (title only)", () => {
  test("filters .ilike(\"title\", ...) — not description/author/slug, matching the prior post.title.toLowerCase().includes(needle) exactly", () => {
    assert.match(body, /if \(search\) \{\s*\n\s*query = query\.ilike\("title", `%\$\{escapeIlikePattern\(search\)\}%`\);/);
  });

  test("escapes ILIKE's own %/_ wildcards so a literal one in the search box is not silently broadened into a wildcard match", () => {
    assert.match(src, /function escapeIlikePattern\(value: string\): string \{/);
    assert.match(src, /value\.replace\(\/\[\\\\%_\]\/g, \(char\) => `\\\\\$\{char\}`\);/);
  });

  test("search is trimmed, matching the prior query.trim() semantics", () => {
    assert.match(body, /const search = \(params\.q \?\? ""\)\.trim\(\);/);
  });
});

group("(8) results are bounded — never an unbounded query", () => {
  test("issues exactly one base .from(\"blog_posts\") builder (buildQuery), reused for the primary fetch and only re-invoked, never a second unrelated table scan", () => {
    const fromCalls = [...body.matchAll(/\.from\("blog_posts"\)/g)];
    assert.equal(fromCalls.length, 1, "buildQuery() should be the single place blog_posts is queried from");
  });

  test("no .limit()-less, .range()-less query exists in this function — every path is bounded by .range()", () => {
    assert.match(body, /\.range\(from, to\)/);
    assert.match(body, /\.range\(clampedFrom, clampedTo\)/);
  });

  test("does not fetch getPublishedPosts() or any full unbounded set and filter/slice it in JavaScript", () => {
    assert.doesNotMatch(body, /getPublishedPosts\(\)/);
    assert.doesNotMatch(body, /\.slice\(/);
  });
});

group("(9)+(10) ordering is deterministic and pagination preserves it", () => {
  test("every sort branch orders at the database via .order(), not a JS comparator", () => {
    assert.match(body, /query = query\.order\("title", \{ ascending: true \}\)\.order\("id", \{ ascending: true \}\);/);
    assert.match(body, /query = query\.order\("view_count", \{ ascending: false \}\)\.order\("id", \{ ascending: true \}\);/);
    assert.match(body, /query = query\.order\("created_at", \{ ascending: false \}\)\.order\("id", \{ ascending: true \}\);/);
  });

  test("every sort branch has a secondary `id` tiebreaker, so .range() pagination cannot skip or repeat a row when many share the same primary sort value", () => {
    const orderCalls = [...body.matchAll(/\.order\(/g)];
    // 3 sort branches × 2 .order() calls each (primary + id tiebreaker).
    assert.equal(orderCalls.length, 6);
  });

  test("default sort ('newest') matches the same created_at-descending convention every other query in lib/blog.ts uses", () => {
    assert.match(body, /\} else \{\s*\n\s*query = query\.order\("created_at", \{ ascending: false \}\)/);
  });
});

group("(11) filter changes reset pagination to page 1 — client-side responsibility, verified in BlogPostsTable's own test", () => {
  test("this query function itself is stateless per-call — it takes whatever page the URL/caller supplies, it does not remember a previous page", () => {
    assert.doesNotMatch(body, /let page = 1/);
  });
});

group("(13) no public blog behaviour changes", () => {
  test("lib/blog.ts's own public functions (getPublishedPosts, getPublishedPostsByCategory, getBlogPostsForApp) are not imported or reimplemented here", () => {
    assert.doesNotMatch(src, /getPublishedPosts\b/);
    assert.doesNotMatch(src, /getPublishedPostsByCategory/);
    assert.doesNotMatch(src, /getBlogPostsForApp/);
  });
});

group("(14) admin authentication/RLS is unchanged", () => {
  test("uses the authenticated, cookie-bound server client (lib/supabase/server), the same one isAdmin()/getAdminStats() already use — never a public or service-role client", () => {
    assert.match(src, /import \{ createClient, getUser \} from "@\/lib\/supabase\/server";/);
    assert.match(body, /const supabase = await createClient\(\);/);
    assert.doesNotMatch(src, /service.?role/i);
  });
});

group("query builder reuse is safe: buildQuery() returns a fresh builder per range attempt", () => {
  test("buildQuery is a function (not a single pre-built query object) so the optional clamped refetch does not re-await an already-executed builder", () => {
    assert.match(body, /function buildQuery\(\) \{/);
    assert.match(body, /const \{ data, error, count \} = await buildQuery\(\)\.range\(from, to\);/);
    assert.match(body, /const refetch = await buildQuery\(\)\.range\(clampedFrom, clampedTo\);/);
  });
});

group("count and rows come from one request in the common case", () => {
  test("select(...) requests an exact count in the same call that also fetches the page's rows", () => {
    assert.match(body, /\.select\(BLOG_LIST_COLUMNS, \{ count: "exact" \}\);/);
  });
});
