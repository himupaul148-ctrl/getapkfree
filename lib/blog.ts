import { unstable_cache } from "next/cache";
import { supabase } from "@/lib/supabase/public";
import { resolveQueryResult } from "@/lib/supabase/query-result";
import { APP_SUMMARY_SELECT, toSummary } from "@/lib/catalogue";
import type { AppSummary, AppWithVersions } from "@/lib/types";
import { excerpt, readingTime } from "@/lib/markdown";
import { latestVersion } from "@/lib/format";
import type { SourceType } from "@/lib/sources";
import { orderAndLimitRelatedApps } from "@/lib/related-apps-order";

// Imported (not defined here) and re-exported, so lib/blog-validation.ts
// (and anything else that only needs the category list) can import it
// without pulling in this file's own next/cache and lib/supabase/public.ts
// dependencies — see lib/blog-categories.ts's own doc comment. Every
// existing importer of BLOG_CATEGORIES/CATEGORY_LABELS/BlogCategory from
// "@/lib/blog" keeps working unchanged.
import { BLOG_CATEGORIES, CATEGORY_LABELS, type BlogCategory } from "@/lib/blog-categories";
export { BLOG_CATEGORIES, CATEGORY_LABELS, type BlogCategory };

// Re-exported the same way, and for the same reason: BlogEditor.tsx (and
// anything else that needs the article-type list) imports it from here so
// every existing "@/lib/blog" importer keeps one canonical source rather
// than a second, independently-maintained one.
import {
  ARTICLE_TYPES,
  ARTICLE_TYPE_LABELS,
  DEFAULT_ARTICLE_TYPE,
  selectArticleLayout,
  type ArticleType,
} from "@/lib/blog-article-types";
export { ARTICLE_TYPES, ARTICLE_TYPE_LABELS, DEFAULT_ARTICLE_TYPE, selectArticleLayout, type ArticleType };

export const POSTS_PER_PAGE = 10;

/**
 * Slugs of posts that are retired via a permanent redirect (see the matching
 * entry in next.config.ts) rather than deleted outright — the row stays in
 * Supabase for the record, but must never resurface as its own listing,
 * sitemap entry, or feed item now that its URL 301s elsewhere. Add to this
 * list, and next.config.ts, for any future retire-and-redirect case; nothing
 * here assumes there will only ever be one.
 */
const RETIRED_SLUGS: readonly string[] = [
  "check-apk-permissions-before-install",
  "best-privacy-apps-android-2026",
];

export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  description: string;
  content: string;
  featured_image_url: string | null;
  author: string;
  category: string;
  related_app_ids: string[];
  published: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
  /**
   * Optional, not required: public queries in this file select LIST_COLUMNS,
   * which deliberately does not include either column (public rendering
   * doesn't use them yet — see components/admin/BlogEditor.tsx for the one
   * place that currently does). Admin queries (`select("*")`) always
   * populate both. Making them optional here, rather than adding them to
   * LIST_COLUMNS, keeps every existing public query's actual selected
   * columns honestly reflected in this type instead of claiming a field a
   * public row never actually carries.
   */
  article_type?: ArticleType;
  target_app_id?: string | null;
};

/**
 * Listing rows drop the body — the largest column — but keep the two things
 * derived from it, so a card never has to parse markdown.
 */
export type BlogSummary = Omit<BlogPost, "content"> & {
  excerptText: string;
  readMinutes: number;
};

const LIST_COLUMNS =
  "id, slug, title, description, featured_image_url, author, category, related_app_ids, published, view_count, created_at, updated_at";

export function normaliseBlogCategory(raw: string | undefined): string {
  if (!raw) return "";
  const match = BLOG_CATEGORIES.find(
    (c) => c === raw.trim().toLowerCase(),
  );
  return match ?? "";
}

export function normalisePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

async function fetchPublished(): Promise<BlogSummary[]> {
  // RLS already hides drafts from anonymous readers, but an admin browsing the
  // public blog shares this code path and would otherwise see their own
  // drafts listed as if they were live.
  const { data, error } = await supabase
    .from("blog_posts")
    .select(`${LIST_COLUMNS}, content`)
    .eq("published", true)
    .order("created_at", { ascending: false })
    .returns<BlogPost[]>();

  const rows = resolveQueryResult(data, error, "fetchPublished: Supabase query failed") ?? [];

  return rows
    .filter((post) => !RETIRED_SLUGS.includes(post.slug))
    .map(({ content, ...rest }) => ({
    ...rest,
    // The description is written for search snippets; fall back to the body
    // only when a post somehow has none.
    excerptText: rest.description || excerpt(content),
    readMinutes: readingTime(content),
  }));
}

/**
 * Cached like the catalogue: the blog changes rarely and the listing is a
 * dynamic route (it reads searchParams), so caching the query is the only
 * caching available. Tagged so an admin publish can drop it immediately.
 */
export const getPublishedPosts = unstable_cache(
  fetchPublished,
  ["blog-posts"],
  { revalidate: 3600, tags: ["blog"] },
);

export type SitemapBlogPost = { slug: string; updated_at: string };

/**
 * Direct, uncached read for app/sitemap.ts specifically. Deliberately does
 * NOT go through getPublishedPosts()/unstable_cache above: the sitemap route
 * is already `export const dynamic = "force-dynamic"` (re-executes fully on
 * every request), so a stale unstable_cache entry can only ever make the
 * sitemap wrong, never save it a real Supabase round trip. Selects just the
 * two columns a sitemap entry needs, not the full post (no content, no
 * excerpt/read-time derivation).
 */
export async function getPublishedPostsForSitemap(): Promise<SitemapBlogPost[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("slug, updated_at")
    .eq("published", true)
    .order("created_at", { ascending: false })
    .returns<SitemapBlogPost[]>();

  const rows =
    resolveQueryResult(data, error, "getPublishedPostsForSitemap: Supabase query failed") ?? [];

  return rows.filter((post) => !RETIRED_SLUGS.includes(post.slug));
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  // Unlike LIST_COLUMNS (used by every listing/card query, none of which
  // need them), this single-post lookup additionally selects
  // article_type/target_app_id: the individual article page (Phase 5) needs
  // both to decide whether to show its compact "About this app" reference.
  const { data, error } = await supabase
    .from("blog_posts")
    .select(`${LIST_COLUMNS}, content, article_type, target_app_id`)
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle<BlogPost>();
  return resolveQueryResult(data, error, `getPostBySlug: Supabase query failed for slug "${slug}"`);
}

/**
 * Matches getPopularSlugs(50) on the app detail route
 * (app/app/[slug]/page.tsx) — the same "cap what's prerendered at build
 * time" number, applied here for the same reason: as the blog grows, a
 * build should not attempt to pre-generate an unbounded number of pages.
 */
export const BLOG_STATIC_PARAMS_LIMIT = 50;

/**
 * Slugs for generateStaticParams — without it the segment is not ISR.
 *
 * Bounded and explicitly ordered (Phase 1 Task C3): this used to select
 * every published slug with no `.order()`/`.limit()` at all, so the number
 * of statically-generated blog pages grew without bound as posts were
 * published, and which slugs came back was whatever order Postgres happened
 * to return rather than anything deterministic. Newest-first with an `id`
 * tiebreaker (the same ordering convention every other listing query in
 * this file uses) makes a build's chosen set of pages reproducible, and
 * naturally rotates in newly-published posts as older ones age past the
 * cap. A slug outside this set is never unreachable — it renders on first
 * request and is cached from then on via this route's own ISR
 * (`revalidate = 3600`, app/blog/[slug]/page.tsx), the identical fallback
 * getPopularSlugs' own doc comment describes for the app detail long tail.
 */
export async function getPublishedSlugs(
  limit = BLOG_STATIC_PARAMS_LIMIT,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("slug")
    .eq("published", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
    .returns<{ slug: string }[]>();
  const rows = resolveQueryResult(data, error, "getPublishedSlugs: Supabase query failed") ?? [];
  return rows.map((row) => row.slug);
}

/**
 * Neighbours by publish date, for the footer links. Returns the post published
 * just before and just after this one.
 *
 * Fetches one extra row per side beyond what RETIRED_SLUGS could exclude,
 * rather than filtering by slug in the query itself — a `.not("slug", "in",
 * ...)` Postgrest filter is fragile to build correctly for an arbitrary-length
 * list, while over-fetching by RETIRED_SLUGS.length and picking the first
 * live row client-side handles any number of retired slugs, including one
 * sitting immediately adjacent, without ever surfacing a redirect-only URL in
 * the prev/next footer.
 */
export async function getAdjacentPosts(post: BlogPost): Promise<{
  previous: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}> {
  const bufferSize = RETIRED_SLUGS.length + 1;

  const [olderRes, newerRes] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("slug, title")
      .eq("published", true)
      .lt("created_at", post.created_at)
      .order("created_at", { ascending: false })
      .limit(bufferSize)
      .returns<{ slug: string; title: string }[]>(),
    supabase
      .from("blog_posts")
      .select("slug, title")
      .eq("published", true)
      .gt("created_at", post.created_at)
      .order("created_at", { ascending: true })
      .limit(bufferSize)
      .returns<{ slug: string; title: string }[]>(),
  ]);

  const firstLive = (rows: { slug: string; title: string }[] | null) =>
    (rows ?? []).find((row) => !RETIRED_SLUGS.includes(row.slug)) ?? null;

  return { previous: firstLive(olderRes.data), next: firstLive(newerRes.data) };
}

/**
 * Sidebar apps. Falls back to the most-downloaded apps when a post names none,
 * so the sidebar is never an empty box.
 *
 * related_app_ids is a text[] of uuids, which Postgres cannot constrain with a
 * foreign key — a deleted app simply drops out of the result rather than
 * breaking the query.
 *
 * Selects lib/catalogue.ts's APP_SUMMARY_SELECT rather than "*": both this
 * function and getCatalogue there end by calling the same toSummary() on the
 * result, so whatever column list is sufficient to build an AppSummary for
 * the homepage is, by construction, sufficient here too — reusing it instead
 * of a second hand-maintained list is what keeps them from drifting apart.
 */
export async function getRelatedApps(
  ids: string[],
  limit = 6,
): Promise<{ apps: AppSummary[]; fallback: boolean }> {
  if (ids.length > 0) {
    // No .limit() here deliberately: an .in() query carries no ORDER BY of
    // its own, so applying a database-side limit before the reordering
    // below would let Postgres hand back an arbitrary `limit` rows out of a
    // longer related_app_ids list — not necessarily the first ones in the
    // author's order. `ids` is already bounded by how many apps a post
    // actually names (in practice under a dozen), so fetching all of them
    // and cutting down to `limit` afterward costs nothing meaningful.
    const { data } = await supabase
      .from("apps")
      .select(APP_SUMMARY_SELECT)
      .in("id", ids)
      .returns<AppWithVersions[]>();

    if (data && data.length > 0) {
      // Preserve the order the author chose rather than whatever Postgres
      // returns, then cut down to `limit` only after that ordering is
      // applied — never before. See lib/related-apps-order.ts.
      const ordered = orderAndLimitRelatedApps(data, ids, limit);
      return { apps: ordered.map(toSummary), fallback: false };
    }
  }

  const { data } = await supabase
    .from("apps")
    .select(APP_SUMMARY_SELECT)
    .order("download_count", { ascending: false })
    .limit(limit)
    .returns<AppWithVersions[]>();

  return { apps: (data ?? []).map(toSummary), fallback: true };
}

/**
 * Matches getBlogPostsForApp()'s APP_RELATED_POSTS_LIMIT below and
 * getRelatedApps(app.category, app.id, 4) on the app detail page — one
 * consistent secondary-section card count across the site rather than a
 * different number per feature.
 */
const CATEGORY_RELATED_POSTS_LIMIT = 4;

/**
 * Phase 1 Task 7: published posts in a given blog category, for an app
 * category page that has a Task 6 mapping to show relevant guides. Filters
 * at the database, not in JavaScript — `.eq("category", category)` runs in
 * Postgres, so this never fetches every post the way app/blog/page.tsx's own
 * in-memory category filter over getPublishedPosts() does; that page's
 * approach is fine for a full paginated listing (it needs every matching
 * post to paginate over), but wrong for a small, bounded card section like
 * this one.
 *
 * Returns full BlogSummary rows (not the narrower shape getBlogPostsForApp()
 * uses) specifically so the caller can render them with the existing
 * BlogCard component unchanged — same transform as fetchPublished() above,
 * repeated here rather than shared because the two queries differ in their
 * WHERE/LIMIT clauses, not their row shape, and every other query in this
 * file already takes the same "own query, own transform" shape rather than
 * a shared query-builder.
 */
export async function getPublishedPostsByCategory(
  category: BlogCategory,
  limit = CATEGORY_RELATED_POSTS_LIMIT,
): Promise<BlogSummary[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select(`${LIST_COLUMNS}, content`)
    .eq("published", true)
    .eq("category", category)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<BlogPost[]>();

  const rows =
    resolveQueryResult(
      data,
      error,
      `getPublishedPostsByCategory: Supabase query failed for category "${category}"`,
    ) ?? [];

  return rows
    .filter((post) => !RETIRED_SLUGS.includes(post.slug))
    .map(({ content, ...rest }) => ({
      ...rest,
      excerptText: rest.description || excerpt(content),
      readMinutes: readingTime(content),
    }));
}

export type AppRelatedPost = {
  id: string;
  slug: string;
  title: string;
  category: string;
};

/**
 * Matches getRelatedApps(app.category, app.id, 4)'s own limit on the same
 * page (app/app/[slug]/page.tsx), so the two secondary sections read as one
 * consistent design rather than two different card counts.
 */
const APP_RELATED_POSTS_LIMIT = 4;

/**
 * Reverse lookup for an app detail page: every published post whose
 * related_app_ids contains this app's id — the automatic App -> Blog
 * direction, complementing getRelatedApps() above (the Blog -> App
 * direction: a post's own related_app_ids driving its sidebar apps).
 *
 * The relationship filter runs in Postgres, not here: .contains() compiles
 * to `related_app_ids @> ARRAY[appId]`, a real database-side membership
 * test — this never fetches every post and filters in JavaScript.
 * related_app_ids has no index today (only blog_posts_category_idx and
 * blog_posts_published_created_idx exist — see
 * supabase/migrations/20260903000000_baseline_schema.sql); fine at the
 * current post count, and a `create index ... using gin (related_app_ids)`
 * would be the natural next step if this table grows into the thousands —
 * out of scope for this change, no migration included here.
 *
 * Selects only the four columns the app page's card actually renders (id for
 * the React key, slug for the link, title, category for the label) — never
 * content, author, featured_image_url, or any other BlogPost column this
 * section doesn't show.
 *
 * Uses the public, cookie-less client and still filters
 * .eq("published", true) explicitly even though RLS already enforces it —
 * belt and braces, matching every other function in this file, not a new
 * convention. A draft that happens to name this app in its related_app_ids
 * must never appear on the public app page.
 */
export async function getBlogPostsForApp(
  appId: string,
  limit = APP_RELATED_POSTS_LIMIT,
): Promise<AppRelatedPost[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, slug, title, category")
    .eq("published", true)
    .contains("related_app_ids", [appId])
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AppRelatedPost[]>();

  const rows =
    resolveQueryResult(data, error, `getBlogPostsForApp: Supabase query failed for app "${appId}"`) ?? [];

  return rows.filter((post) => !RETIRED_SLUGS.includes(post.slug));
}

/**
 * Three-type blog system: published posts whose target_app_id is this exact
 * app AND whose article_type is either 'app_related' (target required) or
 * 'review_other' (target optional — e.g. a single-app review, per
 * supabase/migrations/20260923000000_blog_article_type.sql's own comment) —
 * the "this article is specifically about this app" relationship, distinct
 * from getBlogPostsForApp() above (which finds posts that merely *mention*
 * this app via related_app_ids, regardless of what the post is actually
 * about). GENERAL is deliberately excluded even if legacy/inconsistent data
 * ever gave a general post a target_app_id — target_app_id only carries this
 * "primary app" meaning for the two article types whose own semantics
 * define it.
 *
 * .eq("target_app_id", appId) and .in("article_type", [...]) both run in
 * Postgres, not here — the same "never fetch every post and filter in
 * JavaScript" discipline getBlogPostsForApp() already documents for its own
 * .contains() filter. A secondary `id` tiebreaker (absent from
 * getBlogPostsForApp(), added here per this task's own determinism
 * requirement) keeps which posts land in a bounded `limit` deterministic
 * across requests when several share a created_at value.
 *
 * Retired-slug handling matches getBlogPostsForApp() exactly (its immediate
 * sibling, same bounded scale) rather than the DB-level `.not(...)`
 * exclusion Phase 1 Task 10B uses for the full paginated public listing —
 * that heavier mechanism exists specifically to keep .range() pagination
 * exact across many pages; a single small, bounded, unpaginated card
 * section like this one has no such requirement.
 *
 * Deliberately reuses AppRelatedPost, not a new type: the app page renders
 * both this and getBlogPostsForApp()'s results with the same card shape
 * (id, slug, title, category) — inventing a second, identically-shaped type
 * here would only create a place for the two to drift apart.
 */
export async function getPrimaryBlogPostsForApp(
  appId: string,
  limit = APP_RELATED_POSTS_LIMIT,
): Promise<AppRelatedPost[]> {
  const { data, error } = await supabase
    .from("blog_posts")
    .select("id, slug, title, category")
    .eq("published", true)
    .eq("target_app_id", appId)
    .in("article_type", ["app_related", "review_other"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
    .returns<AppRelatedPost[]>();

  const rows =
    resolveQueryResult(
      data,
      error,
      `getPrimaryBlogPostsForApp: Supabase query failed for app "${appId}"`,
    ) ?? [];

  return rows.filter((post) => !RETIRED_SLUGS.includes(post.slug));
}

/**
 * Everything the article page's target-app presentation needs: the compact
 * "About this app" reference card (id/name/slug/icon_url — the original,
 * narrower shape this type used to be) plus the small "APP FACTS" block the
 * three-distinct-layouts task adds for APP_RELATED/REVIEW_OTHER (category,
 * developer_name, package_name, source_type, external_url, license, and the
 * latest published version's version_name/min_android_version). Every field
 * beyond the original four is nullable/omittable in rendering — AppFacts
 * only shows a fact when it's actually present, never inventing one.
 */
export type TargetAppLink = {
  id: string;
  name: string;
  slug: string;
  icon_url: string | null;
  category: string | null;
  developer_name: string | null;
  package_name: string;
  source_type: SourceType;
  external_url: string | null;
  license: string | null;
  latest_version: string | null;
  min_android_version: string | null;
};

type TargetAppRow = {
  id: string;
  name: string;
  slug: string;
  icon_url: string | null;
  category: string | null;
  developer_name: string | null;
  package_name: string;
  source_type: SourceType;
  external_url: string | null;
  license: string | null;
  versions: { version_name: string; version_code: number; min_android_version: string | null }[] | null;
};

/**
 * Resolves an APP_RELATED/REVIEW_OTHER post's target_app_id to the fields
 * the public article page's compact "About this app" reference and its
 * "APP FACTS" block need — never the full App record, which
 * app/app/[slug]/page.tsx's own getAppBySlug() already exists for and this
 * has no reason to duplicate (no screenshots, no permissions, no full
 * version history).
 *
 * Deliberately does NOT use resolveQueryResult()'s usual throw-on-error
 * behavior, unlike every other function in this file: this is a secondary,
 * non-essential enhancement to an article page that must render regardless
 * of whether this one lookup succeeds. A genuine Supabase error is logged,
 * not thrown, and a target app that no longer exists (deleted after the
 * post was tagged) resolves the same way a real query failure does — both
 * fail closed to "show nothing" rather than break the article or, worse,
 * substitute some other app. There is no fallback app to show here the way
 * getRelatedApps() falls back to trending apps: showing an unrelated app in
 * an "About this app" slot would misrepresent what the article is about.
 */
export async function getTargetApp(targetAppId: string): Promise<TargetAppLink | null> {
  const { data, error } = await supabase
    .from("apps")
    .select(
      "id, name, slug, icon_url, category, developer_name, package_name, source_type, external_url, license, versions(version_name, version_code, min_android_version)",
    )
    .eq("id", targetAppId)
    .maybeSingle<TargetAppRow>();

  if (error) {
    console.error(`getTargetApp: Supabase query failed for app "${targetAppId}"`, error);
    return null;
  }

  if (!data) return null;

  // Joined versions come back already filtered by RLS to published builds
  // (see toSummary()'s own comment in lib/catalogue.ts for the same point) —
  // an unpublished/unscanned build never surfaces here as "the latest".
  const latest = latestVersion(data.versions ?? []);

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    icon_url: data.icon_url,
    category: data.category,
    developer_name: data.developer_name,
    package_name: data.package_name,
    source_type: data.source_type,
    external_url: data.external_url,
    license: data.license,
    latest_version: latest?.version_name ?? null,
    min_android_version: latest?.min_android_version ?? null,
  };
}

/**
 * Matches getPrimaryBlogPostsForApp/getBlogPostsForApp's own card count
 * convention (APP_RELATED_POSTS_LIMIT) — one consistent "small related
 * section" size across the site rather than a fourth different number.
 */
const RELATED_ARTICLES_LIMIT = 4;

/**
 * "Related Articles" for the individual blog article page itself (distinct
 * from getBlogPostsForApp/getPrimaryBlogPostsForApp, which power the *app*
 * detail page's article sections) — other published posts in the same
 * category, excluding this post itself. Reuses getPublishedPostsByCategory
 * verbatim rather than a new query: fetches one extra row over the limit so
 * excluding the current post (when it's part of the same category, the
 * common case) still leaves a full page of genuinely different suggestions.
 *
 * `post.category` is cast to BlogCategory rather than re-validated: the
 * database's own `blog_posts_category_check` CHECK constraint already
 * guarantees every real row's category is one of the canonical values.
 */
export async function getRelatedArticles(
  post: Pick<BlogPost, "id" | "category">,
  limit = RELATED_ARTICLES_LIMIT,
): Promise<BlogSummary[]> {
  const rows = await getPublishedPostsByCategory(post.category as BlogCategory, limit + 1);
  return rows.filter((row) => row.id !== post.id).slice(0, limit);
}

export type PublishedPostsPage = {
  posts: BlogSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  category: string;
  search: string;
};

/**
 * Escapes ILIKE's own wildcard characters ("%", "_") so a literal one typed
 * into the public search box is matched literally — the same fix Task 9
 * (lib/admin.ts's escapeIlikePattern) applies for the admin list. Kept as
 * its own private copy here rather than imported from lib/admin.ts: this
 * file is the public, cookie-less read path and must not depend on the
 * authenticated admin module, and every other query helper in this file
 * already follows "own query, own transform" rather than a shared
 * cross-file query-building utility (see getPublishedPostsByCategory's own
 * doc comment above).
 */
function escapeIlikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * PostgREST's `.or()`/`.and()` mini-language treats ",", ".", "(" and ")" as
 * structural filter separators. Wrapping a filter value in double quotes
 * removes it from that parser's consideration entirely — the value is taken
 * literally up to the matching closing quote — so a search term containing
 * any of those characters (or a literal double quote/backslash, escaped
 * here for the quoting layer itself) can never be misread as more filters.
 */
function quoteForOrFilter(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Server-side-filtered, server-side-paginated public listing query for
 * app/blog/page.tsx — Phase 1 Task 10B (C1). Replaces that page's previous
 * pattern of calling getPublishedPosts() (every published post, full
 * BlogSummary shape) and then filtering/sorting/slicing the complete array
 * in JavaScript, in both generateMetadata() and the page body separately.
 *
 * Every filter here compiles to a real WHERE clause
 * (.eq()/.not()/.or()/.ilike()), ordering to ORDER BY (.order() with an
 * `id DESC` tiebreaker), and pagination to LIMIT/OFFSET (.range()) —
 * Postgres returns only the rows one page needs, plus an exact count (in
 * the same request) for canonical/pager clamping.
 *
 * Deliberately NOT wrapped in unstable_cache, unlike getPublishedPosts()
 * above: a cache key would need to vary by category/search/page, and an
 * arbitrary user-typed search string is exactly the kind of unbounded
 * cache-key input Next's own docs warn against. /blog is already
 * `force-dynamic`, so there is no caching benefit to lose — the same
 * reasoning Task 7's getPublishedPostsByCategory() and Task 4's
 * getBlogPostsForApp() above already apply to their own parameterized
 * reads.
 *
 * Retired slugs (RETIRED_SLUGS) are excluded at the database layer via
 * `.not("slug", "in", ...)` rather than over-fetched-and-filtered in
 * JavaScript (the approach getAdjacentPosts() above uses for its own,
 * different single-row-per-side lookup). For a paginated *list*, DB-level
 * exclusion is exact rather than approximate: .range()/count both operate
 * over the true set of eligible rows, so a retired post can never occupy a
 * page boundary, shift a live post onto the wrong page, or make a page show
 * fewer than pageSize results — none of the caveats an over-fetch buffer
 * would have needed to document actually apply here.
 *
 * PostgREST rejects (`PGRST103`, "Requested range not satisfiable") a
 * `.range()` whose *start* offset is at or beyond the filtered row count,
 * rather than returning an empty page the way a plain SQL OFFSET would —
 * confirmed against a live Supabase instance while building this function,
 * on both an out-of-range page and a genuinely empty (zero-match) result. A
 * combined count+range request therefore cannot be the only path: this
 * function tries it first (satisfying "count from the same query" for the
 * ordinary, in-range case), and only on that specific error falls back to a
 * separate, still-bounded, head-only count to compute the real last page
 * (or detect zero results) before ever issuing a second, now-satisfiable
 * range request.
 */
export async function getPublishedPostsPaged({
  category,
  search,
  page,
}: {
  category?: string;
  search?: string;
  page?: string;
}): Promise<PublishedPostsPage> {
  const normalisedCategory = normaliseBlogCategory(category);
  const normalisedSearch = (search ?? "").trim();
  const requestedPage = normalisePage(page);
  const pageSize = POSTS_PER_PAGE;

  function buildFilteredQuery(
    select: string,
    options?: { count?: "exact"; head?: boolean },
  ) {
    let query = supabase
      .from("blog_posts")
      .select(select, options)
      .eq("published", true);

    if (RETIRED_SLUGS.length > 0) {
      const retiredList = RETIRED_SLUGS.map((slug) => `"${slug}"`).join(",");
      query = query.not("slug", "in", `(${retiredList})`);
    }

    if (normalisedCategory) {
      query = query.eq("category", normalisedCategory);
    }

    if (normalisedSearch) {
      // Preserves the exact existing public search semantics: title OR
      // description OR author, case-insensitive substring — see this
      // page's own matches() before this task, now expressed as one
      // database-level OR instead of three JavaScript comparisons.
      const pattern = quoteForOrFilter(`%${escapeIlikeWildcards(normalisedSearch)}%`);
      query = query.or(
        `title.ilike.${pattern},description.ilike.${pattern},author.ilike.${pattern}`,
      );
    }

    // A secondary `id` tiebreaker keeps .range() pagination deterministic
    // even when multiple posts share the same created_at value.
    return query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
  }

  const columns = `${LIST_COLUMNS}, content`;
  const from = (requestedPage - 1) * pageSize;
  const to = from + pageSize - 1;

  const primary = await buildFilteredQuery(columns, { count: "exact" })
    .range(from, to)
    .returns<BlogPost[]>();

  let rows: BlogPost[];
  let total: number;
  let servedPage: number;

  if (primary.error?.code === "PGRST103") {
    // The requested page is either beyond the real last page, or there are
    // zero matching rows at all (offset 0 is also "beyond the end" of an
    // empty result). Either way, find out how many rows actually match
    // before asking for any of them.
    const countOnly = await buildFilteredQuery("id", { count: "exact", head: true });
    total = resolveQueryResult(countOnly.count, countOnly.error, "getPublishedPostsPaged: Supabase query failed") ?? 0;

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    servedPage = Math.min(requestedPage, totalPages);

    if (total === 0) {
      rows = [];
    } else {
      const clampedFrom = (servedPage - 1) * pageSize;
      const clampedTo = clampedFrom + pageSize - 1;
      const retry = await buildFilteredQuery(columns)
        .range(clampedFrom, clampedTo)
        .returns<BlogPost[]>();
      rows =
        resolveQueryResult(retry.data, retry.error, "getPublishedPostsPaged: Supabase query failed") ?? [];
    }
  } else {
    rows =
      resolveQueryResult(primary.data, primary.error, "getPublishedPostsPaged: Supabase query failed") ?? [];
    total = primary.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    servedPage = Math.min(requestedPage, totalPages);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const posts: BlogSummary[] = rows.map(({ content, ...rest }) => ({
    ...rest,
    excerptText: rest.description || excerpt(content),
    readMinutes: readingTime(content),
  }));

  return {
    posts,
    page: servedPage,
    pageSize,
    total,
    totalPages,
    category: normalisedCategory,
    search: normalisedSearch,
  };
}
