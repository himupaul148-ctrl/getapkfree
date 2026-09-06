/**
 * Pure RSS 2.0 document builder for the public blog feed
 * (app/blog/feed.xml/route.ts). Kept separate from the route handler so it's
 * testable directly under `node --test`, and kept separate from lib/blog.ts
 * so the actual "what counts as published, in what order" query stays in
 * exactly one place — this module never talks to Supabase itself.
 *
 * Relative, extensioned imports rather than the usual "@/..." alias: this
 * file is exercised directly by the plain `node --test` runner (see
 * blog-feed.test.ts), which resolves specifiers itself and has no knowledge
 * of tsconfig's bundler-only path aliases.
 *
 * `BlogSummary` is imported as a type only (erased before execution) —
 * lib/blog.ts itself imports `next/cache` and constructs a real Supabase
 * client at module scope, neither of which plain `node --test` can resolve,
 * so a runtime import of that module would break this file's own tests.
 * `<category>` below uses the raw category value rather than
 * lib/blog.ts's CATEGORY_LABELS for the same reason — valid RSS either way.
 */
import { SITE_NAME, absolute } from "./seo.ts";
import type { BlogSummary } from "./blog.ts";

/** A blog feed with hundreds of entries serves no reader — cap it like any other "recent items" list. */
export const FEED_LIMIT = 30;

const FEED_TITLE = `${SITE_NAME} Blog`;
const FEED_DESCRIPTION =
  "Guides, tips and app recommendations from the GetApkFree team.";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RSS 2.0 dates are RFC 822. */
function toRfc822(dateIso: string): string {
  return new Date(dateIso).toUTCString();
}

function itemXml(post: BlogSummary): string {
  const url = absolute(`/blog/${post.slug}`);
  const media = post.featured_image_url
    ? `\n      <media:content url="${escapeXml(post.featured_image_url)}" medium="image" />`
    : "";

  return `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <description>${escapeXml(post.excerptText)}</description>
      <pubDate>${toRfc822(post.created_at)}</pubDate>
      <dc:creator>${escapeXml(post.author)}</dc:creator>
      <category>${escapeXml(post.category)}</category>${media}
    </item>`;
}

/**
 * Builds the full RSS document. Filters to `published` and sorts newest
 * first itself — belt-and-braces on top of `getPublishedPosts()`'s own
 * filtering/ordering, the same "RLS plus an explicit filter" redundancy
 * lib/catalogue.ts already applies to versions — rather than trusting the
 * caller passed the right slice in the right order.
 */
export function buildBlogRssFeed(posts: BlogSummary[]): string {
  const eligible = posts
    .filter((post) => post.published)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, FEED_LIMIT);

  const feedUrl = absolute("/blog/feed.xml");
  const blogUrl = absolute("/blog");
  const lastBuildDate = eligible[0]
    ? toRfc822(eligible[0].created_at)
    : new Date().toUTCString();

  const items = eligible.map(itemXml).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(FEED_TITLE)}</title>
    <link>${escapeXml(blogUrl)}</link>
    <description>${escapeXml(FEED_DESCRIPTION)}</description>
    <language>en</language>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <lastBuildDate>${lastBuildDate}</lastBuildDate>${items}
  </channel>
</rss>
`;
}
