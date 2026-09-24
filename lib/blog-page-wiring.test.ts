import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against app/blog/page.tsx — Phase 1 Task
 * 10B (C1)'s wiring of getPublishedPostsPaged() into the public blog
 * listing. Same import-time constraint documented throughout this project
 * for *.tsx files pulling in next/cache-dependent modules (see
 * lib/admin-blog-page-wiring.test.ts for the identical admin-side
 * counterpart this file mirrors).
 */

const src = readFileSync(
  fileURLToPath(new URL("../app/blog/page.tsx", import.meta.url)),
  "utf8",
);

group("the unbounded fetch/filter/slice is gone — replaced by getPublishedPostsPaged", () => {
  test("imports getPublishedPostsPaged from lib/blog, not getPublishedPosts", () => {
    assert.match(
      src,
      /import \{\s*\n\s*CATEGORY_LABELS,\s*\n\s*getPublishedPostsPaged,\s*\n\s*type BlogCategory,\s*\n\s*\} from "@\/lib\/blog";/,
    );
    assert.doesNotMatch(src, /getPublishedPosts\(\)/);
  });

  test("no full-array .filter()/.slice() pagination remains in this file", () => {
    assert.doesNotMatch(src, /\.filter\(\(post\)/);
    assert.doesNotMatch(src, /\.slice\(start/);
    assert.doesNotMatch(src, /function matches\(/);
  });

  test("POSTS_PER_PAGE/normaliseBlogCategory/normalisePage are no longer imported directly here — that normalisation now lives inside getPublishedPostsPaged", () => {
    assert.doesNotMatch(src, /POSTS_PER_PAGE/);
    assert.doesNotMatch(src, /normaliseBlogCategory/);
    assert.doesNotMatch(src, /normalisePage/);
  });
});

group("generateMetadata() uses the same bounded helper as the page body — no separate full computation", () => {
  test("calls getPublishedPostsPaged in the non-search branch, reading back the already-clamped page/category", () => {
    const metaStart = src.indexOf("export async function generateMetadata");
    const metaEnd = src.indexOf("export default async function BlogIndexPage");
    const metaBody = src.slice(metaStart, metaEnd);
    assert.match(
      metaBody,
      /const \{ page, category \} = await getPublishedPostsPaged\(\{\s*\n\s*category: params\.category,\s*\n\s*page: params\.page,\s*\n\s*\}\);/,
    );
  });

  test("generateMetadata never passes `search` to the helper — it only runs in the no-query branch, matching the prior category-only filtered.length computation", () => {
    const metaStart = src.indexOf("export async function generateMetadata");
    const metaEnd = src.indexOf("export default async function BlogIndexPage");
    const metaBody = src.slice(metaStart, metaEnd);
    assert.doesNotMatch(metaBody, /search: /);
  });

  test("does not independently fetch/filter/paginate an array itself anymore", () => {
    const metaStart = src.indexOf("export async function generateMetadata");
    const metaEnd = src.indexOf("export default async function BlogIndexPage");
    const metaBody = src.slice(metaStart, metaEnd);
    assert.doesNotMatch(metaBody, /\.filter\(/);
    assert.doesNotMatch(metaBody, /Math\.ceil/);
  });
});

group("search noindex behavior is preserved exactly", () => {
  test("robots stays { index: false, follow: true } when q is present, decided before any query runs", () => {
    assert.match(
      src,
      /if \(query\) \{[\s\S]*?robots = \{ index: false, follow: true \};/,
    );
  });

  test("the noindex branch does not call getPublishedPostsPaged at all — it never needed the count for a canonical", () => {
    const ifIndex = src.indexOf("if (query) {");
    const elseIndex = src.indexOf("} else {");
    const ifBranch = src.slice(ifIndex, elseIndex);
    assert.doesNotMatch(ifBranch, /getPublishedPostsPaged/);
  });
});

group("category/page canonical construction is preserved exactly", () => {
  test("canonical omits q, includes category when present, includes page only when > 1", () => {
    assert.match(src, /if \(category\) qs\.set\("category", category\);/);
    assert.match(src, /if \(page > 1\) qs\.set\("page", String\(page\)\);/);
    const metaStart = src.indexOf("export async function generateMetadata");
    const metaEnd = src.indexOf("export default async function BlogIndexPage");
    assert.doesNotMatch(src.slice(metaStart, metaEnd), /qs\.set\("q"/);
  });

  test("canonical remains self-referencing: /blog when no suffix, /blog?<suffix> otherwise", () => {
    assert.match(
      src,
      /const suffix = qs\.toString\(\);\s*\n\s*canonicalPath = suffix \? `\/blog\?\$\{suffix\}` : "\/blog";/,
    );
  });
});

group("Breadcrumb JSON-LD is untouched", () => {
  test("still renders BreadcrumbJsonLd with the same Home/Blog trail", () => {
    assert.match(
      src,
      /<BreadcrumbJsonLd\s*\n\s*items=\{\[\s*\n\s*\{ name: "Home", url: absolute\("\/"\) \},\s*\n\s*\{ name: "Blog", url: absolute\("\/blog"\) \},\s*\n\s*\]\}\s*\n\s*\/>/,
    );
  });

  test("no ItemList/CollectionPage/BlogPosting JSON-LD was added — structured data scope is unchanged", () => {
    assert.doesNotMatch(src, /ItemListJsonLd/);
    assert.doesNotMatch(src, /CollectionPage/);
    assert.doesNotMatch(src, /BlogJsonLd/);
  });
});

group("public page still renders BlogCards, filters, and the existing pager UI — no redesign", () => {
  test("still renders BlogFilters with initialQuery/initialCategory", () => {
    assert.match(src, /<BlogFilters initialQuery=\{search\} initialCategory=\{category\} \/>/);
  });

  test("still renders BlogCard per post, same call shape as before", () => {
    assert.match(src, /import BlogCard from "@\/components\/blog\/BlogCard";/);
    assert.match(src, /<BlogCard key=\{post\.id\} post=\{post\} \/>/);
  });

  test("still renders the existing Prev/numbered-pages/Next nav, not the admin Task 9 pager", () => {
    assert.match(src, /aria-label="Blog pages"/);
    assert.match(src, /‹ Prev/);
    assert.match(src, /Next ›/);
    assert.match(
      src,
      /\{Array\.from\(\{ length: totalPages \}, \(_, i\) => i \+ 1\)\.map\(\(n\) =>/,
    );
    assert.doesNotMatch(src, /Page \{page\} of \{totalPages\}/, "must not reuse the admin pager's own label format");
  });

  test("pageHref still omits q on a plain link, includes it when search is active, and includes page only when > 1", () => {
    assert.match(
      src,
      /function pageHref\(target: number\) \{\s*\n\s*const qs = new URLSearchParams\(\);\s*\n\s*if \(search\) qs\.set\("q", search\);\s*\n\s*if \(category\) qs\.set\("category", category\);\s*\n\s*if \(target > 1\) qs\.set\("page", String\(target\)\);/,
    );
  });
});

group("page body uses the same bounded helper — no unbounded fetch, no in-memory pagination", () => {
  test("BlogIndexPage destructures posts/page/pageSize/totalPages/total/category/search from one getPublishedPostsPaged call", () => {
    assert.match(
      src,
      /const \{ posts, page, pageSize, totalPages, total, category, search \} =\s*\n\s*await getPublishedPostsPaged\(\{\s*\n\s*category: params\.category,\s*\n\s*search: params\.q,\s*\n\s*page: params\.page,\s*\n\s*\}\);/,
    );
  });

  test("start (the 'showing N-M of T' offset) is derived from page/pageSize, not a full-array slice index", () => {
    assert.match(src, /const start = \(page - 1\) \* pageSize;/);
  });

  test("the 'Showing N-M of T posts' line uses `total`, the query's exact count, not filtered.length over an in-memory array", () => {
    assert.match(
      src,
      /Showing \{start \+ 1\}–\{start \+ posts\.length\} of \{total\} post/,
    );
  });
});

group("empty-state handling: distinguishes an empty blog from a filtered zero-match without a second unconditional query", () => {
  test("blogIsEmpty is true only when total is 0 AND no filter is active — otherwise a filtered zero-match still reads as 'no posts match'", () => {
    assert.match(
      src,
      /const blogIsEmpty = total === 0 && !category && !search;/,
    );
  });

  test("the two empty-state messages ('No posts yet' vs 'No posts match') are both still present, unchanged wording", () => {
    assert.match(src, /No posts yet\. Check back soon!/);
    assert.match(src, /No posts match\{" "\}/);
  });
});

group("sitemap/RSS call sites remain untouched", () => {
  test("app/sitemap.ts still uses getPublishedPostsForSitemap, not getPublishedPostsPaged", () => {
    const sitemapSrc = readFileSync(
      fileURLToPath(new URL("../app/sitemap.ts", import.meta.url)),
      "utf8",
    );
    assert.match(sitemapSrc, /getPublishedPostsForSitemap/);
    assert.doesNotMatch(sitemapSrc, /getPublishedPostsPaged/);
  });

  test("app/blog/feed.xml/route.ts uses the bounded getRecentPosts(FEED_LIMIT), not getPublishedPostsPaged or the unbounded getPublishedPosts", () => {
    const feedSrc = readFileSync(
      fileURLToPath(new URL("../app/blog/feed.xml/route.ts", import.meta.url)),
      "utf8",
    );
    assert.match(feedSrc, /const posts = await getRecentPosts\(FEED_LIMIT\);/);
    assert.doesNotMatch(feedSrc, /getPublishedPostsPaged/);
    assert.doesNotMatch(feedSrc, /getPublishedPosts\(\)/);
  });
});

group("route-level configuration is untouched", () => {
  test("export const dynamic = \"force-dynamic\" is preserved", () => {
    assert.match(src, /export const dynamic = "force-dynamic";/);
  });
});
