import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { buildBlogRssFeed, FEED_LIMIT } from "./blog-feed.ts";
import type { BlogSummary } from "./blog.ts";

/**
 * Run with: npm test
 *
 * lib/blog.ts itself can't be imported at runtime here (it pulls in
 * next/cache and a real Supabase client at module scope), so these fixtures
 * are plain object literals shaped like BlogSummary rather than anything
 * constructed via the real blog data layer — `buildBlogRssFeed` doesn't
 * care where its input came from, only that it's shaped right.
 */

function post(overrides: Partial<BlogSummary> = {}): BlogSummary {
  return {
    id: "id-1",
    slug: "example-post",
    title: "Example Post",
    description: "An example description.",
    author: "GetApkFree Team",
    category: "guides",
    related_app_ids: [],
    published: true,
    view_count: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    featured_image_url: null,
    excerptText: "An example excerpt.",
    readMinutes: 3,
    ...overrides,
  };
}

group("buildBlogRssFeed — content", () => {
  test("published posts appear, with title/link/description/date/author/category", () => {
    const xml = buildBlogRssFeed([post({ slug: "my-post", title: "My Post" })]);

    assert.match(xml, /<title>My Post<\/title>/);
    assert.match(xml, /<link>https:\/\/[^<]*\/blog\/my-post<\/link>/);
    assert.match(xml, /<description>An example excerpt\.<\/description>/);
    assert.match(xml, /<pubDate>[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4}/);
    assert.match(xml, /<dc:creator>GetApkFree Team<\/dc:creator>/);
    assert.match(xml, /<category>guides<\/category>/);
  });

  test("draft/unpublished posts do not appear, even if handed in", () => {
    const xml = buildBlogRssFeed([
      post({ slug: "live-post", title: "Live Post", published: true }),
      post({ slug: "draft-post", title: "Draft Post", published: false }),
    ]);

    assert.match(xml, /Live Post/);
    assert.doesNotMatch(xml, /Draft Post/);
    assert.doesNotMatch(xml, /draft-post/);
  });

  test("posts are ordered newest first, regardless of input order", () => {
    const xml = buildBlogRssFeed([
      post({ slug: "oldest", title: "Oldest", created_at: "2026-01-01T00:00:00.000Z" }),
      post({ slug: "newest", title: "Newest", created_at: "2026-03-01T00:00:00.000Z" }),
      post({ slug: "middle", title: "Middle", created_at: "2026-02-01T00:00:00.000Z" }),
    ]);

    const newestIndex = xml.indexOf("Newest");
    const middleIndex = xml.indexOf("Middle");
    const oldestIndex = xml.indexOf("Oldest");

    assert.ok(newestIndex > -1 && middleIndex > -1 && oldestIndex > -1);
    assert.ok(newestIndex < middleIndex, "newest must come before middle");
    assert.ok(middleIndex < oldestIndex, "middle must come before oldest");
  });

  test("caps the feed at FEED_LIMIT items", () => {
    const many = Array.from({ length: FEED_LIMIT + 10 }, (_, i) =>
      post({
        slug: `post-${i}`,
        title: `Post ${i}`,
        created_at: new Date(2026, 0, i + 1).toISOString(),
      }),
    );

    const xml = buildBlogRssFeed(many);
    const itemCount = (xml.match(/<item>/g) ?? []).length;
    assert.equal(itemCount, FEED_LIMIT);
  });

  test("includes a media:content element when a featured image exists", () => {
    const xml = buildBlogRssFeed([
      post({ featured_image_url: "https://example.com/cover.png" }),
    ]);
    assert.match(xml, /<media:content url="https:\/\/example\.com\/cover\.png" medium="image" \/>/);
  });

  test("omits media:content when there is no featured image", () => {
    const xml = buildBlogRssFeed([post({ featured_image_url: null })]);
    assert.doesNotMatch(xml, /media:content/);
  });
});

group("buildBlogRssFeed — XML escaping", () => {
  test("escapes special characters in the title rather than leaving them raw", () => {
    const xml = buildBlogRssFeed([
      post({ title: `Tips & Tricks <for> "Android" & 'Apps'` }),
    ]);

    assert.match(
      xml,
      /<title>Tips &amp; Tricks &lt;for&gt; &quot;Android&quot; &amp; &apos;Apps&apos;<\/title>/,
    );
    assert.doesNotMatch(xml, /<title>Tips & Tricks/);
  });

  test("escapes a title that looks like it is trying to close the tag early", () => {
    const xml = buildBlogRssFeed([
      post({ title: `</title><script>alert(1)</script>` }),
    ]);
    assert.doesNotMatch(xml, /<script>/);
    assert.match(xml, /&lt;script&gt;/);
  });

  test("escapes the excerpt and author fields too", () => {
    const xml = buildBlogRssFeed([
      post({ excerptText: `A & B`, author: `Me & "You"` }),
    ]);
    assert.match(xml, /<description>A &amp; B<\/description>/);
    assert.match(xml, /<dc:creator>Me &amp; &quot;You&quot;<\/dc:creator>/);
  });
});

group("buildBlogRssFeed — required channel metadata", () => {
  test("includes title, link, description, language and a self-referencing atom:link", () => {
    const xml = buildBlogRssFeed([post()]);

    assert.match(xml, /<rss version="2\.0"[^>]*>/);
    assert.match(xml, /<channel>/);
    assert.match(xml, /<title>GetApkFree Blog<\/title>/);
    assert.match(xml, /<link>https:\/\/[^<]*\/blog<\/link>/);
    assert.match(xml, /<description>Guides, tips and app recommendations/);
    assert.match(xml, /<language>en<\/language>/);
    assert.match(
      xml,
      /<atom:link href="https:\/\/[^"]*\/blog\/feed\.xml" rel="self" type="application\/rss\+xml" \/>/,
    );
    assert.match(xml, /<lastBuildDate>/);
    assert.match(xml, /<\/rss>/);
  });

  test("still emits valid channel metadata with zero posts", () => {
    const xml = buildBlogRssFeed([]);
    assert.match(xml, /<channel>/);
    assert.match(xml, /<\/channel>/);
    assert.doesNotMatch(xml, /<item>/);
  });
});
