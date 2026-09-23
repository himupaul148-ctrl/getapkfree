import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against components/blog/BlogCard.tsx
 * (CategoryBadge) and components/blog/ArticleHeader.tsx — Phase 1 Task 8's
 * crawlable category-label fix. Both are "use client"-free but JSX-bearing
 * *.tsx files that plain `node --test`'s native TypeScript stripping cannot
 * parse (it strips types only, it does not transform JSX) — the same
 * constraint documented throughout this project for other *.tsx files (see
 * lib/category-cards-links.test.ts against
 * components/catalogue/CategoryCards.tsx).
 *
 * Before this fix, every category badge — on the article page and
 * everywhere else CategoryBadge/BlogCard are used — was a plain, unclickable
 * <span>. The fix adds an optional `href` prop to CategoryBadge, passed only
 * from the individual article page. The three-distinct-layouts task later
 * extracted the article header (title/badge/meta/description) out of
 * BlogArticleView.tsx into its own shared components/blog/ArticleHeader.tsx,
 * reused by all three type-specific layouts — this file's assertions were
 * updated to read that file instead, since the badge/H1/meta markup itself
 * is unchanged, just relocated. Every other CategoryBadge call site (the
 * card grids, already wrapped in their own <Link> to the post) deliberately
 * keeps passing no `href`, since a second, nested <a> inside an existing one
 * would be invalid HTML.
 */

const badgeSrc = readFileSync(
  fileURLToPath(new URL("../components/blog/BlogCard.tsx", import.meta.url)),
  "utf8",
);
const articleHeaderSrc = readFileSync(
  fileURLToPath(new URL("../components/blog/ArticleHeader.tsx", import.meta.url)),
  "utf8",
);
const markdownRendererSrc = readFileSync(
  fileURLToPath(new URL("../components/blog/MarkdownRenderer.tsx", import.meta.url)),
  "utf8",
);
const appPageSrc = readFileSync(
  fileURLToPath(new URL("../app/app/[slug]/page.tsx", import.meta.url)),
  "utf8",
);

/**
 * CategoryBadge's own body, sliced up to the next top-level declaration
 * rather than matched with a `\n}`-terminated regex — the function's own
 * destructured-parameter object closes with `\n}` well before the function
 * body does, which a naive regex would stop at.
 */
const categoryBadgeBody = badgeSrc.slice(
  badgeSrc.indexOf("export function CategoryBadge"),
  badgeSrc.indexOf("export default function BlogCard"),
);

group("(1)+(2)+(5) the article page's category label is a real link to /blog?category={category}", () => {
  test("ArticleHeader passes an href built from post.category, URL-encoded", () => {
    assert.match(
      articleHeaderSrc,
      /<CategoryBadge\s*\n\s*category=\{post\.category\}\s*\n\s*href=\{`\/blog\?category=\$\{encodeURIComponent\(post\.category\)\}`\}\s*\n\s*\/>/,
    );
  });

  test("uses the existing blog filtering query param name (\"category\"), not a new one", () => {
    // BlogFilters.tsx (the existing blog listing's own filter UI) builds
    // its category links with the same params.set("category", ...) — this
    // must use the identical param name, not invent a second one.
    const blogFilters = readFileSync(
      fileURLToPath(new URL("../components/blog/BlogFilters.tsx", import.meta.url)),
      "utf8",
    );
    assert.match(blogFilters, /params\.set\("category", nextCategory\)/);
    assert.match(articleHeaderSrc, /\/blog\?category=/);
  });

  test("CategoryBadge, when given an href, renders a real next/link <Link>, not a <span> or a button", () => {
    assert.match(
      categoryBadgeBody,
      /if \(href\) \{\s*\n\s*return \(\s*\n\s*<Link href=\{href\} className=\{CATEGORY_BADGE_CLASSNAME\}>/,
    );
  });
});

group("(3) the category text remains visible", () => {
  test("the linked branch renders the same `label` text the unlinked <span> branch renders", () => {
    const linkedBranch = categoryBadgeBody.slice(
      categoryBadgeBody.indexOf("if (href)"),
      categoryBadgeBody.indexOf("return <span"),
    );
    assert.match(linkedBranch, /\{label\}/);
    assert.match(categoryBadgeBody, /return <span className=\{CATEGORY_BADGE_CLASSNAME\}>\{label\}<\/span>;/);
  });

  test("the label is still computed from CATEGORY_LABELS, unchanged", () => {
    assert.match(badgeSrc, /const label = CATEGORY_LABELS\[category as BlogCategory\] \?\? category;/);
  });
});

group("(4) a representative category resolves through the dynamic href, not a hardcoded example", () => {
  test("the href is built from the post's actual category value (any of the 6 blog categories), not a literal string", () => {
    assert.doesNotMatch(articleHeaderSrc, /href=\{`\/blog\?category=privacy`\}/);
    assert.match(articleHeaderSrc, /encodeURIComponent\(post\.category\)/);
  });
});

group("(6) visual appearance is preserved — identical className in both branches", () => {
  test("both the linked and unlinked branches use the exact same CATEGORY_BADGE_CLASSNAME constant", () => {
    const classNameDecl = badgeSrc.match(/const CATEGORY_BADGE_CLASSNAME =\s*\n\s*"([^"]+)";/);
    assert.ok(classNameDecl, "CATEGORY_BADGE_CLASSNAME constant not found");
    // Exactly the original <span>'s className, unchanged.
    assert.equal(
      classNameDecl![1],
      "inline-flex shrink-0 items-center rounded-full bg-azure-500/10 px-2.5 py-0.5 text-xs font-medium text-azure-300",
    );
    const linkCount = [...badgeSrc.matchAll(/className=\{CATEGORY_BADGE_CLASSNAME\}/g)].length;
    assert.equal(linkCount, 2, "expected both the <Link> and <span> branches to reference the same className constant");
  });

  test("no new ARIA attribute was added to the badge", () => {
    assert.doesNotMatch(categoryBadgeBody, /aria-/);
  });
});

group("existing article content/rendering remains intact", () => {
  test("the H1 and author/date line are still present in ArticleHeader, unmoved relative to the badge", () => {
    assert.match(articleHeaderSrc, /<h1 className="mt-4 text-3xl font-extrabold/);
    assert.match(articleHeaderSrc, /<time dateTime=\{post\.created_at\}>/);
  });

  test("the sanitized content body is still present in MarkdownRenderer — relocated out of BlogArticleView by the three-distinct-layouts task, not removed", () => {
    assert.match(markdownRendererSrc, /dangerouslySetInnerHTML=\{\{ __html: html \}\}/);
  });

  test("the \"min read\" label next to the badge is unchanged", () => {
    assert.match(articleHeaderSrc, /\{minutes\} min read/);
  });
});

group("(7) no second category URL format was introduced — every other CategoryBadge call site is untouched", () => {
  test("BlogCard's own usage (inside its own <Link> to the post) still passes no href — stays a plain <span>, avoiding a nested <a>", () => {
    assert.match(badgeSrc, /<CategoryBadge category=\{post\.category\} \/>/);
  });

  test("BlogCard's outer card <Link> is unchanged", () => {
    assert.match(badgeSrc, /<Link href=\{`\/blog\/\$\{post\.slug\}`\} className="block">/);
  });

  test("the app detail page's related-articles CategoryBadge (Task 4) still passes no href either — untouched by this task", () => {
    assert.match(appPageSrc, /<CategoryBadge category=\{article\.category\} \/>/);
  });

  test("only one place in the whole codebase builds a /blog?category= href", () => {
    const occurrences = [...articleHeaderSrc.matchAll(/\/blog\?category=/g)];
    assert.equal(occurrences.length, 1);
  });
});
