/**
 * The single, explicit relationship between the blog's category taxonomy
 * (lib/blog-categories.ts) and the app catalogue's category taxonomy
 * (lib/types.ts's CATEGORIES, typed as Category in lib/category-content.ts).
 * The two lists were built independently and only some categories genuinely
 * correspond — this maps exactly the ones that do, and intentionally maps
 * nothing for the rest rather than forcing a guess:
 *
 *   privacy      -> System
 *   productivity -> Productivity
 *   gaming       -> Games
 *   tools        -> Tools
 *
 * `guides` and `news` have no catalogue equivalent at all. The app
 * categories Multimedia, Internet, Education, and Writing have no blog
 * category counterpart either, so there is nothing for them to appear as on
 * this (blog -> app) side of the map — an app-side mapping, if one is ever
 * needed, is a separate concern for whichever future task actually needs it,
 * not something to force into this one.
 *
 * Both imports below are type-only, so this module has zero runtime
 * dependencies at all (not even on the two source modules' own values) —
 * kept that way so this, and anything that imports it, stays trivially
 * testable under plain `node --test`, the same reasoning
 * lib/blog-categories.ts's own doc comment gives for itself.
 *
 * This module only defines the relationship. It is infrastructure for a
 * later task — nothing here is consumed by any page, query, or link yet.
 */

import type { BlogCategory } from "./blog-categories.ts";
import type { Category } from "./category-content.ts";

/**
 * Partial, not Record<BlogCategory, Category>: a key's absence is the
 * intentional "no automatic mapping" case (guides, news today) — the same
 * shape lib/category-content.ts's CATEGORY_LISTICLE already uses for an
 * equivalent "not every category has one" relationship, reused here rather
 * than inventing a different convention for the same kind of fact.
 */
export const BLOG_TO_APP_CATEGORY: Partial<Record<BlogCategory, Category>> = {
  privacy: "System",
  productivity: "Productivity",
  gaming: "Games",
  tools: "Tools",
};

/**
 * The app category a blog category automatically corresponds to, or
 * `undefined` when there intentionally isn't one (guides, news today) —
 * never thrown, so future callers can tell "no automatic mapping" apart
 * from "this call site is broken."
 *
 * `category` must already be a genuine BlogCategory — rejecting a value that
 * isn't one is the existing category-validation system's job (e.g.
 * lib/blog.ts's normaliseBlogCategory(), or a plain
 * BLOG_CATEGORIES.includes() check on untrusted input), not this function's.
 * This only answers the mapping question for an input already known to be
 * valid; it does not re-validate it.
 */
export function getAppCategoryForBlogCategory(
  category: BlogCategory,
): Category | undefined {
  return BLOG_TO_APP_CATEGORY[category];
}

/**
 * The reverse direction, for Phase 1 Task 7 (an app category page looking up
 * its corresponding blog category): the blog category that automatically
 * corresponds to an app category, or `undefined` when none does (Multimedia,
 * Internet, Education, Writing today — none of the four mapped blog
 * categories point at them, and none of them gets one invented here).
 *
 * Derived by searching BLOG_TO_APP_CATEGORY itself — there is deliberately
 * no second, hand-written `APP_TO_BLOG_CATEGORY` table this could drift out
 * of sync with. `category` must already be a genuine Category, for the same
 * reason getAppCategoryForBlogCategory() above requires an already-valid
 * BlogCategory: rejecting an untrusted value is the existing
 * category-validation system's job (e.g. lib/category-content.ts's
 * isCategory()), not this function's.
 */
export function getBlogCategoryForAppCategory(
  category: Category,
): BlogCategory | undefined {
  const entry = (
    Object.entries(BLOG_TO_APP_CATEGORY) as [BlogCategory, Category][]
  ).find(([, appCategory]) => appCategory === category);
  return entry?.[0];
}
