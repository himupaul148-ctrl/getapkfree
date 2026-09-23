import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against components/HomeSections.tsx —
 * Phase 1 Task 7's category-page UI integration. It can't be imported
 * directly under plain `node --test` (it transitively pulls in
 * lib/blog.ts's and lib/catalogue.ts's `next/cache` imports, the same
 * constraint documented throughout this project for other *.tsx files, e.g.
 * lib/category-cards-links.test.ts against
 * components/catalogue/CategoryCards.tsx).
 */

const src = readFileSync(
  fileURLToPath(new URL("../components/HomeSections.tsx", import.meta.url)),
  "utf8",
);

group("consumes the Task 6 mapping — no new taxonomy relationship introduced", () => {
  test("imports getBlogCategoryForAppCategory from lib/blog-app-category-mapping, not a second mapping", () => {
    assert.match(
      src,
      /import \{ getBlogCategoryForAppCategory \} from "@\/lib\/blog-app-category-mapping";/,
    );
  });

  test("no hand-written category-to-category object literal was added here", () => {
    assert.doesNotMatch(src, /BLOG_TO_APP_CATEGORY\s*=\s*\{/);
    assert.doesNotMatch(src, /APP_TO_BLOG_CATEGORY/);
  });

  test("guards the active category through isCategory() before consulting the mapping — an unrecognised value is never passed to it", () => {
    assert.match(
      src,
      /filters\.category && isCategory\(filters\.category\)\s*\n\s*\? getBlogCategoryForAppCategory\(filters\.category\)\s*\n\s*: undefined/,
    );
  });
});

group("the query is the dedicated, bounded, database-filtered helper — not the sitewide unbounded listing", () => {
  test("imports getPublishedPostsByCategory alongside the existing getPublishedPosts, not a new ad hoc query", () => {
    assert.match(
      src,
      /import \{ getPublishedPosts, getPublishedPostsByCategory \} from "@\/lib\/blog";/,
    );
  });

  test("calls getPublishedPostsByCategory(categoryBlogCategory) only when a mapping was actually found", () => {
    assert.match(
      src,
      /categoryBlogCategory\s*\n\s*\? getPublishedPostsByCategory\(categoryBlogCategory\)\.catch\(\(\) => \[\]\)\s*\n\s*: Promise\.resolve\(\[\]\)/,
    );
  });

  test("no separate/duplicate call to getPublishedPostsByCategory exists anywhere else in the file", () => {
    const calls = [...src.matchAll(/getPublishedPostsByCategory\(/g)];
    assert.equal(calls.length, 1);
  });
});

group("fetched in parallel with the existing catalogue/blog fetches — no added waterfall", () => {
  test("categoryRelatedPosts is destructured from the same Promise.all as apps/error and posts", () => {
    assert.match(
      src,
      /const \[\{ apps, error \}, posts, categoryRelatedPosts\] = await Promise\.all\(\[/,
    );
  });

  test("categoryBlogCategory is resolved synchronously (from filters alone) before the Promise.all, not awaited first", () => {
    const mappingIndex = src.indexOf("const categoryBlogCategory =");
    const promiseAllIndex = src.indexOf("await Promise.all([");
    assert.ok(mappingIndex > -1 && promiseAllIndex > -1);
    assert.ok(mappingIndex < promiseAllIndex);
    // Confirms it isn't itself awaited (it's a plain synchronous ternary).
    const mappingStatement = src.slice(mappingIndex, src.indexOf(";", mappingIndex));
    assert.doesNotMatch(mappingStatement, /await/);
  });
});

group("the section renders only when mapped AND non-empty — never an empty state", () => {
  test("guarded by `filters.category && categoryRelatedPosts.length > 0`", () => {
    assert.match(src, /\{filters\.category && categoryRelatedPosts\.length > 0 && \(/);
  });

  test("no placeholder/empty-state copy exists for the zero-match or unmapped case", () => {
    assert.doesNotMatch(src, /No articles/i);
    assert.doesNotMatch(src, /No related (posts|articles)/i);
    assert.doesNotMatch(src, /No guides/i);
  });

  test("the section heading names the active category, so it clearly identifies the content as category-relevant", () => {
    assert.match(src, /\{filters\.category\} Guides &amp; Articles/);
  });
});

group("matching posts render via the existing BlogCard component — real, crawlable /blog/{slug} links", () => {
  test("imports BlogCard (already used elsewhere in this file) rather than a new card component", () => {
    assert.match(src, /import BlogCard from "@\/components\/blog\/BlogCard";/);
  });

  test("renders <BlogCard post={post} /> for each categoryRelatedPosts entry, the same call shape as the existing Latest-from-the-Blog section", () => {
    const sectionStart = src.indexOf("categoryRelatedPosts.length > 0 && (");
    const sectionEnd = src.indexOf("latestPosts.length > 0 && (");
    const section = src.slice(sectionStart, sectionEnd);
    assert.match(section, /categoryRelatedPosts\.map\(\(post\) => \(/);
    assert.match(section, /<BlogCard key=\{post\.id\} post=\{post\} \/>/);
  });

  test("BlogCard itself links to the canonical /blog/{slug} URL (components/blog/BlogCard.tsx), not a query-param or admin/preview URL", () => {
    const blogCard = readFileSync(
      fileURLToPath(new URL("../components/blog/BlogCard.tsx", import.meta.url)),
      "utf8",
    );
    assert.match(blogCard, /href=\{`\/blog\/\$\{post\.slug\}`\}/);
  });
});

group("existing content and structure are preserved", () => {
  test("CategoryAppList's existing conditional block is untouched and precedes the new section", () => {
    const categoryAppListIndex = src.indexOf("filters.category && categoryPageApps.length > 0");
    const newSectionIndex = src.indexOf("filters.category && categoryRelatedPosts.length > 0");
    assert.ok(categoryAppListIndex > -1 && newSectionIndex > -1);
    assert.ok(categoryAppListIndex < newSectionIndex);
  });

  test("CatalogueSection, CategoryCards, and the sitewide Latest-from-the-Blog section are all still present", () => {
    assert.match(src, /<CatalogueSection/);
    assert.match(src, /<CategoryCards counts=\{counts\}\s*\/>/);
    assert.match(src, /Latest from the Blog/);
  });

  test("no unrelated section (Featured Apps, Recently Updated, WhyGetApkFree) was removed", () => {
    assert.match(src, /Featured Apps/);
    assert.match(src, /Recently Updated/);
    assert.match(src, /<WhyGetApkFree \/>/);
  });
});
