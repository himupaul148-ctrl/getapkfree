import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against app/sitemap.ts — a metadata-route
 * file this project's plain `node --test` runner can't import directly (it
 * transitively imports `unstable_cache` from "next/cache" via lib/blog.ts
 * and lib/catalogue.ts, the same constraint documented throughout this
 * project). Covers the fix for the real production bug where
 * https://getapkfree.com/sitemap.xml rendered zero /blog/<slug> URLs while
 * /blog and /blog/feed.xml showed every published post correctly — root
 * cause was a stale unstable_cache entry behind getPublishedPosts(), read
 * from a route that already re-renders on every request. The count/parity
 * assertions this file structurally can't make (blog URL count vs. real
 * published-post count, the new article's presence) are verified directly
 * against production in this change's rollout, not here.
 */

const src = readFileSync(fileURLToPath(new URL("../../app/sitemap.ts", import.meta.url)), "utf8");

group("app/sitemap.ts — blog posts are sourced from the sitemap-safe, uncached helper", () => {
  test("imports getPublishedPostsForSitemap from lib/blog, not the cached getPublishedPosts", () => {
    assert.match(
      src,
      /import\s*\{\s*getPublishedPostsForSitemap,\s*type SitemapBlogPost\s*\}\s*from\s*"@\/lib\/blog"/,
    );
    assert.doesNotMatch(src, /getPublishedPosts\(\)/);
    assert.doesNotMatch(src, /\bgetPublishedPosts\b(?!ForSitemap)/);
  });

  test("sitemap() calls loadBlogPostsForSitemap() exactly once, not in a loop", () => {
    const calls = [...src.matchAll(/loadBlogPostsForSitemap\(\)/g)];
    // One definition-site reference (inside loadBlogPostsForSitemap's own
    // try block) plus exactly one call from sitemap() itself.
    assert.equal(calls.length, 2, "expected exactly one call from sitemap() plus its own definition");
  });
});

group("app/sitemap.ts — a blog-query failure is caught and logged, never left to crash the whole sitemap", () => {
  test("loadBlogPostsForSitemap wraps the call in try/catch", () => {
    assert.match(
      src,
      /async function loadBlogPostsForSitemap\(\)[\s\S]*?try \{[\s\S]*?getPublishedPostsForSitemap\(\)[\s\S]*?\} catch \(caught\) \{[\s\S]*?console\.error\([\s\S]*?return \[\];[\s\S]*?\n\}/,
    );
  });

  test("the helper is invoked exactly once as a real call, not merely mentioned in comments", () => {
    const realCalls = [...src.matchAll(/getPublishedPostsForSitemap\(\);/g)];
    assert.equal(realCalls.length, 1);
  });
});

group("app/sitemap.ts — blog URL shape and metadata are preserved", () => {
  test("blogPages still maps to /blog/<slug>, monthly, with lastModified from updated_at", () => {
    const block = src.match(/const blogPages: MetadataRoute\.Sitemap = posts\.map\([\s\S]*?\n {2}\}\)\);/);
    assert.ok(block, "blogPages mapping not found");
    assert.match(block![0], /url: absolute\(`\/blog\/\$\{post\.slug\}`\)/);
    assert.match(block![0], /lastModified: new Date\(post\.updated_at\)/);
    assert.match(block![0], /changeFrequency: "monthly"/);
  });
});

group("app/sitemap.ts — everything else is unchanged", () => {
  test("still force-dynamic (no response-level caching reintroduced)", () => {
    assert.match(src, /export const dynamic = "force-dynamic";/);
  });

  test("getCatalogue() (apps) is still called, unmodified", () => {
    assert.match(src, /import \{ getCatalogue \} from "@\/lib\/catalogue";/);
    assert.match(src, /getCatalogue\(\)/);
  });

  test("all 9 static pages are still present, unchanged", () => {
    for (const path of [
      'absolute("/")',
      'absolute("/apps")',
      'absolute("/how-to-install")',
      'absolute("/blog")',
      'absolute("/about")',
      'absolute("/privacy")',
      'absolute("/terms")',
      'absolute("/dmca")',
      'absolute("/contact")',
    ]) {
      assert.ok(src.includes(path), `missing static page entry: ${path}`);
    }
  });

  test("category pages still come from CATEGORIES, unchanged", () => {
    assert.match(src, /import \{ CATEGORIES \} from "@\/lib\/types";/);
    assert.match(
      src,
      /const categoryPages: MetadataRoute\.Sitemap = CATEGORIES\.map\(/,
    );
  });

  test("appPages still filters on latestVersion !== null, unchanged", () => {
    assert.match(src, /\.filter\(\(app\) => app\.latestVersion !== null\)/);
  });

  test("the final return still spreads all four sections in the original order", () => {
    assert.match(
      src,
      /return \[\.\.\.staticPages, \.\.\.categoryPages, \.\.\.blogPages, \.\.\.appPages\];/,
    );
  });
});

group("unaffected call sites keep using the cached getPublishedPosts", () => {
  test("/blog page still uses getPublishedPosts, not the sitemap-only helper", () => {
    const pageSrc = readFileSync(
      fileURLToPath(new URL("../../app/blog/page.tsx", import.meta.url)),
      "utf8",
    );
    assert.match(pageSrc, /getPublishedPosts/);
    assert.doesNotMatch(pageSrc, /getPublishedPostsForSitemap/);
  });

  test("/blog/feed.xml uses the bounded getRecentPosts, not the sitemap-only helper", () => {
    const feedSrc = readFileSync(
      fileURLToPath(new URL("../../app/blog/feed.xml/route.ts", import.meta.url)),
      "utf8",
    );
    assert.match(feedSrc, /const posts = await getRecentPosts\(FEED_LIMIT\);/);
    assert.doesNotMatch(feedSrc, /getPublishedPostsForSitemap/);
  });

  test("the publish route's revalidateTag('blog', 'max') call is untouched — this fix doesn't depend on it", () => {
    const publishSrc = readFileSync(
      fileURLToPath(new URL("../../app/api/admin/blog/publish/route.ts", import.meta.url)),
      "utf8",
    );
    assert.match(publishSrc, /revalidateTag\('blog', 'max'\);/);
  });
});
