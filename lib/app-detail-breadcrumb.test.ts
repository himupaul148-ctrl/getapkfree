import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the technical-SEO/GEO foundation
 * task's one confirmed gap: the app detail page had a BreadcrumbList JSON-LD
 * (Home / Category / App name) but no matching visible breadcrumb trail —
 * only a plain "← Back to catalogue" link — the exact parallel gap already
 * fixed for blog articles (lib/blog-article-breadcrumb.test.ts). Same
 * *.tsx import-time constraint as every other page test in this project.
 */

const src = readFileSync(
  fileURLToPath(new URL("../app/app/[slug]/page.tsx", import.meta.url)),
  "utf8",
);

group("visible breadcrumb nav mirrors the existing BreadcrumbJsonLd exactly", () => {
  test("renders a <nav aria-label=\"Breadcrumb\"> after BreadcrumbJsonLd, same pattern as the homepage's category breadcrumb and the blog article page", () => {
    assert.match(src, /<nav aria-label="Breadcrumb" className="text-sm text-fg-dim">/);
  });

  test("Home links to \"/\", App category links to the same /?category=X URL BreadcrumbJsonLd already uses, guarded by the same app.category truthiness check", () => {
    const navBlock = src.slice(src.indexOf('<nav aria-label="Breadcrumb"'), src.indexOf("</nav>"));
    assert.match(navBlock, /href="\/"/);
    assert.match(navBlock, /\{app\.category && \(/);
    assert.match(navBlock, /href=\{`\/\?category=\$\{encodeURIComponent\(app\.category\)\}`\}/);
    assert.match(navBlock, /\{app\.category\}/);
  });

  test("the current page (app name) is the final, non-link item with aria-current", () => {
    const navBlock = src.slice(src.indexOf('<nav aria-label="Breadcrumb"'), src.indexOf("</nav>"));
    assert.match(navBlock, /aria-current="page"[^>]*>\s*\n\s*\{app\.name\}/);
  });

  test("the old plain \"catalogue\" back-link text is gone — the breadcrumb supersedes it", () => {
    assert.doesNotMatch(src, /catalogue<\/Link>/);
  });

  test("the JSON-LD's own item structure (Home, conditional category, app name) is untouched — only the visible nav was added", () => {
    const jsonLdBlock = src.match(/<BreadcrumbJsonLd\s*\n\s*items=\{\[[\s\S]*?\]\}\s*\n\s*\/>/);
    assert.ok(jsonLdBlock, "BreadcrumbJsonLd call not found");
    assert.match(jsonLdBlock![0], /name: "Home"/);
    assert.match(jsonLdBlock![0], /name: app\.category/);
    assert.match(jsonLdBlock![0], /name: app\.name/);
  });
});
