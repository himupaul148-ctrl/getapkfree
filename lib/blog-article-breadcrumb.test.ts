import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the blog-CMS-workflow task's one
 * confirmed gap: blog article breadcrumbs (both the visible nav and the
 * BreadcrumbList JSON-LD) previously skipped the Category level entirely
 * (Home -> Blog -> Article), unlike the expected Home -> Blog -> Category ->
 * Article structure. Fixed in components/blog/BlogArticleView.tsx. Same
 * *.tsx import-time constraint as every other component test in this
 * project.
 */

const src = readFileSync(
  fileURLToPath(new URL("../components/blog/BlogArticleView.tsx", import.meta.url)),
  "utf8",
);

group("BreadcrumbList JSON-LD includes the Category level", () => {
  test("the four-item chain is Home -> Blog -> Category -> Article title, in that order", () => {
    const block = src.match(/<BreadcrumbJsonLd\s*\n\s*items=\{\[[\s\S]*?\]\}\s*\n\s*\/>/);
    assert.ok(block, "BreadcrumbJsonLd call not found");
    const [homeIdx, blogIdx, catIdx, titleIdx] = [
      block![0].indexOf('name: "Home"'),
      block![0].indexOf('name: "Blog"'),
      block![0].indexOf("CATEGORY_LABELS[post.category"),
      block![0].indexOf("name: post.title"),
    ];
    assert.ok([homeIdx, blogIdx, catIdx, titleIdx].every((i) => i > -1), "one or more breadcrumb items missing");
    assert.ok(homeIdx < blogIdx && blogIdx < catIdx && catIdx < titleIdx, "breadcrumb items out of order");
  });

  test("the category URL uses the existing /blog?category=X convention, same as app/blog/page.tsx's own canonical", () => {
    assert.match(src, /url: absolute\(`\/blog\?category=\$\{encodeURIComponent\(post\.category\)\}`\)/);
  });

  test("falls back to the raw category value when it isn't a recognised label, never throwing", () => {
    assert.match(
      src,
      /CATEGORY_LABELS\[post\.category as keyof typeof CATEGORY_LABELS\] \?\? post\.category/,
    );
  });
});

group("a visible breadcrumb nav matches the JSON-LD exactly", () => {
  test("renders a <nav aria-label=\"Breadcrumb\"> with the same four-item chain", () => {
    assert.match(src, /<nav aria-label="Breadcrumb" className="text-sm text-fg-dim">/);
    const navBlock = src.slice(src.indexOf('<nav aria-label="Breadcrumb"'), src.indexOf("</nav>"));
    assert.match(navBlock, />\s*Home\s*</);
    assert.match(navBlock, />\s*Blog\s*</);
    assert.match(navBlock, /CATEGORY_LABELS\[post\.category as keyof typeof CATEGORY_LABELS\] \?\? post\.category/);
    assert.match(navBlock, /aria-current="page"/);
  });

  test("the old plain \"Back to the blog\" link is gone — the breadcrumb supersedes it, not duplicates it", () => {
    assert.doesNotMatch(src, /Back to the blog/);
  });

  test("CATEGORY_LABELS is imported from the existing lib/blog re-export, not a new duplicate mapping", () => {
    assert.match(src, /CATEGORY_LABELS,\s*\n\s*selectArticleLayout,/);
  });
});

group("breadcrumb rendering is unaffected by preview mode the same way the rest of the SEO block is", () => {
  test("the visible nav is NOT inside the {!preview && (...)} block — it's ordinary UI, not a public SEO signal, so it should render identically in preview and public", () => {
    const previewBlockEnd = src.indexOf("</>\n      )}", src.indexOf("{!preview && ("));
    const navIndex = src.indexOf('<nav aria-label="Breadcrumb"');
    assert.ok(previewBlockEnd > -1 && navIndex > -1);
    assert.ok(navIndex > previewBlockEnd, "breadcrumb nav should render outside the preview-suppressed block");
  });
});
