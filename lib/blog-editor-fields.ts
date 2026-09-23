/**
 * Pure payload-construction logic for BlogEditor's save(), pulled out of the
 * component so it can be unit-tested with node:test — this project has no
 * React component-testing harness, and this is exactly the decision worth
 * pinning down precisely: what gets written to `blog_posts`, and in
 * particular whether `featured_image_url` is written at all.
 *
 * The featured-image field has two independent write paths to the same
 * database column: the image-upload endpoint (app/api/admin/blog/image)
 * writes it directly the moment a file finishes processing, keyed by slug;
 * BlogEditor's own save() writes it too, keyed by post id, whenever the form
 * is submitted. Those two paths are fine in isolation, but naively having
 * save() always re-include the editor's local `image` state creates a lost-
 * update hazard: a second browser tab (or a page left open from before an
 * upload happened elsewhere) still holds whatever `featured_image_url` was
 * there when *it* loaded, and clicking Update/Publish there would silently
 * overwrite a value a different session — or the upload endpoint itself —
 * already wrote correctly.
 *
 * `imageTouched` is how BlogEditor tracks whether *this* session's uploader
 * actually changed the field (a new upload or an explicit removal — see
 * BlogEditor's onImageChange). buildUpdateRow only includes the column when
 * that's true, so an untouched session's payload never mentions it at all —
 * there is nothing in it to overwrite the current database value with.
 *
 * `articleType`/`targetAppId` (three-type blog system) follow the identical
 * tri-state shape, for the identical reason: a post tagged app_related
 * through the admin UI must not have that classification silently wiped
 * back to general/null by an unrelated save whose caller never mentions
 * either field. Both are optional on BlogPostFields so every call site that
 * existed before article types were exposed in the editor's own UI keeps
 * compiling and behaving exactly as it did — omitting them entirely is
 * indistinguishable from `{ touched: false, ... }` below.
 */

import { DEFAULT_ARTICLE_TYPE, type ArticleType } from "./blog-article-types.ts";

export type BlogPostFields = {
  slug: string;
  title: string;
  description: string;
  content: string;
  author: string;
  category: string;
  relatedAppIds: string[];
  published: boolean;
  articleType?: { touched: boolean; value: ArticleType };
  targetAppId?: { touched: boolean; value: string | null };
};

function baseRow(fields: BlogPostFields): Record<string, unknown> {
  return {
    slug: fields.slug,
    title: fields.title,
    description: fields.description,
    content: fields.content,
    author: fields.author,
    category: fields.category,
    related_app_ids: fields.relatedAppIds,
    published: fields.published,
  };
}

/**
 * Only present in the returned object when the caller marked them touched —
 * omitted (not `undefined`; genuinely absent) otherwise, so an update built
 * from this leaves both columns exactly as they already are in the
 * database. Mirrors buildUpdateRow's own featured_image_url handling below.
 */
function updateTypeFields(fields: BlogPostFields): Record<string, unknown> {
  return {
    ...(fields.articleType?.touched ? { article_type: fields.articleType.value } : {}),
    ...(fields.targetAppId?.touched ? { target_app_id: fields.targetAppId.value } : {}),
  };
}

/**
 * Always present on insert — there is no existing row to protect — falling
 * back to the same defaults the database column and the shared publish
 * validator use (DEFAULT_ARTICLE_TYPE / null) when the caller never
 * mentions either field at all.
 */
function insertTypeFields(fields: BlogPostFields): Record<string, unknown> {
  return {
    article_type: fields.articleType?.value ?? DEFAULT_ARTICLE_TYPE,
    target_app_id: fields.targetAppId?.value ?? null,
  };
}

/**
 * The row for updating an existing post. `featured_image_url` is present in
 * the returned object only when `imageTouched` is true — when it's false,
 * the key is absent entirely (not `undefined`; genuinely not a property on
 * the object), so a Supabase `.update()` call built from this leaves that
 * column untouched in the database rather than writing over it.
 */
export function buildUpdateRow(
  fields: BlogPostFields,
  image: string,
  imageTouched: boolean,
): Record<string, unknown> {
  return {
    ...baseRow(fields),
    ...(imageTouched ? { featured_image_url: image.trim() || null } : {}),
    ...updateTypeFields(fields),
  };
}

/**
 * The row for inserting a brand-new post. There is no existing database
 * value to protect for a post that doesn't exist yet, so the image is always
 * included — whatever was uploaded before the first save, or null.
 */
export function buildInsertRow(
  fields: BlogPostFields,
  image: string,
): Record<string, unknown> {
  return {
    ...baseRow(fields),
    featured_image_url: image.trim() || null,
    ...insertTypeFields(fields),
  };
}
