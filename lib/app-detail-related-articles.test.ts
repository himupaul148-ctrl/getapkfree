import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against app/app/[slug]/page.tsx — Phase 1
 * Task 4's App -> Blog reverse-lookup UI integration. It can't be imported
 * directly under plain `node --test` (it transitively pulls in
 * lib/catalogue.ts's `next/cache` import, the same constraint documented in
 * lib/app-detail-unpublished-guard.test.ts against this exact file).
 */

const src = readFileSync(
  fileURLToPath(new URL("../app/app/[slug]/page.tsx", import.meta.url)),
  "utf8",
);

function bodyOf(fnName: string): string {
  const match = src.match(new RegExp(`export (?:default )?async function ${fnName}[\\s\\S]*?\\n}`));
  assert.ok(match, `${fnName} not found in app/app/[slug]/page.tsx`);
  return match![0];
}

group("the page fetches related articles via the shared reverse lookup", () => {
  test("imports getBlogPostsForApp from lib/blog, alongside Phase 1 App-Relationship-Layer's getPrimaryBlogPostsForApp", () => {
    assert.match(
      src,
      /import \{ getBlogPostsForApp, getPrimaryBlogPostsForApp \} from "@\/lib\/blog";/,
    );
  });

  test("fetches both in the same Promise.all as versions/related apps — no added waterfall", () => {
    assert.match(
      src,
      /const \[versions, related, primaryArticles, relatedArticlesRaw\] = await Promise\.all\(\[\s*getPublishedVersions\(app\.id\),\s*getRelatedApps\(app\.category, app\.id, 4\),\s*getPrimaryBlogPostsForApp\(app\.id\),\s*getBlogPostsForApp\(app\.id\),\s*\]\);/,
    );
  });

  test("`articles` (the generic related set actually rendered) is relatedArticlesRaw with primary-article ids filtered out, computed once right after the fetch", () => {
    assert.match(
      src,
      /const primaryArticleIds = new Set\(primaryArticles\.map\(\(article\) => article\.id\)\);\s*\n\s*const articles = relatedArticlesRaw\.filter\(\(article\) => !primaryArticleIds\.has\(article\.id\)\);/,
    );
  });

  test("no separate/duplicate call to the bare getBlogPostsForApp exists anywhere else", () => {
    const calls = [...src.matchAll(/(?<!Primary)getBlogPostsForApp\(app\.id\)/g)];
    assert.equal(calls.length, 1, "expected exactly one call to the bare getBlogPostsForApp");
  });

  test("no separate/duplicate call to getPrimaryBlogPostsForApp exists anywhere else", () => {
    const calls = [...src.matchAll(/getPrimaryBlogPostsForApp\(/g)];
    assert.equal(calls.length, 1);
  });
});

group("matching articles are rendered, guarded, and never as an empty state", () => {
  const body = bodyOf("AppDetailPage");

  test("the section is guarded by articles.length > 0 — nothing renders when there are no matches", () => {
    assert.match(body, /\{articles\.length > 0 && \(/);
  });

  test("no placeholder/empty-state copy exists for the zero-match case (no 'No articles', no generic fallback post list)", () => {
    assert.doesNotMatch(body, /No articles/i);
    assert.doesNotMatch(body, /No related articles/i);
  });

  test("renders each matching article's title inside the guarded section", () => {
    const section = body.slice(body.indexOf("{articles.length > 0 && ("));
    assert.match(section, /articles\.map\(\(article\) => \(/);
    assert.match(section, /\{article\.title\}/);
  });
});

group("blog links use the canonical public /blog/{slug} URL, server-rendered", () => {
  const body = bodyOf("AppDetailPage");

  test("links to `/blog/${article.slug}` via next/link's <Link>, not a client-only navigation handler", () => {
    const section = body.slice(body.indexOf("{articles.length > 0 && ("));
    assert.match(section, /<Link\s*\n\s*href=\{`\/blog\/\$\{article\.slug\}`\}/);
  });

  test("no query-parameter URL is used for the relationship (e.g. ?relatedTo=, ?appId=)", () => {
    const section = body.slice(body.indexOf("{articles.length > 0 && ("));
    assert.doesNotMatch(section, /\?relatedTo=/);
    assert.doesNotMatch(section, /\?appId=/);
  });

  test("uses the default next/link import already used throughout this page, not a new navigation mechanism", () => {
    assert.match(src, /^import Link from "next\/link";/m);
  });
});

group("existing app metadata/JSON-LD/content is preserved unchanged", () => {
  test("AppJsonLd (SoftwareApplication) still renders with the same props", () => {
    assert.match(src, /<AppJsonLd app=\{app\} latest=\{latest\} \/>/);
  });

  test("BreadcrumbJsonLd still renders with its existing item list, unchanged", () => {
    assert.match(src, /<BreadcrumbJsonLd/);
    assert.match(src, /\{ name: app\.name, url: absolute\(`\/app\/\$\{app\.slug\}`\) \}/);
  });

  test("no BlogPosting JSON-LD was added to this page", () => {
    assert.doesNotMatch(src, /BlogJsonLd/);
    assert.doesNotMatch(src, /BlogPosting/);
  });

  test("generateMetadata's title/description/canonical construction is untouched", () => {
    const meta = bodyOf("generateMetadata");
    assert.match(meta, /alternates: \{ canonical: url \}/);
    assert.match(meta, /const title = `\$\{app\.name\} APK\$\{version\} — Free Download`;/);
  });

  test("the pre-existing related-apps section (More in {category}) is still present, unchanged, and positioned before the new articles section", () => {
    const relatedIndex = src.indexOf("More in {app.category}");
    const articlesIndex = src.indexOf("Related articles");
    assert.ok(relatedIndex > -1 && articlesIndex > -1);
    assert.ok(relatedIndex < articlesIndex, "expected the related-apps section to remain before the new related-articles section");
  });

  test("the category listicle link, install guide, and version/permissions sections are all still present", () => {
    assert.match(src, /categoryListicle\(app\.category \?\? ""\)/);
    assert.match(src, /Read the install guide/);
    assert.match(src, /<PermissionsList/);
    assert.match(src, /<VersionHistory/);
    assert.match(src, /<ScreenshotGallery/);
  });
});

group("primary App Related articles: their own distinctly-headed section, never merged with generic related articles", () => {
  const body = bodyOf("AppDetailPage");

  test("guarded by primaryArticles.length > 0 — nothing renders when there are no primary matches", () => {
    assert.match(body, /\{primaryArticles\.length > 0 && \(/);
  });

  test("has its own distinct heading, not reusing 'Related articles'", () => {
    const section = body.slice(
      body.indexOf("{primaryArticles.length > 0 && ("),
      body.indexOf("{articles.length > 0 && ("),
    );
    assert.match(section, /Guides &amp; Articles About This App/);
    assert.doesNotMatch(section, />Related articles</);
  });

  test("renders via primaryArticles.map, linking to /blog/{slug} the same way the generic section does", () => {
    const section = body.slice(
      body.indexOf("{primaryArticles.length > 0 && ("),
      body.indexOf("{articles.length > 0 && ("),
    );
    assert.match(section, /primaryArticles\.map\(\(article\) => \(/);
    assert.match(section, /<Link\s*\n\s*href=\{`\/blog\/\$\{article\.slug\}`\}/);
    assert.match(section, /<CategoryBadge category=\{article\.category\} \/>/);
  });

  test("the primary section is positioned before the generic Related articles section", () => {
    const primaryIndex = body.indexOf("{primaryArticles.length > 0 && (");
    const genericIndex = body.indexOf("{articles.length > 0 && (");
    assert.ok(primaryIndex > -1 && genericIndex > -1);
    assert.ok(primaryIndex < genericIndex);
  });

  test("no empty-state copy for the zero-primary-articles case", () => {
    const section = body.slice(
      body.indexOf("{primaryArticles.length > 0 && ("),
      body.indexOf("{articles.length > 0 && ("),
    );
    assert.doesNotMatch(section, /No (guides|articles)/i);
  });
});

group("category label reuses the existing blog component rather than a new one", () => {
  test("imports CategoryBadge from components/blog/BlogCard instead of re-implementing a category label", () => {
    assert.match(src, /import \{ CategoryBadge \} from "@\/components\/blog\/BlogCard";/);
  });
});
