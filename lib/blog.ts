import { unstable_cache } from "next/cache";
import { supabase } from "@/lib/supabase/public";
import { toSummary } from "@/lib/catalogue";
import type { AppSummary, AppWithVersions } from "@/lib/types";
import { excerpt, readingTime } from "@/lib/markdown";

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

export const POSTS_PER_PAGE = 10;

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
  const { data } = await supabase
    .from("blog_posts")
    .select(`${LIST_COLUMNS}, content`)
    .eq("published", true)
    .order("created_at", { ascending: false })
    .returns<BlogPost[]>();

  return (data ?? []).map(({ content, ...rest }) => ({
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

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data } = await supabase
    .from("blog_posts")
    .select(`${LIST_COLUMNS}, content`)
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle<BlogPost>();
  return data;
}

/** Slugs for generateStaticParams — without it the segment is not ISR. */
export async function getPublishedSlugs(): Promise<string[]> {
  const { data } = await supabase
    .from("blog_posts")
    .select("slug")
    .eq("published", true)
    .returns<{ slug: string }[]>();
  return (data ?? []).map((row) => row.slug);
}

/**
 * Neighbours by publish date, for the footer links. Returns the post published
 * just before and just after this one.
 */
export async function getAdjacentPosts(post: BlogPost): Promise<{
  previous: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}> {
  const [olderRes, newerRes] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("slug, title")
      .eq("published", true)
      .lt("created_at", post.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ slug: string; title: string }>(),
    supabase
      .from("blog_posts")
      .select("slug, title")
      .eq("published", true)
      .gt("created_at", post.created_at)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ slug: string; title: string }>(),
  ]);

  return { previous: olderRes.data, next: newerRes.data };
}

const APP_SELECT =
  "*, versions(version_name, version_code, file_size, min_android_version, uploaded_at, scanned_at, scan_status)";

/**
 * Sidebar apps. Falls back to the most-downloaded apps when a post names none,
 * so the sidebar is never an empty box.
 *
 * related_app_ids is a text[] of uuids, which Postgres cannot constrain with a
 * foreign key — a deleted app simply drops out of the result rather than
 * breaking the query.
 */
export async function getRelatedApps(
  ids: string[],
  limit = 6,
): Promise<{ apps: AppSummary[]; fallback: boolean }> {
  if (ids.length > 0) {
    const { data } = await supabase
      .from("apps")
      .select(APP_SELECT)
      .in("id", ids)
      .limit(limit)
      .returns<AppWithVersions[]>();

    if (data && data.length > 0) {
      // Preserve the order the author chose rather than whatever Postgres
      // returns.
      const order = new Map(ids.map((id, index) => [id, index]));
      const sorted = [...data].sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      );
      return { apps: sorted.map(toSummary), fallback: false };
    }
  }

  const { data } = await supabase
    .from("apps")
    .select(APP_SELECT)
    .order("download_count", { ascending: false })
    .limit(limit)
    .returns<AppWithVersions[]>();

  return { apps: (data ?? []).map(toSummary), fallback: true };
}
