import Link from "next/link";
import BlogEditor from "@/components/admin/BlogEditor";
import BlogPostsTable from "@/components/admin/BlogPostsTable";
import type { PickerApp } from "@/components/admin/RelatedAppPicker";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABELS, type BlogSummary } from "@/lib/blog";
import { formatCount, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "write", label: "Write" },
  { key: "posts", label: "All Posts" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function AdminBlogPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: TabKey = TABS.some((t) => t.key === tab)
    ? (tab as TabKey)
    : "overview";

  const supabase = await createClient();

  // The admin RLS policy exposes drafts here, unlike the public blog queries.
  const [postsRes, appsRes] = await Promise.all([
    supabase
      .from("blog_posts")
      .select(
        "id, slug, title, description, featured_image_url, author, category, related_app_ids, published, view_count, created_at, updated_at",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("apps")
      .select("id, name, category")
      .order("name")
      .returns<PickerApp[]>(),
  ]);

  const posts: BlogSummary[] = (postsRes.data ?? []).map((row) => ({
    ...row,
    excerptText: row.description,
    readMinutes: 0,
  })) as BlogSummary[];

  const apps = appsRes.data ?? [];

  const published = posts.filter((p) => p.published);
  const totalViews = posts.reduce((sum, p) => sum + (p.view_count ?? 0), 0);
  const mostViewed = [...posts].sort((a, b) => b.view_count - a.view_count)[0];

  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Blog</h2>
      <p className="mt-1 text-sm text-fg-muted">
        {posts.length} post{posts.length === 1 ? "" : "s"} — {published.length}{" "}
        published, {posts.length - published.length} draft.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2 border-b border-base-800 pb-3">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/blog?tab=${t.key}`}
            className={`rounded-lg px-3.5 py-2 text-sm transition-colors ${
              active === t.key
                ? "bg-base-800 font-medium text-fg"
                : "text-fg-muted hover:text-fg"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {postsRes.error && (
        <p className="mt-4 rounded-xl border border-danger-500/40 bg-danger-500/10 p-3 text-sm text-danger-300">
          {postsRes.error.message}
        </p>
      )}

      <div className="mt-6">
        {active === "overview" && (
          <div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Total posts" value={String(posts.length)} />
              <Stat label="Published" value={String(published.length)} />
              <Stat label="Total views" value={formatCount(totalViews)} />
              <Stat
                label="Most viewed"
                value={mostViewed ? formatCount(mostViewed.view_count) : "—"}
                sub={mostViewed?.title}
              />
            </div>

            <h3 className="mt-10 text-sm font-semibold tracking-wider text-fg-dim uppercase">
              Recent posts
            </h3>
            {posts.length === 0 ? (
              <p className="mt-4 rounded-xl border border-base-800 bg-base-900 p-6 text-sm text-fg-muted">
                Nothing written yet.{" "}
                <Link href="/admin/blog?tab=write" className="text-brand-400 hover:underline">
                  Write the first post
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {posts.slice(0, 5).map((post) => (
                  <li
                    key={post.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-base-800 bg-base-900 p-4"
                  >
                    <Link
                      href={`/admin/blog/${post.id}/edit`}
                      className="min-w-0 flex-1 truncate font-medium text-fg hover:text-brand-400"
                    >
                      {post.title}
                    </Link>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        post.published
                          ? "bg-brand-500/10 text-brand-300"
                          : "bg-base-800 text-fg-dim"
                      }`}
                    >
                      {post.published ? "Published" : "Draft"}
                    </span>
                    <span className="text-xs text-fg-dim">
                      {formatDate(post.created_at)}
                    </span>
                    <span className="text-xs text-azure-400">
                      {formatCount(post.view_count)} views
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {active === "write" && <BlogEditor apps={apps} />}

        {active === "posts" && <BlogPostsTable posts={posts} />}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-base-800 bg-base-900 p-5">
      <p className="text-xs text-fg-dim">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 truncate text-xs text-fg-muted">{sub}</p>}
    </div>
  );
}
