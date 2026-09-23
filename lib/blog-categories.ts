/**
 * The canonical blog category list — extracted out of lib/blog.ts (which
 * re-exports these, unchanged, for every existing importer) so a module that
 * needs just the category values, like lib/blog-validation.ts, doesn't have
 * to pull in lib/blog.ts's own dependencies (next/cache, and
 * lib/supabase/public.ts, which throws at import time if the Supabase env
 * vars aren't set). Zero imports here, deliberately — this is meant to be
 * importable from absolutely anywhere, including plain `node --test`.
 *
 * Matches the `blog_posts_category_check` CHECK constraint in
 * supabase/migrations/20260903000000_baseline_schema.sql exactly. If that
 * constraint's allowed values ever change, change them here — nowhere else
 * should keep its own copy of this list.
 */

export const BLOG_CATEGORIES = [
  "privacy",
  "productivity",
  "gaming",
  "tools",
  "guides",
  "news",
] as const;

export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<BlogCategory, string> = {
  privacy: "Privacy",
  productivity: "Productivity",
  gaming: "Gaming",
  tools: "Tools",
  guides: "Guides",
  news: "News",
};
