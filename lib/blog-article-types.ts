/**
 * The canonical article-type list for the three-type blog system (GENERAL /
 * APP_RELATED / REVIEW_OTHER) — extracted into its own file for exactly the
 * reason lib/blog-categories.ts's own doc comment gives for itself: a module
 * that only needs the type values (a validator, a frontmatter parser, a UI
 * select) should not have to pull in lib/blog.ts's own dependencies
 * (next/cache, lib/supabase/public.ts). Zero imports here, deliberately —
 * importable from absolutely anywhere, including plain `node --test`.
 *
 * Matches the `blog_posts_article_type_check` CHECK constraint in
 * supabase/migrations/20260923000000_blog_article_type.sql exactly. If that
 * constraint's allowed values ever change, change them here — nowhere else
 * should keep its own copy of this list (scripts/publish-blog-posts.mjs is
 * the one deliberate exception, for the same "no npm ci needed to publish a
 * post" reason it already keeps its own copy of the category list).
 */

export const ARTICLE_TYPES = ["general", "app_related", "review_other"] as const;

export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  general: "General",
  app_related: "App Related",
  review_other: "Review / Other",
};

export const DEFAULT_ARTICLE_TYPE: ArticleType = "general";

export function isArticleType(value: string): value is ArticleType {
  return (ARTICLE_TYPES as readonly string[]).includes(value);
}

/**
 * The public article page's layout-selection logic: a post's article_type
 * decides which of the three type-specific layouts (General/AppRelated/
 * ReviewOther) BlogArticleView renders. Missing, null, or any value outside
 * ARTICLE_TYPES falls back to "general" — the DB column is NOT NULL with a
 * CHECK constraint, so this should never actually happen for a real row, but
 * this stays defensive per the task's own explicit fallback requirement
 * (a genuinely malformed/legacy row must render something reasonable, never
 * throw or blank the page).
 */
export function selectArticleLayout(
  articleType: string | null | undefined,
): ArticleType {
  return articleType != null && isArticleType(articleType)
    ? articleType
    : DEFAULT_ARTICLE_TYPE;
}
