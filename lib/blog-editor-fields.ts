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
 */

export type BlogPostFields = {
  slug: string;
  title: string;
  description: string;
  content: string;
  author: string;
  category: string;
  relatedAppIds: string[];
  published: boolean;
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
  };
}
