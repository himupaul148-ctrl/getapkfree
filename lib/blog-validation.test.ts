import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  validateBlogPost,
  BLOG_SLUG_RE,
  MAX_DESCRIPTION_LENGTH,
  MIN_CONTENT_WORDS,
} from "./blog-validation.ts";
import { BLOG_CATEGORIES } from "./blog-categories.ts";
import { ARTICLE_TYPES } from "./blog-article-types.ts";

const VALID_APP_ID = "561cc462-86f1-44bd-a834-fa202c764dbe";
const OTHER_VALID_APP_ID = "f3bf1a8d-8b7c-4531-ba5c-1ffa61eb8db8";

/**
 * Behavioral tests for the shared blog-post payload validator that
 * app/api/admin/blog/publish/route.ts now uses instead of its own inline
 * checks. Every rule tested here already existed in that route before this
 * task (required fields, slug format, minimum content length, related_app_ids
 * shape) — moved, not changed — except description length and category
 * membership, which are new here but were already enforced by the database
 * (blog_posts_description_length, blog_posts_category_check in
 * supabase/migrations/20260903000000_baseline_schema.sql); this just
 * surfaces the same rejection earlier as a validation result instead of a
 * database error.
 */

function words(count: number): string {
  return Array(count).fill("word").join(" ");
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "A Valid Post",
    slug: "a-valid-post",
    description: "A description of the post.",
    category: "guides",
    content: words(MIN_CONTENT_WORDS),
    ...overrides,
  };
}

group("valid minimal payload", () => {
  test("the exact minimum required fields, nothing optional, is accepted", () => {
    const result = validateBlogPost(validPayload());
    assert.equal(result.valid, true);
  });

  test("accepted data carries the fields through unchanged", () => {
    const result = validateBlogPost(validPayload());
    assert.ok(result.valid);
    assert.equal(result.data.title, "A Valid Post");
    assert.equal(result.data.slug, "a-valid-post");
    assert.equal(result.data.description, "A description of the post.");
    assert.equal(result.data.category, "guides");
  });

  test("optional fields are absent from the payload and resolve to their documented defaults", () => {
    const result = validateBlogPost(validPayload());
    assert.ok(result.valid);
    assert.equal(result.data.published, undefined);
    assert.deepEqual(result.data.relatedAppIds, { provided: false, ids: [] });
    assert.deepEqual(result.data.featuredImageUrl, { provided: false, value: null });
    assert.deepEqual(result.data.articleType, { provided: false, value: "general" });
    assert.deepEqual(result.data.targetAppId, { provided: false, value: null });
  });
});

group("article_type — valid values", () => {
  test("general is accepted with no target_app_id", () => {
    const result = validateBlogPost(validPayload({ article_type: "general" }));
    assert.ok(result.valid);
    assert.deepEqual(result.data.articleType, { provided: true, value: "general" });
  });

  test("app_related is accepted when target_app_id is also supplied", () => {
    const result = validateBlogPost(
      validPayload({ article_type: "app_related", target_app_id: VALID_APP_ID }),
    );
    assert.ok(result.valid);
    assert.deepEqual(result.data.articleType, { provided: true, value: "app_related" });
    assert.deepEqual(result.data.targetAppId, { provided: true, value: VALID_APP_ID });
  });

  test("review_other is accepted without a target_app_id", () => {
    const result = validateBlogPost(validPayload({ article_type: "review_other" }));
    assert.ok(result.valid);
    assert.deepEqual(result.data.targetAppId, { provided: false, value: null });
  });

  test("review_other is accepted with a target_app_id too (e.g. a single-app review)", () => {
    const result = validateBlogPost(
      validPayload({ article_type: "review_other", target_app_id: VALID_APP_ID }),
    );
    assert.ok(result.valid);
    assert.deepEqual(result.data.targetAppId, { provided: true, value: VALID_APP_ID });
  });

  test("every canonical article type from lib/blog-article-types.ts is accepted (with a target app for app_related)", () => {
    for (const articleType of ARTICLE_TYPES) {
      const overrides: Record<string, unknown> = { article_type: articleType };
      if (articleType === "app_related") overrides.target_app_id = VALID_APP_ID;
      const result = validateBlogPost(validPayload(overrides));
      assert.equal(result.valid, true, `expected "${articleType}" to be accepted`);
    }
  });
});

group("article_type — invalid value rejected", () => {
  test("a value outside the canonical list is rejected", () => {
    const result = validateBlogPost(validPayload({ article_type: "sponsored" }));
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /Invalid article_type/);
    assert.equal(result.extra?.article_type, "sponsored");
  });

  test("the error message names every allowed type", () => {
    const result = validateBlogPost(validPayload({ article_type: "sponsored" }));
    assert.ok(!result.valid);
    for (const articleType of ARTICLE_TYPES) {
      assert.match(result.error, new RegExp(articleType));
    }
  });

  test("a non-string article_type is rejected", () => {
    const result = validateBlogPost(validPayload({ article_type: 123 }));
    assert.equal(result.valid, false);
  });

  test("article_type is case-sensitive, matching the database CHECK constraint's exact values", () => {
    const result = validateBlogPost(validPayload({ article_type: "General" }));
    assert.equal(result.valid, false);
  });
});

group("article_type — omitted", () => {
  test("omitted: not provided, value defaults to general, matching the database column's own default", () => {
    const result = validateBlogPost(validPayload());
    assert.ok(result.valid);
    assert.deepEqual(result.data.articleType, { provided: false, value: "general" });
  });
});

group("target_app_id — format validation", () => {
  test("a well-formed UUID is accepted", () => {
    const result = validateBlogPost(validPayload({ target_app_id: VALID_APP_ID }));
    assert.ok(result.valid);
    assert.deepEqual(result.data.targetAppId, { provided: true, value: VALID_APP_ID });
  });

  test("a malformed value is rejected", () => {
    const result = validateBlogPost(validPayload({ target_app_id: "not-a-uuid" }));
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /target_app_id is not a valid UUID/);
  });

  test("a non-string, non-null value is rejected", () => {
    const result = validateBlogPost(validPayload({ target_app_id: 12345 }));
    assert.equal(result.valid, false);
  });

  test("omitted: not provided, value defaults to null", () => {
    const result = validateBlogPost(validPayload());
    assert.ok(result.valid);
    assert.deepEqual(result.data.targetAppId, { provided: false, value: null });
  });

  test("explicit null is marked as provided (a real 'clear the target app' instruction), not omitted — same tri-state contract as featured_image_url", () => {
    const result = validateBlogPost(validPayload({ target_app_id: null }));
    assert.ok(result.valid);
    assert.deepEqual(result.data.targetAppId, { provided: true, value: null });
  });
});

group("app_related requires target_app_id", () => {
  test("app_related with no target_app_id at all is rejected", () => {
    const result = validateBlogPost(validPayload({ article_type: "app_related" }));
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /target_app_id is required when article_type is app_related/);
  });

  test("app_related with an explicit null target_app_id is rejected — null is not a target app", () => {
    const result = validateBlogPost(
      validPayload({ article_type: "app_related", target_app_id: null }),
    );
    assert.equal(result.valid, false);
  });

  test("app_related with a malformed target_app_id is rejected by the format check first", () => {
    const result = validateBlogPost(
      validPayload({ article_type: "app_related", target_app_id: "not-a-uuid" }),
    );
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /not a valid UUID/);
  });

  test("app_related with a valid target_app_id is accepted", () => {
    const result = validateBlogPost(
      validPayload({ article_type: "app_related", target_app_id: OTHER_VALID_APP_ID }),
    );
    assert.equal(result.valid, true);
  });

  test("this rule never fires when article_type is omitted (defaults to general, not app_related)", () => {
    const result = validateBlogPost(validPayload());
    assert.equal(result.valid, true);
  });

  test("general does not require target_app_id, and is not forbidden from having one either (matches the database CHECK constraint, which only constrains app_related)", () => {
    const withoutTarget = validateBlogPost(validPayload({ article_type: "general" }));
    assert.equal(withoutTarget.valid, true);
    const withTarget = validateBlogPost(
      validPayload({ article_type: "general", target_app_id: VALID_APP_ID }),
    );
    assert.equal(withTarget.valid, true);
  });
});

group("required fields — missing", () => {
  for (const field of ["title", "slug", "description", "category"]) {
    test(`missing ${field} is rejected`, () => {
      const payload = validPayload({ [field]: undefined });
      const result = validateBlogPost(payload);
      assert.equal(result.valid, false);
      assert.ok(!result.valid);
      assert.equal(result.error, "Missing required fields");
    });
  }

  test("an empty string is treated the same as missing (matches the route's original truthiness check)", () => {
    const result = validateBlogPost(validPayload({ title: "" }));
    assert.equal(result.valid, false);
  });

  test("the error response lists which fields are required and which keys were actually received", () => {
    const result = validateBlogPost({ title: "Only a title" });
    assert.ok(!result.valid);
    assert.deepEqual(result.extra?.required, ["title", "description", "slug", "category"]);
    assert.deepEqual(result.extra?.received, ["title"]);
  });

  test("content is required too, via the word-count check rather than the missing-fields check", () => {
    const result = validateBlogPost(validPayload({ content: undefined }));
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /Content is too short/);
  });
});

group("slug", () => {
  test("BLOG_SLUG_RE is lowercase words joined by single hyphens, matching the pre-existing rule", () => {
    assert.equal(BLOG_SLUG_RE.test("a-valid-post"), true);
    assert.equal(BLOG_SLUG_RE.test("Invalid Post"), false);
    assert.equal(BLOG_SLUG_RE.test("invalid_post"), false);
    assert.equal(BLOG_SLUG_RE.test("-invalid-post"), false);
    assert.equal(BLOG_SLUG_RE.test("invalid--post"), false);
  });

  test("a slug with spaces is rejected", () => {
    const result = validateBlogPost(validPayload({ slug: "not a slug" }));
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /Invalid slug/);
    assert.equal(result.extra?.slug, "not a slug");
  });

  test("a slug with uppercase letters is rejected", () => {
    const result = validateBlogPost(validPayload({ slug: "Not-A-Slug" }));
    assert.equal(result.valid, false);
  });

  test("a non-string slug is rejected", () => {
    const result = validateBlogPost(validPayload({ slug: 123 }));
    assert.equal(result.valid, false);
  });
});

group("category — invalid value", () => {
  test("every canonical category from lib/blog.ts is accepted", () => {
    for (const category of BLOG_CATEGORIES) {
      const result = validateBlogPost(validPayload({ category }));
      assert.equal(result.valid, true, `expected "${category}" to be accepted`);
    }
  });

  test("a category outside the canonical list is rejected", () => {
    const result = validateBlogPost(validPayload({ category: "sports" }));
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /Invalid category/);
    assert.equal(result.extra?.category, "sports");
  });

  test("the error message names every allowed category, sourced from BLOG_CATEGORIES", () => {
    const result = validateBlogPost(validPayload({ category: "sports" }));
    assert.ok(!result.valid);
    for (const category of BLOG_CATEGORIES) {
      assert.match(result.error, new RegExp(category));
    }
  });

  test("category is case-sensitive, matching the database CHECK constraint's exact values", () => {
    const result = validateBlogPost(validPayload({ category: "Guides" }));
    assert.equal(result.valid, false);
  });
});

group("invalid field type", () => {
  test("a non-object body is rejected rather than throwing", () => {
    assert.equal(validateBlogPost(null).valid, false);
    assert.equal(validateBlogPost("a string").valid, false);
    assert.equal(validateBlogPost(42).valid, false);
    assert.equal(validateBlogPost(["array"]).valid, false);
  });

  test("a numeric slug is rejected rather than coerced", () => {
    const result = validateBlogPost(validPayload({ slug: 12345 }));
    assert.equal(result.valid, false);
  });

  test("a non-string content is rejected", () => {
    const result = validateBlogPost(validPayload({ content: 12345 }));
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /Content is too short/);
  });
});

group("description length", () => {
  test(`exactly ${MAX_DESCRIPTION_LENGTH} characters is accepted (matches the database CHECK constraint)`, () => {
    const description = "d".repeat(MAX_DESCRIPTION_LENGTH);
    const result = validateBlogPost(validPayload({ description }));
    assert.equal(result.valid, true);
  });

  test(`${MAX_DESCRIPTION_LENGTH + 1} characters is rejected`, () => {
    const description = "d".repeat(MAX_DESCRIPTION_LENGTH + 1);
    const result = validateBlogPost(validPayload({ description }));
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /too long/);
  });
});

group("minimum content length", () => {
  test(`exactly ${MIN_CONTENT_WORDS} words is accepted`, () => {
    const result = validateBlogPost(validPayload({ content: words(MIN_CONTENT_WORDS) }));
    assert.equal(result.valid, true);
  });

  test(`${MIN_CONTENT_WORDS - 1} words is rejected`, () => {
    const result = validateBlogPost(validPayload({ content: words(MIN_CONTENT_WORDS - 1) }));
    assert.equal(result.valid, false);
    assert.ok(!result.valid);
    assert.match(result.error, /Content is too short/);
  });
});

group("featured_image_url — optional, provided", () => {
  test("a supplied URL survives into the validated data, marked as provided", () => {
    const result = validateBlogPost(
      validPayload({ featured_image_url: "https://example.com/cover.webp" }),
    );
    assert.ok(result.valid);
    assert.deepEqual(result.data.featuredImageUrl, {
      provided: true,
      value: "https://example.com/cover.webp",
    });
  });
});

group("featured_image_url — omitted", () => {
  test("an omitted field is marked not-provided, value defaults to null", () => {
    const result = validateBlogPost(validPayload());
    assert.ok(result.valid);
    assert.deepEqual(result.data.featuredImageUrl, { provided: false, value: null });
  });
});

group("featured_image_url — explicit null", () => {
  test("an explicit null is marked as provided (a real 'clear the image' instruction), not omitted", () => {
    const result = validateBlogPost(validPayload({ featured_image_url: null }));
    assert.ok(result.valid);
    assert.deepEqual(result.data.featuredImageUrl, { provided: true, value: null });
  });

  test("explicit null and omission are distinguishable — this is exactly the Task 2 contract", () => {
    const omitted = validateBlogPost(validPayload());
    const explicitNull = validateBlogPost(validPayload({ featured_image_url: null }));
    assert.ok(omitted.valid && explicitNull.valid);
    assert.notEqual(omitted.data.featuredImageUrl.provided, explicitNull.data.featuredImageUrl.provided);
  });
});

group("related_app_ids — existing contract, delegated to lib/blog-related-app-ids", () => {
  test("omitted: not provided, empty ids", () => {
    const result = validateBlogPost(validPayload());
    assert.ok(result.valid);
    assert.deepEqual(result.data.relatedAppIds, { provided: false, ids: [] });
  });

  test("a well-formed list of UUIDs is accepted and order-preserved", () => {
    const ids = [
      "561cc462-86f1-44bd-a834-fa202c764dbe",
      "f3bf1a8d-8b7c-4531-ba5c-1ffa61eb8db8",
    ];
    const result = validateBlogPost(validPayload({ related_app_ids: ids }));
    assert.ok(result.valid);
    assert.deepEqual(result.data.relatedAppIds, { provided: true, ids });
  });

  test("an explicit empty array is provided:true, not the same as omission", () => {
    const result = validateBlogPost(validPayload({ related_app_ids: [] }));
    assert.ok(result.valid);
    assert.deepEqual(result.data.relatedAppIds, { provided: true, ids: [] });
  });

  test("a malformed UUID rejects the whole payload, same as the pre-existing behavior", () => {
    const result = validateBlogPost(validPayload({ related_app_ids: ["not-a-uuid"] }));
    assert.equal(result.valid, false);
  });

  test("a non-array related_app_ids rejects the whole payload", () => {
    const result = validateBlogPost(validPayload({ related_app_ids: "not-a-list" }));
    assert.equal(result.valid, false);
  });
});

group("published — existing contract", () => {
  test("omitted: undefined, so the route can leave an update's published column untouched", () => {
    const result = validateBlogPost(validPayload());
    assert.ok(result.valid);
    assert.equal(result.data.published, undefined);
  });

  test("published: true is preserved as true", () => {
    const result = validateBlogPost(validPayload({ published: true }));
    assert.ok(result.valid);
    assert.equal(result.data.published, true);
  });

  test("published: false is preserved as false, distinguishable from omission", () => {
    const result = validateBlogPost(validPayload({ published: false }));
    assert.ok(result.valid);
    assert.equal(result.data.published, false);
  });

  test("a truthy non-boolean value is coerced to false, matching the route's original `published === true` check", () => {
    const result = validateBlogPost(validPayload({ published: "true" }));
    assert.ok(result.valid);
    assert.equal(result.data.published, false);
  });
});
