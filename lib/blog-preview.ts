/**
 * The one place the admin draft-preview URL pattern is spelled out, so
 * BlogEditor's post-save "Preview" link and BlogPostsTable's per-row
 * "Preview" link can never drift onto two different paths for the same
 * route (app/admin/blog/[postId]/preview/page.tsx).
 *
 * Deliberately keyed by database id, not slug: the preview page reads
 * through the admin-only RLS policy by id (the same lookup
 * app/admin/blog/[postId]/edit/page.tsx already uses), so a slug — which is
 * guessable and is also the public post's own URL segment — is never part of
 * how a draft gets found.
 */
export function buildPreviewHref(postId: string): string {
  return `/admin/blog/${postId}/preview`;
}
