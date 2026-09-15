/**
 * Pure validation for a blog post's related_app_ids field. No Supabase, no
 * Next.js — this module loads under plain `node --test` and gets real
 * behavioral tests, unlike app/api/admin/blog/publish/route.ts itself
 * (blocked from that by its `next/server` import, the same constraint
 * documented throughout this project — see lib/catalogue.test.ts and
 * lib/blog-error-handling.test.ts for the same reasoning applied elsewhere).
 *
 * This only validates shape and format. It has no way to confirm an ID
 * actually exists in the `apps` table — that needs a live Supabase query,
 * which stays in the route and is covered by static-source tests there.
 */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type RelatedAppIdsValidation =
  | { valid: true; provided: boolean; ids: string[] }
  | { valid: false; error: string };

/**
 * `provided` distinguishes "the caller never mentioned related_app_ids"
 * (input is `undefined` — `ids` comes back `[]`) from "the caller explicitly
 * sent an empty array" (`provided: true`, `ids: []`). The API route needs
 * that distinction: an UPDATE should leave the column untouched in the
 * first case, but clear it to `[]` in the second — otherwise a routine
 * content republish with no related_app_ids in its frontmatter could
 * silently erase a value someone curated by hand through the admin editor.
 *
 * Order and duplicates are preserved exactly as given — this never sorts,
 * dedupes, or otherwise reorders `ids`.
 */
export function validateRelatedAppIds(input: unknown): RelatedAppIdsValidation {
  if (input === undefined) {
    return { valid: true, provided: false, ids: [] };
  }

  if (!Array.isArray(input)) {
    return { valid: false, error: "related_app_ids must be an array" };
  }

  for (const [index, item] of input.entries()) {
    if (typeof item !== "string") {
      return {
        valid: false,
        error: `related_app_ids[${index}] must be a string`,
      };
    }
    if (!UUID_RE.test(item)) {
      return {
        valid: false,
        error: `related_app_ids[${index}] is not a valid UUID: "${item}"`,
      };
    }
  }

  return { valid: true, provided: true, ids: input as string[] };
}
