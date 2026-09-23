import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against lib/blog.ts's
 * getPublishedPostsPaged() — Phase 1 Task 10B (C1)'s server-side
 * pagination/filtering for the public /blog listing. lib/blog.ts imports
 * `unstable_cache` from "next/cache" and constructs a real Supabase client
 * at module scope — not importable under plain `node --test`, the same
 * constraint documented throughout this project (see
 * lib/admin-blog-pagination.test.ts for the identical admin-side approach
 * this file mirrors).
 *
 * These assertions target the QUERY, not the UI: the goal is proof that the
 * database receives real WHERE/ORDER BY/LIMIT/OFFSET clauses —
 * .eq()/.not()/.or()/.range()/.order() — rather than the previous "fetch
 * every published post, then filter/sort/slice in JavaScript".
 */

const src = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const start = src.indexOf(`export async function ${fnName}(`);
  assert.ok(start !== -1, `${fnName} not found in lib/blog.ts`);
  const nextExport = src.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? src.slice(start) : src.slice(start, nextExport);
}

const body = bodyOf("getPublishedPostsPaged");

group("(1) getPublishedPostsPaged exists and is exported with the expected shape", () => {
  test("exported from lib/blog.ts, taking { category, search, page } and returning PublishedPostsPage", () => {
    assert.match(
      src,
      /export async function getPublishedPostsPaged\(\{\s*\n\s*category,\s*\n\s*search,\s*\n\s*page,\s*\n\s*\}: \{\s*\n\s*category\?: string;\s*\n\s*search\?: string;\s*\n\s*page\?: string;\s*\n\s*\}\): Promise<PublishedPostsPage>/,
    );
  });

  test("getPublishedPosts() itself is untouched — still the zero-arg, cached, unparameterized function", () => {
    assert.match(src, /export const getPublishedPosts = unstable_cache\(/);
    assert.match(src, /async function fetchPublished\(\): Promise<BlogSummary\[\]>/);
  });
});

group("(2) published filtering happens at the database layer", () => {
  test("filters .eq(\"published\", true) — the same explicit filter every public query in this file uses", () => {
    assert.match(body, /\.eq\("published", true\)/);
  });
});

group("(3) category filtering happens at the database layer", () => {
  test("filters .eq(\"category\", normalisedCategory) only when a category is present", () => {
    assert.match(
      body,
      /if \(normalisedCategory\) \{\s*\n\s*query = query\.eq\("category", normalisedCategory\);\s*\n\s*\}/,
    );
  });

  test("category comes from the canonical normaliseBlogCategory()/BLOG_CATEGORIES — no second category list", () => {
    assert.match(body, /const normalisedCategory = normaliseBlogCategory\(category\);/);
  });

  test("no category filter is added when category is absent/invalid (normalises to \"\")", () => {
    const categoryBlock = body.slice(
      body.indexOf("if (normalisedCategory)"),
      body.indexOf("if (normalisedSearch)"),
    );
    assert.doesNotMatch(categoryBlock, /else/, "an else branch would add an unrequested default category filter");
  });
});

group("(4)+(5) search uses database-level title OR description OR author, case-insensitive substring — exact prior semantics", () => {
  test("uses .or() across title/description/author, not a title-only filter", () => {
    assert.match(
      body,
      /query = query\.or\(\s*\n\s*`title\.ilike\.\$\{pattern\},description\.ilike\.\$\{pattern\},author\.ilike\.\$\{pattern\}`,\s*\n\s*\);/,
    );
  });

  test("ilike (not like) is used for each column — case-insensitive, matching the prior .toLowerCase().includes() semantics", () => {
    const orCall = body.match(/query\.or\(\s*\n\s*`([^`]+)`/);
    assert.ok(orCall, ".or() call not found");
    assert.doesNotMatch(orCall![1], /\.like\./, "must use ilike, not case-sensitive like");
  });

  test("the pattern wraps the search term in %...% wildcards for substring matching", () => {
    assert.match(body, /const pattern = quoteForOrFilter\(`%\$\{escapeIlikeWildcards\(normalisedSearch\)\}%`\);/);
  });

  test("does not search content, matching the prior public search scope exactly", () => {
    const searchBlock = body.slice(body.indexOf("if (normalisedSearch)"), body.indexOf("return query"));
    assert.doesNotMatch(searchBlock, /content\.ilike/);
  });
});

group("(6) search wildcard characters are safely escaped", () => {
  test("escapeIlikeWildcards escapes backslash, %, and _ for the LIKE engine", () => {
    assert.match(src, /function escapeIlikeWildcards\(value: string\): string \{/);
    assert.match(src, /return value\.replace\(\/\[\\\\%_\]\/g, \(char\) => `\\\\\$\{char\}`\);/);
  });

  test("quoteForOrFilter escapes backslash and double-quote for the .or() parser's own quoting layer", () => {
    assert.match(src, /function quoteForOrFilter\(value: string\): string \{/);
    const fnStart = src.indexOf("function quoteForOrFilter");
    const fnBody = src.slice(fnStart, src.indexOf("\n}", fnStart) + 2);

    // Two backslash characters inside the regex delimiters (source text
    // `/\\/g`) — a JS regex literal for "one literal backslash".
    assert.ok(fnBody.includes('replace(/\\\\/g'), "must match a literal backslash");
    // Two backslash characters inside the double-quoted replacement (source
    // text `"\\\\"`) — the JS string literal for "two literal backslashes",
    // i.e. each single backslash in the input becomes two in the output.
    assert.ok(fnBody.includes('"\\\\\\\\"'), "must replace each backslash with two backslashes");
    // A regex literal for a literal double-quote character (source text `/"/g`).
    assert.ok(fnBody.includes('replace(/"/g'), "must match a literal double quote");
    // The replacement for a double quote is a backslash followed by a
    // double quote (source text `'\\"'`) — two backslash characters then a
    // literal quote, inside single quotes.
    assert.ok(fnBody.includes('\\\\"'), "must replace each double quote with a backslash-quote pair");
    assert.ok(fnBody.trim().startsWith('function quoteForOrFilter(value: string): string {\n  return `"${value'));
  });

  test("search is trimmed before being used, matching the prior query.trim() semantics", () => {
    assert.match(body, /const normalisedSearch = \(search \?\? ""\)\.trim\(\);/);
  });
});

group("(7)+(8) pagination is database-level via .range(), with POSTS_PER_PAGE preserved", () => {
  test("POSTS_PER_PAGE remains 10 — the existing public page size is untouched", () => {
    assert.match(src, /export const POSTS_PER_PAGE = 10;/);
  });

  test("pageSize is POSTS_PER_PAGE, not a new/different constant", () => {
    assert.match(body, /const pageSize = POSTS_PER_PAGE;/);
  });

  test("(13)+(14) from/to are computed as (page-1)*pageSize and from+pageSize-1 — page 1 is 0-9, page 2 is 10-19", () => {
    assert.match(body, /const from = \(requestedPage - 1\) \* pageSize;/);
    assert.match(body, /const to = from \+ pageSize - 1;/);
    assert.match(body, /\.range\(from, to\)/);
  });

  test("no full-array .slice() pagination remains — this function never fetches getPublishedPosts()", () => {
    assert.doesNotMatch(body, /getPublishedPosts\(\)/);
    assert.doesNotMatch(body, /\.slice\(/);
  });
});

group("(9)+(10) the common case gets count from the SAME query as the page's rows; a narrow fallback handles what that query cannot", () => {
  test("the primary attempt requests { count: \"exact\" } in the same call that also fetches the page's rows", () => {
    assert.match(body, /const primary = await buildFilteredQuery\(columns, \{ count: "exact" \}\)\s*\n\s*\.range\(from, to\)/);
  });

  test("count and rows both come from `primary` directly whenever that attempt succeeds — no fallback query runs on the ordinary path", () => {
    const happyPathBlock = body.slice(body.indexOf("} else {"), body.indexOf("const totalPages = Math.max(1, Math.ceil(total / pageSize));\n\n  const posts"));
    assert.match(happyPathBlock, /resolveQueryResult\(primary\.data, primary\.error, "getPublishedPostsPaged: Supabase query failed"\) \?\? \[\];/);
    assert.match(happyPathBlock, /total = primary\.count \?\? 0;/);
  });

  test("PostgREST rejects an out-of-range/empty-result .range() rather than returning it empty (PGRST103) — documented and handled, not a full-table count query", () => {
    // Confirmed against a live Supabase instance while building this
    // function: combining count+range cannot be the *only* path, since
    // PostgREST errors instead of returning zero rows once the requested
    // offset is at or beyond the filtered row count. The fallback below is
    // a single head-only (no rows transferred) count query scoped by the
    // exact same filters — not a full-table scan — used only when the
    // primary attempt hits this specific error.
    assert.match(body, /if \(primary\.error\?\.code === "PGRST103"\) \{/);
    assert.match(body, /const countOnly = await buildFilteredQuery\("id", \{ count: "exact", head: true \}\);/);
  });
});

group("(11) ordering is created_at DESC with a deterministic secondary tiebreaker", () => {
  test("orders by created_at descending, matching every other public listing query in this file", () => {
    assert.match(body, /\.order\("created_at", \{ ascending: false \}\)/);
  });

  test("(12) has a secondary id-descending tiebreaker, so .range() pagination cannot skip or repeat a row when many share the same created_at", () => {
    assert.match(
      body,
      /\.order\("created_at", \{ ascending: false \}\)\s*\n\s*\.order\("id", \{ ascending: false \}\);/,
    );
  });
});

group("(15)+(16) invalid/out-of-range page values normalise and clamp safely", () => {
  test("page comes from the canonical normalisePage() — no second page-number parser", () => {
    assert.match(body, /const requestedPage = normalisePage\(page\);/);
  });

  test("on the PGRST103 fallback path, totalPages is derived from the head-only count and servedPage is clamped to it", () => {
    const fallbackBlock = body.slice(body.indexOf('if (primary.error?.code === "PGRST103")'), body.indexOf("} else {"));
    assert.match(fallbackBlock, /const totalPages = Math\.max\(1, Math\.ceil\(total \/ pageSize\)\);/);
    assert.match(fallbackBlock, /servedPage = Math\.min\(requestedPage, totalPages\);/);
  });

  test("an out-of-range (but non-empty) page triggers a second, still-bounded .range() retry at the clamped position rather than an empty result", () => {
    assert.match(body, /const clampedFrom = \(servedPage - 1\) \* pageSize;/);
    assert.match(body, /const clampedTo = clampedFrom \+ pageSize - 1;/);
    assert.match(body, /const retry = await buildFilteredQuery\(columns\)\s*\n\s*\.range\(clampedFrom, clampedTo\)/);
  });

  test("the happy-path branch also clamps servedPage, in case count and the primary attempt's success ever disagree", () => {
    const happyPathBlock = body.slice(body.indexOf("} else {"), body.indexOf("const totalPages = Math.max(1, Math.ceil(total / pageSize));\n\n  const posts"));
    assert.match(happyPathBlock, /servedPage = Math\.min\(requestedPage, totalPages\);/);
  });
});

group("(17) zero-result handling is safe — no division by zero, no negative range, no PGRST103 crash", () => {
  test("Math.max(1, ...) guarantees totalPages is never 0, so (page-1) can never go negative from a clamp", () => {
    assert.match(body, /Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)/);
  });

  test("zero matching rows is detected on the PGRST103 fallback path (offset 0 is also \"beyond the end\" of an empty result) and short-circuits to an empty page without attempting an impossible .range()", () => {
    assert.match(body, /if \(total === 0\) \{\s*\n\s*rows = \[\];\s*\n\s*\} else \{/);
  });

  test("never throws to the caller on a genuine empty result — falls back to [] via resolveQueryResult(...) ?? [] on every data path", () => {
    const resolveCalls = [...body.matchAll(/resolveQueryResult\([^)]+\) \?\? \[\]/g)];
    assert.ok(resolveCalls.length >= 2, "expected the ?? [] fallback on both the primary/happy-path and the retry path");
  });
});

group("(21) a retired post can never appear, and can never occupy or shift a page boundary", () => {
  test("the .not(slug in retired) filter is built into buildFilteredQuery itself — every caller (primary, the head-only count, and the retry) gets the same exclusion applied before any count or range is computed", () => {
    // .not("slug", "in", ...) lives inside buildFilteredQuery(), the one
    // shared filter-building function every attempt (primary, the
    // PGRST103 fallback's count-only probe, and its retry) calls — so a
    // retired post is removed from the candidate set before Postgres ever
    // decides which rows fall in a range or what any count is. There is no
    // post-query JS step that could let one slip through onto a page, and
    // no query variant that computes a count/range over a different,
    // retired-inclusive set.
    const buildQueryBody = body.slice(
      body.indexOf("function buildFilteredQuery"),
      body.indexOf("return query"),
    );
    assert.match(buildQueryBody, /\.select\(select, options\)/);
    assert.match(buildQueryBody, /query = query\.not\("slug", "in", `\(\$\{retiredList\}\)`\);/);
  });

  test("unlike an over-fetch-then-filter approach, this function contains no JS-level retired-slug removal step that could leave a page short of pageSize results", () => {
    // If retired-slug exclusion happened only in JavaScript AFTER a bounded
    // .range() fetch, a retired post landing inside that range would shrink
    // the visible page below pageSize (exactly the risk this task's own
    // prompt warned about). Because the exclusion is a WHERE clause here,
    // that scenario cannot occur — .range() operates over rows that already
    // exclude every retired slug, so a full page of `pageSize` live rows (or
    // however many truly exist) is always what gets returned.
    assert.doesNotMatch(body, /\.filter\(\(post\) => !RETIRED_SLUGS\.includes/);
    assert.doesNotMatch(body, /\.filter\(\(row\) => !RETIRED_SLUGS\.includes/);
  });

  test("a page-boundary scenario is handled by construction: if a retired post's created_at would have landed it exactly at position 10/11 (the page-1/page-2 boundary), it is excluded before ordering/ranging ever runs, so position 10/11 is always the 10th/11th truly-live post — no off-by-one from a retired row consuming a slot", () => {
    const notCallIndex = body.indexOf('query = query.not("slug", "in"');
    const orderCallIndex = body.indexOf('.order("created_at"');
    const rangeCallIndex = src.indexOf(".range(from, to)");
    assert.ok(notCallIndex !== -1 && orderCallIndex !== -1 && rangeCallIndex !== -1);
    assert.ok(
      notCallIndex < orderCallIndex && orderCallIndex < rangeCallIndex,
      "retired-slug exclusion must precede ordering, which must precede ranging, so position/boundary math never includes a retired row",
    );
  });
});

group("(18) retired slugs are excluded at the database layer, not over-fetched-and-filtered in JavaScript", () => {
  test("excludes RETIRED_SLUGS via .not(\"slug\", \"in\", ...) before .range()/count ever apply", () => {
    assert.match(body, /if \(RETIRED_SLUGS\.length > 0\) \{/);
    assert.match(body, /query = query\.not\("slug", "in", `\(\$\{retiredList\}\)`\);/);
  });

  test("because the exclusion is applied before .range(), a retired post can never occupy a page boundary or shrink a page below pageSize — count and range both operate on the true eligible set", () => {
    const notIndex = body.indexOf('query = query.not("slug", "in"');
    const rangeCallIndex = src.indexOf(".range(from, to)");
    assert.ok(notIndex !== -1 && rangeCallIndex !== -1);
    assert.ok(notIndex < rangeCallIndex, "retired-slug exclusion must be built into the query before it is ever .range()'d");
  });

  test("does not use the over-fetch-and-filter-in-JS pattern getAdjacentPosts() uses for its own single-row lookup", () => {
    assert.doesNotMatch(body, /RETIRED_SLUGS\.includes/);
  });
});

group("(19) no unbounded getPublishedPosts() call is used by this function", () => {
  test("getPublishedPostsPaged never calls getPublishedPosts()", () => {
    assert.doesNotMatch(body, /getPublishedPosts\(\)/);
  });

  test("issues exactly one base .from(\"blog_posts\") builder (buildFilteredQuery), reused by the primary fetch, the fallback's count-only probe, and the retry", () => {
    const fromCalls = [...body.matchAll(/\.from\("blog_posts"\)/g)];
    assert.equal(fromCalls.length, 1, "buildFilteredQuery() should be the single place blog_posts is queried from");
  });

  test("buildFilteredQuery is a function (fresh builder per call), not a single pre-built query object reused across two awaited .range() calls", () => {
    assert.match(
      body,
      /function buildFilteredQuery\(\s*\n\s*select: string,\s*\n\s*options\?: \{ count\?: "exact"; head\?: boolean \},\s*\n\s*\) \{/,
    );
    assert.match(body, /const primary = await buildFilteredQuery\(columns, \{ count: "exact" \}\)\s*\n\s*\.range\(from, to\)/);
  });
});

group("(6) selected columns: content is kept, and why", () => {
  test("selects LIST_COLUMNS plus content for the row-fetching attempts — not a narrower column set", () => {
    assert.match(body, /const columns = `\$\{LIST_COLUMNS\}, content`;/);
    assert.match(body, /buildFilteredQuery\(columns, \{ count: "exact" \}\)/);
  });

  test("the PGRST103 fallback's count-only probe selects just \"id\" (head-only, no rows) — never the full column set merely to get a count", () => {
    assert.match(body, /buildFilteredQuery\("id", \{ count: "exact", head: true \}\);/);
  });

  test("excerptText/readMinutes are still derived exactly as fetchPublished() derives them — content is genuinely needed, not selected out of habit", () => {
    assert.match(body, /excerptText: rest\.description \|\| excerpt\(content\)/);
    assert.match(body, /readMinutes: readingTime\(content\)/);
  });
});

group("uses the public, cookie-less client — no admin/service-role client, no reuse of Task 9's admin helpers", () => {
  test("this module's only Supabase client import is the public one", () => {
    assert.match(src, /import \{ supabase \} from "@\/lib\/supabase\/public";/);
    assert.doesNotMatch(src, /service.?role/i);
  });

  test("does not import or call lib/admin.ts's getAdminBlogPosts — public and admin data access stay separate", () => {
    assert.doesNotMatch(src, /getAdminBlogPosts/);
    assert.doesNotMatch(src, /from "@\/lib\/admin"/);
  });
});

group("not wrapped in unstable_cache — matches Task 4/7's precedent for parameterized reads", () => {
  test("getPublishedPostsPaged is never passed to unstable_cache", () => {
    assert.doesNotMatch(src, /unstable_cache\(\s*getPublishedPostsPaged/);
  });
});
