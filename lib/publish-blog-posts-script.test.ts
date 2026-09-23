import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { parseFrontmatter, toPayload } from "../scripts/publish-blog-posts.mjs";

/**
 * Behavioral tests for scripts/publish-blog-posts.mjs — pure, dependency-free
 * (no next/cache, no next/server, no Supabase), so it loads directly under
 * plain `node --test`.
 *
 * Covers toPayload()'s related_app_ids behavior specifically: frontmatter
 * that omits the field must produce a payload with the key entirely absent
 * (not `related_app_ids: []`), so app/api/admin/blog/publish/route.ts can
 * tell "this post never mentioned related apps" apart from "this post
 * explicitly clears them" and never wipe out a value curated by hand
 * through the admin editor on a routine content republish.
 */

const MIN_POST = [
  "---",
  'title: "A Title"',
  'slug: "a-slug"',
  'description: "A description"',
  'category: "guides"',
  "---",
  "",
  Array(60).fill("word").join(" "), // clears the 500-word minimum elsewhere; irrelevant here since toPayload doesn't itself enforce that
].join("\n");

function withFrontmatterLine(line: string | null): string {
  const lines = MIN_POST.split("\n");
  if (line === null) return MIN_POST; // no related_app_ids line at all
  lines.splice(lines.indexOf("---", 1), 0, line);
  return lines.join("\n");
}

group("toPayload — related_app_ids omitted from frontmatter", () => {
  test("the returned payload has no related_app_ids key at all", () => {
    const parsed = parseFrontmatter(withFrontmatterLine(null), "post.md");
    const payload = toPayload(parsed, "post.md");
    assert.equal("related_app_ids" in payload, false);
  });
});

group("toPayload — related_app_ids explicitly set in frontmatter", () => {
  test("a non-empty list is sent through unchanged, in order", () => {
    const src = withFrontmatterLine(
      'related_app_ids: ["561cc462-86f1-44bd-a834-fa202c764dbe", "f3bf1a8d-8b7c-4531-ba5c-1ffa61eb8db8"]',
    );
    const payload = toPayload(parseFrontmatter(src, "post.md"), "post.md");
    assert.deepEqual(payload.related_app_ids, [
      "561cc462-86f1-44bd-a834-fa202c764dbe",
      "f3bf1a8d-8b7c-4531-ba5c-1ffa61eb8db8",
    ]);
  });

  test("an explicit empty list [] is still sent (present as a key), not omitted", () => {
    const src = withFrontmatterLine("related_app_ids: []");
    const payload = toPayload(parseFrontmatter(src, "post.md"), "post.md");
    assert.equal("related_app_ids" in payload, true);
    assert.deepEqual(payload.related_app_ids, []);
  });
});

group("toPayload — related_app_ids validation is unchanged", () => {
  test("a non-array value still fails parsing/validation with a clear message", () => {
    const src = withFrontmatterLine('related_app_ids: "not-a-list"');
    assert.throws(
      () => toPayload(parseFrontmatter(src, "post.md"), "post.md"),
      /related_app_ids must be a list/,
    );
  });
});

group("toPayload — everything else about the payload is unaffected", () => {
  test("title, slug, description, category, content, author, featured_image_url, published are all still present and correct", () => {
    const payload = toPayload(parseFrontmatter(withFrontmatterLine(null), "post.md"), "post.md");
    assert.equal(payload.title, "A Title");
    assert.equal(payload.slug, "a-slug");
    assert.equal(payload.description, "A description");
    assert.equal(payload.category, "guides");
    assert.equal(payload.author, "GetApkFree Team");
    assert.equal(payload.featured_image_url, null);
    assert.equal(payload.published, true);
  });
});

group("toPayload — article_type/target_app_id omitted from frontmatter", () => {
  test("the returned payload has neither key at all — the API defaults article_type to general and leaves target_app_id untouched on an update", () => {
    const payload = toPayload(parseFrontmatter(withFrontmatterLine(null), "post.md"), "post.md");
    assert.equal("article_type" in payload, false);
    assert.equal("target_app_id" in payload, false);
  });
});

group("toPayload — article_type explicitly set in frontmatter", () => {
  test("general is parsed and forwarded", () => {
    const src = withFrontmatterLine('article_type: "general"');
    const payload = toPayload(parseFrontmatter(src, "post.md"), "post.md");
    assert.equal(payload.article_type, "general");
  });

  test("review_other is parsed and forwarded without requiring a target_app_id", () => {
    const src = withFrontmatterLine('article_type: "review_other"');
    const payload = toPayload(parseFrontmatter(src, "post.md"), "post.md");
    assert.equal(payload.article_type, "review_other");
    assert.equal("target_app_id" in payload, false);
  });

  test("app_related with a target_app_id is parsed and both reach the payload", () => {
    const lines = withFrontmatterLine('article_type: "app_related"').split("\n");
    lines.splice(
      lines.indexOf("---", 1),
      0,
      'target_app_id: "561cc462-86f1-44bd-a834-fa202c764dbe"',
    );
    const payload = toPayload(parseFrontmatter(lines.join("\n"), "post.md"), "post.md");
    assert.equal(payload.article_type, "app_related");
    assert.equal(payload.target_app_id, "561cc462-86f1-44bd-a834-fa202c764dbe");
  });

  test("an unrecognised article_type fails parsing with a clear message, before ever reaching the API", () => {
    const src = withFrontmatterLine('article_type: "sponsored"');
    assert.throws(
      () => toPayload(parseFrontmatter(src, "post.md"), "post.md"),
      /article_type "sponsored" is not one of/,
    );
  });

  test("app_related without a target_app_id fails parsing locally, matching the API's own rule", () => {
    const src = withFrontmatterLine('article_type: "app_related"');
    assert.throws(
      () => toPayload(parseFrontmatter(src, "post.md"), "post.md"),
      /target_app_id is required when article_type is app_related/,
    );
  });
});
