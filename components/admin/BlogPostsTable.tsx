"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatCount } from "@/lib/format";
import { BLOG_CATEGORIES, CATEGORY_LABELS, type BlogSummary } from "@/lib/blog";
import { buildPreviewHref } from "@/lib/blog-preview";
import type { AdminBlogSort, AdminBlogStatusFilter } from "@/lib/admin";

export default function BlogPostsTable({
  posts,
  total,
  page,
  pageSize,
  totalPages,
  status,
  category,
  search,
  sort,
}: {
  posts: BlogSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  status: AdminBlogStatusFilter;
  category: string;
  search: string;
  sort: AdminBlogSort;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(search);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

  /*
   * Keep the search box honest across back/forward navigation: this
   * component survives that navigation (Next re-renders it with new props
   * rather than remounting it), so `query` would otherwise still show
   * whatever was last typed. Same "adjust state during render" pattern as
   * components/blog/BlogFilters.tsx.
   */
  const [prevSearch, setPrevSearch] = useState(search);
  if (search !== prevSearch) {
    setPrevSearch(search);
    setQuery(search);
  }

  /*
   * Filtering, sorting and pagination now all live in the URL and drive the
   * server-side query in lib/admin.ts's getAdminBlogPosts — this pushes a
   * new URL rather than filtering `posts` in place, the same push/replace
   * pattern components/blog/BlogFilters.tsx already uses for the public
   * listing. Changing any filter resets back to page 1; only the Prev/Next
   * controls below set an explicit page.
   */
  function go(
    next: Partial<{
      q: string;
      status: AdminBlogStatusFilter;
      category: string;
      sort: AdminBlogSort;
      page: number;
    }>,
    mode: "push" | "replace",
  ) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "posts");

    const nextQuery = next.q ?? query;
    const nextStatus = next.status ?? status;
    const nextCategory = next.category ?? category;
    const nextSort = next.sort ?? sort;
    const nextPage = next.page ?? 1;

    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    else params.delete("q");

    if (nextStatus !== "all") params.set("status", nextStatus);
    else params.delete("status");

    if (nextCategory) params.set("category", nextCategory);
    else params.delete("category");

    if (nextSort !== "newest") params.set("sort", nextSort);
    else params.delete("sort");

    if (nextPage > 1) params.set("page", String(nextPage));
    else params.delete("page");

    const qs = params.toString();
    const url = qs ? `/admin/blog?${qs}` : "/admin/blog";
    if (mode === "push") router.push(url);
    else router.replace(url);
  }

  const allShownSelected =
    posts.length > 0 && posts.every((r) => selected.includes(r.id));

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
          onChange={(e) => {
            setQuery(e.target.value);
            go({ q: e.target.value }, "replace");
          }}
          placeholder="Search titles…"
          className="min-w-48 flex-1 rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={status}
          onChange={(e) => go({ status: e.target.value as AdminBlogStatusFilter }, "push")}
          aria-label="Filter by status"
          className="rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <select
          value={category}
          onChange={(e) => go({ category: e.target.value }, "push")}
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
          onChange={(e) => go({ sort: e.target.value as AdminBlogSort }, "push")}
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

      {posts.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-base-800 bg-base-900 p-8 text-center text-fg-muted">
          No posts match those filters.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-base-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-base-850 text-xs text-fg-dim">
              <tr>
                <th className="w-10 px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allShownSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? posts.map((r) => r.id) : [])
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
              {posts.map((post, index) => (
                <tr key={post.id}>
                  <td className="px-4 py-3 text-xs tabular-nums text-fg-dim">
                    {(page - 1) * pageSize + index + 1}
                  </td>
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
                        href={buildPreviewHref(post.id)}
                        target="_blank"
                        rel="noopener noreferrer"
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

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted">
          <p>
            Page {page} of {totalPages} — {total} post{total === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <button
                type="button"
                onClick={() => go({ page: page - 1 }, "push")}
                className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
              >
                ‹ Prev
              </button>
            ) : (
              <span
                aria-disabled="true"
                className="rounded-lg border border-base-800 px-3 py-1.5 text-xs text-fg-dim opacity-40"
              >
                ‹ Prev
              </span>
            )}
            {page < totalPages ? (
              <button
                type="button"
                onClick={() => go({ page: page + 1 }, "push")}
                className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-muted hover:text-fg"
              >
                Next ›
              </button>
            ) : (
              <span
                aria-disabled="true"
                className="rounded-lg border border-base-800 px-3 py-1.5 text-xs text-fg-dim opacity-40"
              >
                Next ›
              </span>
            )}
          </div>
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
