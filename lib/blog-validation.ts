/**
 * Pure, shared shape-validation for a blog post publish/update payload.
 *
 * This centralizes the checks app/api/admin/blog/publish/route.ts already
 * performed inline (required fields, slug format, minimum content length)
 * plus two checks it was missing entirely — description length and category
 * membership — both of which merely surface an existing database constraint
 * (blog_posts_description_length, blog_posts_category_check in
 * supabase/migrations/20260903000000_baseline_schema.sql) as a clean 400
 * instead of letting a doomed insert/update reach Postgres and come back as
 * a raw 500. Neither check rejects anything that previously succeeded.
 *
 * No Supabase, no Next.js request/response objects, no auth — this loads
 * under plain `node --test`, unlike the route itself (blocked by its
 * `next/server` import, the same constraint documented throughout this
 * project). Whether a related_app_id actually exists in the `apps` table
 * needs a live query and deliberately stays in the route, not here — same
 * reasoning lib/blog-related-app-ids.ts's own doc comment already gives for
 * why *that* module only checks shape, never existence.
 *
 * This validator is used by app/api/admin/blog/publish/route.ts only.
 * components/admin/BlogEditor.tsx's browser write path (a direct
 * Supabase call, not a request to that route) is deliberately NOT wired to
 * this — see the file-level comment on that component's own validate()
 * function. Forcing this validator's rules (in particular the 500-word
 * minimum, which the editor has never enforced) onto the editor would change
 * what an admin can currently save as a draft, which is a real behavior
 * change outside this task's scope, not a bug fix.
 *
 * Imports below are relative, not the project's usual `@/lib/...` alias, and
 * name their `.ts` extension explicitly (allowed by tsconfig.json's
 * `allowImportingTsExtensions`) — deliberately, so this file resolves under
 * plain `node --test` (which has no path-alias loader registered) the same
 * way every *.test.ts file in this project already imports its own
 * subject-under-test. Both targets are themselves dependency-free enough to
 * survive that: lib/blog-categories.ts has no imports at all, and
 * lib/blog-related-app-ids.ts's only "dependency" is its own regex.
 */

import { BLOG_CATEGORIES, type BlogCategory } from "./blog-categories.ts";
import { validateRelatedAppIds, UUID_RE } from "./blog-related-app-ids.ts";
import { ARTICLE_TYPES, DEFAULT_ARTICLE_TYPE, isArticleType, type ArticleType } from "./blog-article-types.ts";

/** Lowercase words joined by single hyphens — the exact rule
 *  BLOG_POSTING.md documents and scripts/publish-blog-posts.mjs already
 *  enforces client-side before it ever calls the route. Kept here, not
 *  changed: slug has no format constraint at the database level, only
 *  UNIQUE, so this is still the only thing standing between a malformed
 *  slug and a silent insert for any caller that reaches the route directly
 *  with just the bearer token. */
export const BLOG_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Matches the `blog_posts_description_length` CHECK constraint exactly
 *  (supabase/migrations/20260903000000_baseline_schema.sql). Not the admin
 *  editor's 160-character *soft* warning
 *  (components/admin/BlogEditor.tsx) — that stays a non-blocking UI nudge,
 *  deliberately unchanged by this task. A description over 200 characters
 *  was already rejected before this validator existed; it just used to fail
 *  as a raw Postgres constraint violation (a 500) instead of a clean 400. */
export const MAX_DESCRIPTION_LENGTH = 200;

/** Every post already in blog-posts/ is 597-2389 words; 500 sits comfortably
 *  below all of them while still catching an accidental stub. Moved here
 *  verbatim from the route — not changed, and not applied anywhere the
 *  route itself didn't already apply it. */
export const MIN_CONTENT_WORDS = 500;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export type ValidatedBlogPost = {
  title: string;
  description: string;
  content: string;
  slug: string;
  category: BlogCategory;
  /**
   * `undefined` when the request never mentioned `published` at all — the
   * route needs that distinction to decide whether to touch the column on
   * an update (an omitted `published` must never silently unpublish a live
   * post). `true`/`false` otherwise, already coerced the same way the route
   * always has: anything other than the literal `true` is treated as not
   * published.
   */
  published: boolean | undefined;
  /** Same `provided` distinction as above, for the identical reason —
   *  see lib/blog-related-app-ids.ts's own doc comment. */
  relatedAppIds: { provided: boolean; ids: string[] };
  /**
   * `provided: false` means the request body has no featured_image_url key
   * at all — the route must leave an existing value untouched on update.
   * `provided: true` covers both a real URL string and an explicit `null`
   * (a deliberate "clear the image" instruction) — both are real values to
   * write, never discarded. `value` is always present (defaulted to `null`
   * when not provided) so a fresh insert, which has nothing existing to
   * protect, can use it directly.
   */
  featuredImageUrl: { provided: boolean; value: string | null };
  /**
   * `provided: false` means the request never mentioned article_type at all
   * — an update must leave the column untouched, an insert should default to
   * DEFAULT_ARTICLE_TYPE ('general'), consistent with the database column's
   * own `not null default 'general'`. `value` is always present (defaulted
   * the same way) so a fresh insert can use it directly without a second
   * `?? DEFAULT_ARTICLE_TYPE` at every call site.
   */
  articleType: { provided: boolean; value: ArticleType };
  /**
   * Same `provided`/always-present shape as featuredImageUrl above, for the
   * identical reason: `provided: false` (the key is absent) means "don't
   * touch this on update"; `provided: true, value: null` is an explicit
   * "clear the target app" instruction, not an omission. Never
   * related_app_ids — that field represents other apps the article mentions,
   * a separate relationship this validator does not touch.
   */
  targetAppId: { provided: boolean; value: string | null };
};

export type BlogPostValidationResult =
  | { valid: true; data: ValidatedBlogPost }
  | {
      valid: false;
      error: string;
      /** Extra flat fields the route spreads into its existing JSON error
       *  body (e.g. `required`, `received`, `slug`) so a caller parsing the
       *  response sees the same shape as before this validator existed. */
      extra?: Record<string, unknown>;
    };

export function validateBlogPost(body: unknown): BlogPostValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;
  const {
    title,
    description,
    content,
    slug,
    category,
    published,
    related_app_ids,
    featured_image_url,
    article_type,
    target_app_id,
  } = record;

  // Required fields — same truthiness check the route always used (an
  // empty string is "missing" the same way `undefined` is), just
  // centralized rather than restated.
  if (!title || !description || !slug || !category) {
    return {
      valid: false,
      error: "Missing required fields",
      extra: {
        required: ["title", "description", "slug", "category"],
        received: Object.keys(record),
      },
    };
  }

  if (typeof slug !== "string" || !BLOG_SLUG_RE.test(slug)) {
    return {
      valid: false,
      error: "Invalid slug: must be lowercase words joined by hyphens",
      extra: { slug },
    };
  }

  if (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      valid: false,
      error: `Description is too long: ${
        typeof description === "string" ? description.length : 0
      } characters, maximum ${MAX_DESCRIPTION_LENGTH}`,
    };
  }

  if (typeof category !== "string" || !BLOG_CATEGORIES.includes(category as BlogCategory)) {
    return {
      valid: false,
      error: `Invalid category: must be one of ${BLOG_CATEGORIES.join(", ")}`,
      extra: { category },
    };
  }

  if (typeof title !== "string") {
    return { valid: false, error: "title must be a string" };
  }

  if (typeof content !== "string" || wordCount(content) < MIN_CONTENT_WORDS) {
    return {
      valid: false,
      error: `Content is too short: ${
        typeof content === "string" ? wordCount(content) : 0
      } words, minimum ${MIN_CONTENT_WORDS}`,
    };
  }

  const relatedAppIdsResult = validateRelatedAppIds(related_app_ids);
  if (!relatedAppIdsResult.valid) {
    return { valid: false, error: relatedAppIdsResult.error };
  }

  // article_type: omitted means "don't touch it on update / default to
  // DEFAULT_ARTICLE_TYPE on insert" — never an error by itself.
  let articleTypeValue: ArticleType = DEFAULT_ARTICLE_TYPE;
  const articleTypeProvided = article_type !== undefined;
  if (articleTypeProvided) {
    if (typeof article_type !== "string" || !isArticleType(article_type)) {
      return {
        valid: false,
        error: `Invalid article_type: must be one of ${ARTICLE_TYPES.join(", ")}`,
        extra: { article_type },
      };
    }
    articleTypeValue = article_type;
  }

  // target_app_id: omitted means "don't touch it on update / null on
  // insert". An explicit null is a real "clear the target app" instruction,
  // same tri-state shape as featuredImageUrl above.
  let targetAppIdValue: string | null = null;
  const targetAppIdProvided = target_app_id !== undefined;
  if (targetAppIdProvided && target_app_id !== null) {
    if (typeof target_app_id !== "string" || !UUID_RE.test(target_app_id)) {
      return {
        valid: false,
        error: `target_app_id is not a valid UUID: "${target_app_id}"`,
        extra: { target_app_id },
      };
    }
    targetAppIdValue = target_app_id;
  }

  // An app_related article must always end up naming its one target app —
  // decidable here without a database lookup only when this exact request
  // is the one declaring article_type: "app_related" (the effective value
  // defaults to DEFAULT_ARTICLE_TYPE, never "app_related", when omitted, so
  // this never fires for a request that leaves article_type untouched).
  if (articleTypeValue === "app_related" && !targetAppIdValue) {
    return {
      valid: false,
      error: "target_app_id is required when article_type is app_related",
    };
  }

  return {
    valid: true,
    data: {
      title,
      description,
      content,
      slug,
      category: category as BlogCategory,
      published: published === undefined ? undefined : published === true,
      relatedAppIds: {
        provided: relatedAppIdsResult.provided,
        ids: relatedAppIdsResult.ids,
      },
      featuredImageUrl: {
        provided: featured_image_url !== undefined,
        value: (featured_image_url ?? null) as string | null,
      },
      articleType: {
        provided: articleTypeProvided,
        value: articleTypeValue,
      },
      targetAppId: {
        provided: targetAppIdProvided,
        value: targetAppIdValue,
      },
    },
  };
}
