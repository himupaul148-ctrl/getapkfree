import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { buildInsertRow, buildUpdateRow, type BlogPostFields } from "./blog-editor-fields.ts";

/**
 * Covers the featured-image lost-update fix: BlogEditor's save() must never
 * let a stale editor session's local `image` state overwrite a
 * featured_image_url that a different session, or the image-upload endpoint
 * itself, already wrote — by never mentioning the column in its update
 * payload unless *this* session's uploader actually touched it.
 */

function fields(overrides: Partial<BlogPostFields> = {}): BlogPostFields {
  return {
    slug: "example-post",
    title: "Example Post",
    description: "An example post.",
    content: "Body text.",
    author: "GetApkFree Team",
    category: "guides",
    relatedAppIds: [],
    published: true,
    ...overrides,
  };
}

group("buildUpdateRow", () => {
  test("A/E. untouched image: featured_image_url is not a key on the row at all", () => {
    const row = buildUpdateRow(fields(), "https://example.com/existing.webp", false);
    assert.equal("featured_image_url" in row, false);
  });

  test("A/E. untouched image: every other field is still present and correct", () => {
    const row = buildUpdateRow(
      fields({ title: "A Different Title" }),
      "https://example.com/existing.webp",
      false,
    );
    assert.equal(row.title, "A Different Title");
    assert.equal(row.slug, "example-post");
    assert.equal(row.published, true);
  });

  test("B. touched image (a fresh upload): featured_image_url is the new URL", () => {
    const row = buildUpdateRow(fields(), "https://example.com/new.webp", true);
    assert.equal(row.featured_image_url, "https://example.com/new.webp");
  });

  test("C. upload A then upload B, both touching the session: final payload has B, not A", () => {
    // Mirrors BlogEditor's onImageChange being called twice in a row — each
    // call's result simply becomes the new `image` value, so whichever call
    // happened last is what a subsequent save sees. Modelled here as two
    // sequential buildUpdateRow calls with the state each upload would have
    // left behind.
    const afterUploadA = buildUpdateRow(fields(), "https://example.com/a.webp", true);
    assert.equal(afterUploadA.featured_image_url, "https://example.com/a.webp");

    const afterUploadB = buildUpdateRow(fields(), "https://example.com/b.webp", true);
    assert.equal(afterUploadB.featured_image_url, "https://example.com/b.webp");
    assert.notEqual(afterUploadB.featured_image_url, afterUploadA.featured_image_url);
  });

  test("D. explicit removal (touched, empty string): featured_image_url is null, not omitted", () => {
    const row = buildUpdateRow(fields(), "", true);
    assert.equal("featured_image_url" in row, true);
    assert.equal(row.featured_image_url, null);
  });

  test("D. removal is not confused with 'untouched' — the key must be present as null", () => {
    const row = buildUpdateRow(fields(), "", true);
    assert.notEqual(row.featured_image_url, undefined);
  });

  test("whitespace-only image is treated the same as empty when touched", () => {
    const row = buildUpdateRow(fields(), "   ", true);
    assert.equal(row.featured_image_url, null);
  });

  test("the lost-update scenario directly: a stale session's row cannot carry a stale URL", () => {
    // Session A uploads and would save { featured_image_url: "new.webp", touched: true }.
    // Session B is a second tab, still holding the OLD value, untouched this session.
    const staleSessionB = buildUpdateRow(fields(), "https://example.com/old.webp", false);
    // The whole point of the fix: session B's payload cannot express "old.webp"
    // as a write, because the key isn't there to express it with.
    assert.equal("featured_image_url" in staleSessionB, false);
  });
});

group("buildInsertRow", () => {
  test("a new post always includes featured_image_url, whatever the current value", () => {
    const withImage = buildInsertRow(fields(), "https://example.com/cover.webp");
    assert.equal(withImage.featured_image_url, "https://example.com/cover.webp");

    const withoutImage = buildInsertRow(fields(), "");
    assert.equal(withoutImage.featured_image_url, null);
  });

  test("every other field is present for a new post", () => {
    const row = buildInsertRow(fields(), "");
    assert.equal(row.slug, "example-post");
    assert.deepEqual(row.related_app_ids, []);
  });

  test("relatedAppIds maps to the related_app_ids column name", () => {
    const row = buildInsertRow(fields({ relatedAppIds: ["app-1", "app-2"] }), "");
    assert.deepEqual(row.related_app_ids, ["app-1", "app-2"]);
  });
});
