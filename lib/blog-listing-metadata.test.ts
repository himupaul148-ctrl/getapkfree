import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the P1 SEO fix: app/blog/page.tsx's
 * generateMetadata() used to return the identical <title>/description for
 * every indexable URL — the plain listing, every category (`?category=`),
 * and every page beyond the first (`?page=`) — even though the canonical URL
 * already varied correctly for all of them. This file walks through the
 * task's own A-H scenario list against the exact source this runs in
 * production. Same import-time constraint documented throughout this
 * project for JSX-bearing files pulling in next/cache-dependent modules (see
 * lib/blog-page-wiring.test.ts, this file's direct sibling, whose own pinned
 * canonical/search/pagination assertions were re-run — unchanged — alongside
 * this fix).
 */

const src = readFileSync(
  fileURLToPath(new URL("../app/blog/page.tsx", import.meta.url)),
  "utf8",
);

function metaBody(): string {
  const start = src.indexOf("export async function generateMetadata");
  const end = src.indexOf("export default async function BlogIndexPage");
  assert.ok(start > -1 && end > start, "generateMetadata not found");
  return src.slice(start, end);
}

group("A. /blog — plain listing keeps a strong, homepage-style title/description", () => {
  test("a named base title/description constant exists and is used as the initial value before any branch runs", () => {
    assert.match(src, /const BASE_BLOG_TITLE = "GetApkFree Blog — App guides and recommendations";/);
    assert.match(src, /const BASE_BLOG_DESCRIPTION =\s*\n\s*"Guides, tips and app recommendations from the GetApkFree team\./);
    const body = metaBody();
    assert.match(body, /let title: string = BASE_BLOG_TITLE;/);
    assert.match(body, /let description: string = BASE_BLOG_DESCRIPTION;/);
  });

  test("no category and page 1 (or no page param) never enters the category/pagination branches — title/description stay exactly the base constants", () => {
    const body = metaBody();
    assert.match(body, /if \(categoryLabel\) \{[\s\S]*?title = /);
    assert.match(body, /if \(page > 1\) \{[\s\S]*?title = /);
  });
});

group("B. category — a category-specific title and description, validated against the canonical list", () => {
  test("imports blogCategoryMetaDescription from lib/seo, the new per-category description generator", () => {
    assert.match(
      src,
      /import \{ SITE_NAME, absolute, blogCategoryMetaDescription, clampDescription \} from "@\/lib\/seo";/,
    );
  });

  test("category comes from getPublishedPostsPaged's own return value — already validated against BLOG_CATEGORIES (empty string for anything invalid), not read from raw searchParams directly", () => {
    const body = metaBody();
    assert.match(
      body,
      /const \{ page, category \} = await getPublishedPostsPaged\(\{\s*\n\s*category: params\.category,\s*\n\s*page: params\.page,\s*\n\s*\}\);/,
    );
    assert.doesNotMatch(body, /CATEGORY_LABELS\[params\.category/);
  });

  test("the category title uses CATEGORY_LABELS (the canonical label map), not the raw category string", () => {
    const body = metaBody();
    assert.match(
      body,
      /const categoryLabel = category\s*\n\s*\? CATEGORY_LABELS\[category as BlogCategory\]\s*\n\s*: null;/,
    );
    assert.match(body, /title = `\$\{categoryLabel\} — \$\{SITE_NAME\} Blog`;/);
  });

  test("the category description is built via blogCategoryMetaDescription(category), not a duplicated/inline template", () => {
    const body = metaBody();
    assert.match(body, /description = blogCategoryMetaDescription\(category\);/);
  });

  test("a category title/description is only applied when categoryLabel is truthy — an empty/invalid category leaves title/description at their base values", () => {
    const body = metaBody();
    assert.match(body, /if \(categoryLabel\) \{/);
  });
});

group("C. page 2 — a page-specific title/description, not identical to page 1's", () => {
  test("the page>1 branch appends a page indicator to the title, distinct from the un-suffixed base/category title", () => {
    const body = metaBody();
    assert.match(body, /if \(page > 1\) \{/);
    assert.match(body, /title = `\$\{title\} — Page \$\{page\}`;/);
  });

  test("the page>1 branch prefixes (not appends to) the description — a prefix survives clampDescription's right-side truncation, an appended suffix might not", () => {
    const body = metaBody();
    assert.match(body, /description = `Page \$\{page\}: \$\{description\}`;/);
  });

  test("the pagination branch runs after the category branch, so it composes with an already-set category title/description rather than overwriting it", () => {
    const body = metaBody();
    const categoryIfIndex = body.indexOf("if (categoryLabel) {");
    const pageIfIndex = body.indexOf("if (page > 1) {");
    assert.ok(categoryIfIndex > -1 && pageIfIndex > -1);
    assert.ok(categoryIfIndex < pageIfIndex, "expected the category branch to run before the pagination branch");
  });
});

group("D. category + page 2 — both reflected in the same title/description", () => {
  test("title composes as \"{label} — {SITE_NAME} Blog — Page {page}\" when both a category and page>1 are active — the pagination branch's template literal reuses whatever `title` already holds", () => {
    const body = metaBody();
    // The pagination branch's title template (`${title} — Page ${page}`)
    // reuses the `title` variable in place, so it necessarily composes with
    // whatever the category branch already set it to — no separate
    // category+page-specific template exists (or is needed) to duplicate.
    assert.match(body, /title = `\$\{title\} — Page \$\{page\}`;/);
    assert.match(body, /title = `\$\{categoryLabel\} — \$\{SITE_NAME\} Blog`;/);
  });

  test("description composes the same way — the pagination prefix wraps whatever description the category branch already produced", () => {
    const body = metaBody();
    assert.match(body, /description = `Page \$\{page\}: \$\{description\}`;/);
    assert.match(body, /description = blogCategoryMetaDescription\(category\);/);
  });
});

group("E. search (?q=) — noindex preserved, no special indexable search metadata", () => {
  test("the query branch still sets robots to noindex,follow and never enters the category/pagination title/description logic", () => {
    const ifIndex = src.indexOf("if (query) {");
    const elseIndex = src.indexOf("} else {");
    assert.ok(ifIndex > -1 && elseIndex > ifIndex);
    const ifBranch = src.slice(ifIndex, elseIndex);
    assert.match(ifBranch, /robots = \{ index: false, follow: true \};/);
    assert.doesNotMatch(ifBranch, /blogCategoryMetaDescription/);
    assert.doesNotMatch(ifBranch, /CATEGORY_LABELS/);
    assert.doesNotMatch(ifBranch, /Page \$\{page\}/);
  });

  test("a search request's title/description remain the plain base constants — never made category/page-specific", () => {
    const ifIndex = src.indexOf("if (query) {");
    const elseIndex = src.indexOf("} else {");
    const ifBranch = src.slice(ifIndex, elseIndex);
    assert.doesNotMatch(ifBranch, /title = /);
    assert.doesNotMatch(ifBranch, /description = /);
  });
});

group("F. page 1 canonical behavior is unchanged", () => {
  test("canonical still omits an explicit page=1 — the qs-building logic (if (page > 1) qs.set(\"page\", ...)) is untouched by this fix", () => {
    const body = metaBody();
    assert.match(body, /if \(page > 1\) qs\.set\("page", String\(page\)\);/);
  });

  test("canonical still omits q and includes category only when present — untouched", () => {
    const body = metaBody();
    assert.match(body, /if \(category\) qs\.set\("category", category\);/);
    assert.doesNotMatch(body, /qs\.set\("q"/);
  });
});

group("G. invalid category — falls back to current (base) behavior, not a crash or a fabricated label", () => {
  test("categoryLabel is only ever looked up through the already-validated `category` value — an invalid ?category= normalises to \"\" upstream (getPublishedPostsPaged), so categoryLabel is null and title/description never leave their base values", () => {
    const body = metaBody();
    assert.match(body, /const categoryLabel = category\s*\n\s*\? CATEGORY_LABELS\[category as BlogCategory\]\s*\n\s*: null;/);
  });

  test("no direct, unvalidated indexing of CATEGORY_LABELS by the raw searchParams category exists in generateMetadata", () => {
    const body = metaBody();
    assert.doesNotMatch(body, /CATEGORY_LABELS\[params\.category as BlogCategory\]/);
  });
});

group("H. metadata remains deterministic", () => {
  test("title/description are built purely from category/page (both derived deterministically from searchParams via getPublishedPostsPaged) — no Math.random, no Date.now, no non-deterministic input", () => {
    const body = metaBody();
    assert.doesNotMatch(body, /Math\.random/);
    assert.doesNotMatch(body, /Date\.now/);
    assert.doesNotMatch(body, /new Date\(\)/);
  });

  test("the final description is always run through clampDescription exactly once, right before being returned — deterministic, bounded-length output for every branch", () => {
    const body = metaBody();
    assert.match(body, /description = clampDescription\(description\);/);
    const occurrences = [...body.matchAll(/clampDescription\(/g)];
    assert.equal(occurrences.length, 1, "expected exactly one clampDescription call, applied once at the end for every branch");
  });
});

group("existing metadata fields are preserved exactly — only title/description construction changed", () => {
  test("openGraph/twitter title/description remain the original generic strings, untouched by this fix", () => {
    assert.match(src, /title: `Blog \| \$\{SITE_NAME\}`,\s*\n\s*description:\s*\n\s*"Guides, tips and app recommendations from the GetApkFree team\.",/);
  });

  test("openGraph type/url and twitter card fields are untouched", () => {
    assert.match(src, /openGraph: \{\s*\n\s*type: "website",\s*\n\s*url,/);
    assert.match(src, /twitter: \{\s*\n\s*card: "summary_large_image",/);
  });

  test("the RSS alternate link and canonical field shape are untouched", () => {
    assert.match(
      src,
      /alternates: \{\s*\n\s*canonical: url,\s*\n\s*types: \{ "application\/rss\+xml": absolute\("\/blog\/feed\.xml"\) \},\s*\n\s*\},/,
    );
  });

  test("robots is still returned as its own top-level field, computed the same way as before (search -> noindex, otherwise index)", () => {
    const body = metaBody();
    assert.match(body, /let robots: Metadata\["robots"\] = \{ index: true, follow: true \};/);
    assert.match(src, /^\s*robots,$/m);
  });
});
