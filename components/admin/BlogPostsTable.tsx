"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatCount } from "@/lib/format";
import { BLOG_CATEGORIES, CATEGORY_LABELS, type BlogSummary } from "@/lib/blog";

type Sort = "newest" | "title" | "views";

export default function BlogPostsTable({ posts }: { posts: BlogSummary[] }) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  /*
   * Seeded from ?status= so the admin bar's "3 drafts" chip lands here with
   * the filter already applied, rather than dropping the admin into an
   * unfiltered table they then have to narrow by hand.
   */
  const params = useSearchParams();
  const initialStatus = params.get("status");
  const [status, setStatus] = useState<"all" | "published" | "draft">(
    initialStatus === "draft" || initialStatus === "published"
      ? initialStatus
      : "all",
  );
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = posts.filter((post) => {
      if (needle && !post.title.toLowerCase().includes(needle)) return false;
      if (status === "published" && !post.published) return false;
      if (status === "draft" && post.published) return false;
      if (category && post.category !== category) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "views")
      sorted.sort((a, b) => b.view_count - a.view_count);
    else sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return sorted;
  }, [posts, query, status, category, sort]);

  const allShownSelected =
    rows.length > 0 && rows.every((r) => selected.includes(r.id));

  async function run(
    ids: string[],
    action: "publish" | "unpublish" | "delete",
  ) {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();

    try {
      if (action === "delete") {
        const { error: e } = await supabase
          .from("blog_posts")
          .delete()
          .in("id", ids);
        if (e) throw e;
      } else {
        const { error: e } = await supabase
          .from("blog_posts")
          .update({ published: action === "publish" })
          .in("id", ids);
        if (e) throw e;
      }

      await fetch("/api/admin/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Any blog write invalidates the listing; the slug just adds the
        // detail path when a single post is involved.
        body: JSON.stringify({
          blogSlug:
            ids.length === 1
              ? (posts.find((p) => p.id === ids[0])?.slug ?? "unknown")
              : "unknown",
        }),
      }).catch(() => {});

      setSelected([]);
      setConfirmDelete(null);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* ---- Controls ---- */}
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles…"
          className="min-w-48 flex-1 rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filter by status"
          className="rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
        >
          <option value="">All categories</option>
          {BLOG_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort"
          className="rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
        >
          <option value="newest">Newest first</option>
          <option value="title">Title A–Z</option>
          <option value="views">Most viewed</option>
        </select>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-danger-500/40 bg-danger-500/10 p-3 text-sm text-danger-300">
          {error}
        </p>
      )}

      {/* ---- Bulk bar ---- */}
      {selected.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-500/40 bg-brand-500/10 p-3">
          <span className="text-sm text-brand-300">
            {selected.length} selected
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(selected, "publish")}
            className="rounded-lg border border-base-700 bg-base-900 px-3 py-1.5 text-xs text-fg-muted hover:text-fg disabled:opacity-40"
          >
            Publish
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(selected, "unpublish")}
            className="rounded-lg border border-base-700 bg-base-900 px-3 py-1.5 text-xs text-fg-muted hover:text-fg disabled:opacity-40"
          >
            Unpublish
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(selected)}
            className="rounded-lg border border-danger-500/40 bg-base-900 px-3 py-1.5 text-xs text-danger-300 hover:bg-danger-500/10 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-base-800 bg-base-900 p-8 text-center text-fg-muted">
          No posts match those filters.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-base-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-base-850 text-xs text-fg-dim">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allShownSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? rows.map((r) => r.id) : [])
                    }
                  />
                </th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Author</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Views</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-base-800 bg-base-900">
              {rows.map((post) => (
                <tr key={post.id}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${post.title}`}
                      checked={selected.includes(post.id)}
                      onChange={(e) =>
                        setSelected((cur) =>
                          e.target.checked
                            ? [...cur, post.id]
                            : cur.filter((id) => id !== post.id),
                        )
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/blog/${post.id}/edit`}
                      className="font-medium text-fg hover:text-brand-400"
                    >
                      {post.title}
                    </Link>
                    <p className="font-mono text-xs text-fg-dim">
                      /blog/{post.slug}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {CATEGORY_LABELS[
                      post.category as keyof typeof CATEGORY_LABELS
                    ] ?? post.category}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{post.author}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        post.published
                          ? "bg-brand-500/10 text-brand-300"
                          : "bg-base-800 text-fg-dim"
                      }`}
                    >
                      {post.published ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {formatDate(post.created_at)}
                  </td>
                  <td className="px-4 py-3 text-fg-muted">
                    {formatCount(post.view_count)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Link
                        href={`/admin/blog/${post.id}/edit`}
                        className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/blog/${post.slug}`}
                        target="_blank"
                        className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
                      >
                        Preview
                      </Link>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmDelete([post.id])}
                        className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-danger-300 hover:bg-danger-500/10 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-base-700 bg-base-900 p-6"
          >
            <h3 className="text-lg font-bold">
              Delete {confirmDelete.length} post
              {confirmDelete.length === 1 ? "" : "s"}?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              This cannot be undone. Any links to{" "}
              {confirmDelete.length === 1 ? "this post" : "these posts"} will
              start returning 404.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(confirmDelete, "delete")}
                className="rounded-xl bg-danger-500 px-5 py-2.5 text-sm font-semibold text-base-950 disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl border border-base-700 px-5 py-2.5 text-sm text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
