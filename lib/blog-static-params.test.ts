import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against lib/blog.ts's getPublishedSlugs()
 * and app/blog/[slug]/page.tsx's generateStaticParams() — Phase 1 Task C3's
 * cap on how many blog posts are pre-rendered at build time. lib/blog.ts
 * imports `unstable_cache` from "next/cache" and constructs a real Supabase
 * client at module scope; app/blog/[slug]/page.tsx is JSX-bearing — neither
 * is importable under plain `node --test`, the same constraint documented
 * throughout this project (see lib/blog-error-handling.test.ts for the
 * pre-existing tests this file's changes intentionally affect).
 */

const blogSrc = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");
const pageSrc = readFileSync(
  fileURLToPath(new URL("../app/blog/[slug]/page.tsx", import.meta.url)),
  "utf8",
);

function bodyOf(fnName: string): string {
  const match = blogSrc.match(
    new RegExp(`export async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("generateStaticParams is bounded", () => {
  test("BLOG_STATIC_PARAMS_LIMIT is a clearly named, exported constant — matching getPopularSlugs(50)'s own cap on the app detail route", () => {
    assert.match(blogSrc, /export const BLOG_STATIC_PARAMS_LIMIT = 50;/);
  });

  test("getPublishedSlugs() applies .limit(limit), defaulting to BLOG_STATIC_PARAMS_LIMIT — no unbounded query remains", () => {
    const body = bodyOf("getPublishedSlugs");
    assert.match(
      body,
      /export async function getPublishedSlugs\(\s*\n\s*limit = BLOG_STATIC_PARAMS_LIMIT,\s*\n\s*\): Promise<string\[\]>/,
    );
    assert.match(body, /\.limit\(limit\)/);
  });

  test("generateStaticParams passes BLOG_STATIC_PARAMS_LIMIT explicitly at the call site, making the cap visible there too, not hidden behind a default alone", () => {
    assert.match(
      pageSrc,
      /const slugs = await getPublishedSlugs\(BLOG_STATIC_PARAMS_LIMIT\);/,
    );
    assert.match(
      pageSrc,
      /import \{\s*\n\s*BLOG_STATIC_PARAMS_LIMIT,\s*\n\s*getAdjacentPosts,/,
    );
  });
});

group("existing published-post filtering behavior remains intact", () => {
  const body = bodyOf("getPublishedSlugs");

  test("still filters .eq(\"published\", true) — drafts are never included in the prerendered set", () => {
    assert.match(body, /\.eq\("published", true\)/);
  });

  test("still selects only \"slug\" — no wider column set was introduced", () => {
    assert.match(body, /\.select\("slug"\)/);
  });

  test("still surfaces a genuine Supabase error via resolveQueryResult rather than discarding it", () => {
    assert.match(body, /resolveQueryResult\(data, error, "getPublishedSlugs: Supabase query failed"\) \?\? \[\]/);
  });
});

group("generated params still have the expected { slug } shape", () => {
  test("generateStaticParams still maps each slug to { slug }, unchanged", () => {
    assert.match(pageSrc, /return slugs\.map\(\(slug\) => \(\{ slug \}\)\);/);
  });

  test("getPublishedSlugs still returns a flat string[] (rows.map((row) => row.slug)), not a richer object", () => {
    const body = bodyOf("getPublishedSlugs");
    assert.match(body, /return rows\.map\(\(row\) => row\.slug\);/);
  });
});

group("the cap is deterministic", () => {
  const body = bodyOf("getPublishedSlugs");

  test("orders by created_at descending before limiting — the same default ordering convention every other listing query in this file uses", () => {
    assert.match(body, /\.order\("created_at", \{ ascending: false \}\)/);
  });

  test("has a secondary id-descending tiebreaker, so which slugs fall inside/outside the cap cannot vary between builds when multiple posts share a created_at", () => {
    assert.match(
      body,
      /\.order\("created_at", \{ ascending: false \}\)\s*\n\s*\.order\("id", \{ ascending: false \}\)\s*\n\s*\.limit\(limit\)/,
    );
  });

  test("no random/unordered selection mechanism was introduced (no Math.random, no unordered .limit())", () => {
    assert.doesNotMatch(body, /Math\.random/);
  });
});

group("posts outside the pre-generated set are still reachable at runtime via ISR", () => {
  test("the route has no dynamicParams = false — Next's default (true) lets an uncapped slug render on first request", () => {
    assert.doesNotMatch(pageSrc, /dynamicParams\s*=\s*false/);
  });

  test("export const revalidate = 3600 is still present — the same ISR window that already caches an on-demand render, unchanged by this task", () => {
    assert.match(pageSrc, /export const revalidate = 3600;/);
  });

  test("notFound() is still reached only through getPostBySlug's own published/slug lookup, not gated by whether the slug was in generateStaticParams' list", () => {
    assert.match(pageSrc, /const post = await getPostBySlug\(slug\);\s*\n\s*if \(!post\) notFound\(\);/);
  });
});

group("no unrelated blog page behavior was touched", () => {
  test("generateMetadata, canonical, Open Graph/Twitter, and the page body are all still present and unchanged in shape", () => {
    assert.match(pageSrc, /export async function generateMetadata\(/);
    assert.match(pageSrc, /alternates: \{\s*\n\s*canonical: url,/);
    assert.match(pageSrc, /openGraph: \{/);
    assert.match(pageSrc, /twitter: \{/);
    // getRelatedApps/getAdjacentPosts are unchanged; Phase 5's three-type
    // blog system added a third, independent, conditional fetch (targetApp)
    // to the same Promise.all, and the three-distinct-layouts task later
    // added a fourth (relatedArticles) — see
    // lib/blog-article-view-target-app.test.ts for both fetches' own
    // coverage.
    assert.match(
      pageSrc,
      /const \[\{ apps, fallback \}, \{ previous, next \}, targetApp, relatedArticles\] = await Promise\.all\(\[\s*\n\s*getRelatedApps\(post\.related_app_ids \?\? \[\], 6\),\s*\n\s*getAdjacentPosts\(post\),/,
    );
  });

  test("BlogArticleView still receives its original props unchanged — no structured-data/related-apps/adjacent-posts wiring changed (targetApp/relatedArticles, added later by Phase 5/the three-distinct-layouts task, are checked separately in lib/blog-article-view-target-app.test.ts)", () => {
    assert.match(
      pageSrc,
      /<BlogArticleView\s*\n\s*post=\{post\}\s*\n\s*apps=\{apps\}\s*\n\s*fallback=\{fallback\}\s*\n\s*previous=\{previous\}\s*\n\s*next=\{next\}\s*\n\s*targetApp=\{targetApp\}\s*\n\s*relatedArticles=\{relatedArticles\}\s*\n\s*\/>/,
    );
  });

  test("getPublishedPosts, getPublishedPostsPaged, and getPublishedPostsForSitemap are untouched by this change — this task only modified getPublishedSlugs", () => {
    assert.doesNotMatch(pageSrc, /getPublishedPosts\b/);
    const sitemapSrc = readFileSync(fileURLToPath(new URL("../app/sitemap.ts", import.meta.url)), "utf8");
    assert.match(sitemapSrc, /getPublishedPostsForSitemap/);
  });
});
