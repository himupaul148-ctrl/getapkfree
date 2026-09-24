import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for getRecentPosts() — the bounded
 * replacement for getPublishedPosts() at the two call sites that only ever
 * needed a small, recent slice (the homepage teaser and the RSS feed), not
 * every published post's full content. Same import-time constraint as every
 * other lib/blog.ts test in this project (next/cache, a real Supabase client
 * at module scope).
 */

const blogSrc = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");
const homeSrc = readFileSync(
  fileURLToPath(new URL("../components/HomeSections.tsx", import.meta.url)),
  "utf8",
);
const feedRouteSrc = readFileSync(
  fileURLToPath(new URL("../app/blog/feed.xml/route.ts", import.meta.url)),
  "utf8",
);

function bodyOf(fnName: string): string {
  const match = blogSrc.match(
    new RegExp(`async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("getRecentPosts is bounded at the database, not fetched-then-sliced", () => {
  test("is exported, wrapped in unstable_cache, tagged 'blog' like getPublishedPosts", () => {
    assert.match(
      blogSrc,
      /export const getRecentPosts = unstable_cache\(\s*\n\s*fetchRecent,\s*\n\s*\["blog-recent-posts"\],\s*\n\s*\{ revalidate: 3600, tags: \["blog"\] \},\s*\n\s*\);/,
    );
  });

  test("fetchRecent applies .limit(limit + RETIRED_SLUGS.length) at the database — never fetches every published post", () => {
    const body = bodyOf("fetchRecent");
    assert.match(body, /\.limit\(limit \+ RETIRED_SLUGS\.length\)/);
  });

  test("still filters published-only and orders newest-first with an id tiebreaker, same convention as the rest of this file", () => {
    const body = bodyOf("fetchRecent");
    assert.match(body, /\.eq\("published", true\)/);
    assert.match(body, /\.order\("created_at", \{ ascending: false \}\)\s*\n\s*\.order\("id", \{ ascending: false \}\)/);
  });

  test("still excludes retired slugs and slices to the exact requested limit after the buffer", () => {
    const body = bodyOf("fetchRecent");
    assert.match(body, /\.filter\(\(post\) => !RETIRED_SLUGS\.includes\(post\.slug\)\)\s*\n\s*\.slice\(0, limit\)/);
  });

  test("derives excerptText/readMinutes the same way fetchPublished does — no divergent transform", () => {
    const body = bodyOf("fetchRecent");
    assert.match(body, /excerptText: rest\.description \|\| excerpt\(content\)/);
    assert.match(body, /readMinutes: readingTime\(content\)/);
  });
});

group("HomeSections.tsx uses getRecentPosts instead of the unbounded getPublishedPosts", () => {
  test("imports getRecentPosts and HOME_RECENT_POSTS_LIMIT from lib/blog", () => {
    assert.match(
      homeSrc,
      /import \{ getRecentPosts, HOME_RECENT_POSTS_LIMIT, getPostsBySlugs \} from "@\/lib\/blog";/,
    );
    assert.doesNotMatch(homeSrc, /getPublishedPosts\(\)/);
  });

  test("calls getRecentPosts(HOME_RECENT_POSTS_LIMIT).catch(() => []) inside the same Promise.all as before — no added waterfall", () => {
    assert.match(
      homeSrc,
      /getRecentPosts\(HOME_RECENT_POSTS_LIMIT\)\.catch\(\(\) => \[\]\)/,
    );
  });

  test("no leftover in-memory .slice(0, 3) — the bound now lives in the query itself", () => {
    assert.doesNotMatch(homeSrc, /\.slice\(0, 3\)/);
  });
});

group("app/blog/feed.xml/route.ts uses getRecentPosts(FEED_LIMIT) instead of the unbounded getPublishedPosts", () => {
  test("imports getRecentPosts from lib/blog and FEED_LIMIT from lib/blog-feed", () => {
    assert.match(feedRouteSrc, /import \{ getRecentPosts \} from "@\/lib\/blog";/);
    assert.match(feedRouteSrc, /import \{ buildBlogRssFeed, FEED_LIMIT \} from "@\/lib\/blog-feed";/);
  });

  test("calls getRecentPosts(FEED_LIMIT), never the unbounded getPublishedPosts()", () => {
    assert.match(feedRouteSrc, /const posts = await getRecentPosts\(FEED_LIMIT\);/);
    assert.doesNotMatch(feedRouteSrc, /getPublishedPosts\(\)/);
  });

  test("buildBlogRssFeed's own FEED_LIMIT slice is untouched — this is a belt-and-braces safety net, not now redundant to remove", () => {
    const feedLibSrc = readFileSync(
      fileURLToPath(new URL("./blog-feed.ts", import.meta.url)),
      "utf8",
    );
    assert.match(feedLibSrc, /\.slice\(0, FEED_LIMIT\)/);
  });
});

group("getPublishedPosts itself is untouched — still the general, unbounded, cached helper", () => {
  test("export const getPublishedPosts = unstable_cache(fetchPublished, ...) still present, unchanged shape", () => {
    assert.match(blogSrc, /export const getPublishedPosts = unstable_cache\(\s*\n\s*fetchPublished,\s*\n\s*\["blog-posts"\],/);
  });

  test("fetchPublished itself still has no .limit() — this task narrowed its two callers, not the general helper", () => {
    const body = bodyOf("fetchPublished");
    assert.doesNotMatch(body, /\.limit\(/);
  });
});
