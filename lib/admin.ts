import { createClient, getUser } from "@/lib/supabase/server";
import { normaliseBlogCategory, normalisePage, type BlogSummary } from "@/lib/blog";

/**
 * Admin status is read from the database, never from the client. The same
 * `is_admin()` predicate backs the RLS policies, so the UI check and the
 * enforcement cannot disagree — hiding the panel is convenience, RLS is what
 * actually stops a non-admin writing.
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();

  return data?.is_admin === true;
}

export type AdminStats = {
  apps: number;
  versions: number;
  publishedVersions: number;
  downloads: number;
};

export type RecentUpload = {
  id: string;
  versionName: string;
  published: boolean;
  uploadedAt: string;
  appName: string | null;
  appSlug: string | null;
};

export async function getAdminStats(): Promise<{
  stats: AdminStats;
  recent: RecentUpload[];
}> {
  const supabase = await createClient();

  const [appsRes, versionsRes, publishedRes, countsRes, recentRes] =
    await Promise.all([
      supabase.from("apps").select("id", { count: "exact", head: true }),
      supabase.from("versions").select("id", { count: "exact", head: true }),
      supabase
        .from("versions")
        .select("id", { count: "exact", head: true })
        .eq("published", true),
      // Sum client-side: PostgREST has no SUM without an RPC, and 48 rows is
      // cheaper to add up here than a migration for an aggregate view.
      supabase.from("apps").select("download_count"),
      supabase
        .from("versions")
        .select("id, version_name, published, uploaded_at, apps(name, slug)")
        .order("uploaded_at", { ascending: false })
        .limit(8)
        .returns<
          {
            id: string;
            version_name: string;
            published: boolean;
            uploaded_at: string;
            apps: { name: string; slug: string } | null;
          }[]
        >(),
    ]);

  const downloads = (countsRes.data ?? []).reduce(
    (sum, row: { download_count: number | null }) => sum + (row.download_count ?? 0),
    0,
  );

  return {
    stats: {
      apps: appsRes.count ?? 0,
      versions: versionsRes.count ?? 0,
      publishedVersions: publishedRes.count ?? 0,
      downloads,
    },
    recent: (recentRes.data ?? []).map((row) => ({
      id: row.id,
      versionName: row.version_name,
      published: row.published,
      uploadedAt: row.uploaded_at,
      appName: row.apps?.name ?? null,
      appSlug: row.apps?.slug ?? null,
    })),
  };
}

const BLOG_LIST_COLUMNS =
  "id, slug, title, description, featured_image_url, author, category, related_app_ids, published, view_count, created_at, updated_at";

export type AdminBlogOverviewStats = {
  total: number;
  published: number;
  totalViews: number;
  mostViewed: { title: string; view_count: number } | null;
};

export type AdminBlogRecentPost = {
  id: string;
  title: string;
  published: boolean;
  created_at: string;
  view_count: number;
};

/**
 * Header/Overview-tab stats for /admin/blog. Previously derived in the page
 * itself from the same unbounded `select(...)` that also fed the "All Posts"
 * table — every stat here is now its own small, targeted query instead, so
 * viewing (or just loading) the Blog admin page never pulls every column of
 * every post merely to show four numbers and five recent titles.
 *
 * totalViews has no SUM without a database RPC — same constraint
 * getAdminStats() above already documents for `downloads` — so it selects
 * just the one narrow `view_count` column across every row and adds it up
 * here, rather than the previous query's full 12-column row per post.
 */
export async function getAdminBlogOverview(): Promise<{
  stats: AdminBlogOverviewStats;
  recent: AdminBlogRecentPost[];
}> {
  const supabase = await createClient();

  const [totalRes, publishedRes, viewsRes, mostViewedRes, recentRes] =
    await Promise.all([
      supabase.from("blog_posts").select("id", { count: "exact", head: true }),
      supabase
        .from("blog_posts")
        .select("id", { count: "exact", head: true })
        .eq("published", true),
      supabase.from("blog_posts").select("view_count"),
      supabase
        .from("blog_posts")
        .select("title, view_count")
        .order("view_count", { ascending: false })
        .limit(1)
        .maybeSingle<{ title: string; view_count: number }>(),
      supabase
        .from("blog_posts")
        .select("id, title, published, created_at, view_count")
        .order("created_at", { ascending: false })
        .limit(5)
        .returns<AdminBlogRecentPost[]>(),
    ]);

  const totalViews = (viewsRes.data ?? []).reduce(
    (sum, row: { view_count: number }) => sum + (row.view_count ?? 0),
    0,
  );

  return {
    stats: {
      total: totalRes.count ?? 0,
      published: publishedRes.count ?? 0,
      totalViews,
      mostViewed: mostViewedRes.data ?? null,
    },
    recent: recentRes.data ?? [],
  };
}

export type AdminBlogStatusFilter = "all" | "published" | "draft";
export type AdminBlogSort = "newest" | "title" | "views";

/** No established page size existed before this (the list was unbounded). */
export const ADMIN_BLOG_PAGE_SIZE = 20;

function normaliseStatus(raw: string | undefined): AdminBlogStatusFilter {
  return raw === "draft" || raw === "published" ? raw : "all";
}

function normaliseSort(raw: string | undefined): AdminBlogSort {
  return raw === "title" || raw === "views" ? raw : "newest";
}

/**
 * Escapes ILIKE's own wildcard characters ("%", "_") so a literal one typed
 * into the search box is matched literally — the exact substring semantics
 * BlogPostsTable's previous client-side `.includes(needle)` search already
 * had, which a raw, unescaped `%name%` pattern would silently change.
 */
function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type AdminBlogListParams = {
  page?: string;
  status?: string;
  category?: string;
  q?: string;
  sort?: string;
};

export type AdminBlogListResult = {
  posts: BlogSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  status: AdminBlogStatusFilter;
  category: string;
  search: string;
  sort: AdminBlogSort;
  error: string | null;
};

/**
 * Server-side-filtered, server-side-paginated admin post listing — Phase 1
 * Task 9. Replaces app/admin/blog/page.tsx's previous unbounded fetch of
 * every blog_posts row (followed by BlogPostsTable's own client-side
 * `.filter()`/`.sort()` over the full set) with a single Supabase request
 * per page view: every filter compiles to a real WHERE clause
 * (.eq()/.ilike()), ordering to ORDER BY (.order()), and pagination to
 * LIMIT/OFFSET (.range()) — Postgres returns only the rows one page needs,
 * plus an exact count (in the same request) for the pager.
 *
 * Lives here rather than lib/blog.ts, which is the public, cookie-less,
 * RLS-anonymous read path for the published site — this query runs through
 * the authenticated, cookie-bound admin client (same as the rest of this
 * file), so drafts are visible here exactly as they were before, and only to
 * an admin, via the same RLS policy as always.
 */
export async function getAdminBlogPosts(
  params: AdminBlogListParams,
): Promise<AdminBlogListResult> {
  const status = normaliseStatus(params.status);
  const category = normaliseBlogCategory(params.category);
  const search = (params.q ?? "").trim();
  const sort = normaliseSort(params.sort);
  const pageSize = ADMIN_BLOG_PAGE_SIZE;

  const supabase = await createClient();

  function buildQuery() {
    let query = supabase
      .from("blog_posts")
      .select(BLOG_LIST_COLUMNS, { count: "exact" });

    if (status === "published") query = query.eq("published", true);
    else if (status === "draft") query = query.eq("published", false);

    if (category) query = query.eq("category", category);

    if (search) {
      query = query.ilike("title", `%${escapeIlikePattern(search)}%`);
    }

    // A secondary `id` tiebreaker keeps .range() pagination deterministic
    // even when many rows share the same title/view_count/created_at value.
    if (sort === "title") {
      query = query.order("title", { ascending: true }).order("id", { ascending: true });
    } else if (sort === "views") {
      query = query.order("view_count", { ascending: false }).order("id", { ascending: true });
    } else {
      query = query.order("created_at", { ascending: false }).order("id", { ascending: true });
    }

    return query;
  }

  const requestedPage = normalisePage(params.page);
  const from = (requestedPage - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await buildQuery().range(from, to);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);

  // An out-of-range page (e.g. ?page=999 on a 3-page list) means the rows
  // just fetched don't match the clamped page — refetch the real last page
  // rather than showing an empty table for a stale/malformed page number.
  let rows = data ?? [];
  if (!error && page !== requestedPage) {
    const clampedFrom = (page - 1) * pageSize;
    const clampedTo = clampedFrom + pageSize - 1;
    const refetch = await buildQuery().range(clampedFrom, clampedTo);
    rows = refetch.data ?? [];
  }

  const posts: BlogSummary[] = rows.map((row) => ({
    ...row,
    excerptText: row.description,
    readMinutes: 0,
  })) as BlogSummary[];

  return {
    posts,
    page,
    pageSize,
    total,
    totalPages,
    status,
    category,
    search,
    sort,
    error: error?.message ?? null,
  };
}
