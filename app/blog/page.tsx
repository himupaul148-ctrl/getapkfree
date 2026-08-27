import type { Metadata } from "next";
import Link from "next/link";
import BlogCard from "@/components/blog/BlogCard";
import BlogFilters from "@/components/blog/BlogFilters";
import {
  CATEGORY_LABELS,
  POSTS_PER_PAGE,
  getPublishedPosts,
  normaliseBlogCategory,
  normalisePage,
  type BlogCategory,
  type BlogSummary,
} from "@/lib/blog";
import { SITE_NAME, absolute } from "@/lib/seo";

// searchParams drive the filters and the page number, which makes this route
// dynamic. The query underneath is cached, so Supabase is still hit once an
// hour rather than once a visitor.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Same reason as the detail page: this is already the full title.
  title: { absolute: "GetApkFree Blog — App guides and recommendations" },
  description:
    "Guides, tips and app recommendations from the GetApkFree team. Find the best open-source Android apps for privacy, productivity, gaming and more.",
  alternates: { canonical: absolute("/blog") },
  openGraph: {
    type: "website",
    url: absolute("/blog"),
    title: `Blog | ${SITE_NAME}`,
    description:
      "Guides, tips and app recommendations from the GetApkFree team.",
  },
  twitter: {
    card: "summary_large_image",
    title: `Blog | ${SITE_NAME}`,
    description:
      "Guides, tips and app recommendations from the GetApkFree team.",
  },
};

function matches(post: BlogSummary, needle: string): boolean {
  return (
    post.title.toLowerCase().includes(needle) ||
    post.description.toLowerCase().includes(needle) ||
    post.author.toLowerCase().includes(needle)
  );
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const category = normaliseBlogCategory(params.category);
  const needle = query.toLowerCase();

  const all = await getPublishedPosts();

  const filtered = all.filter((post) => {
    if (needle && !matches(post, needle)) return false;
    if (category && post.category !== category) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / POSTS_PER_PAGE));
  // Clamp rather than 404: a stale link to ?page=9 should still show something.
  const page = Math.min(normalisePage(params.page), totalPages);
  const start = (page - 1) * POSTS_PER_PAGE;
  const posts = filtered.slice(start, start + POSTS_PER_PAGE);

  function pageHref(target: number) {
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    if (category) qs.set("category", category);
    if (target > 1) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `/blog?${s}` : "/blog";
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <header className="max-w-3xl">
        <p className="font-mono text-sm text-brand-400">GetApkFree Blog</p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
          Tips, guides, and app recommendations
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          What to install, what to avoid, and how to get the most out of
          open-source Android apps.
        </p>
      </header>

      <BlogFilters initialQuery={query} initialCategory={category} />

      {all.length === 0 ? (
        <p className="mt-12 rounded-2xl border border-base-800 bg-base-900 p-10 text-center text-fg-muted">
          No posts yet. Check back soon!
        </p>
      ) : filtered.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-base-800 bg-base-900 p-10 text-center">
          <p className="text-fg-muted">
            No posts match{" "}
            {query && <span className="text-fg">“{query}”</span>}
            {query && category && " in "}
            {category && (
              <span className="text-fg">
                {CATEGORY_LABELS[category as BlogCategory]}
              </span>
            )}
            .
          </p>
          <Link
            href="/blog"
            className="mt-4 inline-block text-sm text-brand-400 hover:underline"
          >
            Clear filters
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-8 text-sm text-fg-dim">
            Showing {start + 1}–{start + posts.length} of {filtered.length} post
            {filtered.length === 1 ? "" : "s"}
          </p>

          <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <BlogCard key={post.id} post={post} />
            ))}
          </div>

          {totalPages > 1 && (
            <nav
              aria-label="Blog pages"
              className="mt-12 flex flex-wrap items-center justify-center gap-2"
            >
              {page > 1 && (
                <Link
                  href={pageHref(page - 1)}
                  rel="prev"
                  className="rounded-lg border border-base-700 px-3.5 py-2 text-sm text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
                >
                  ‹ Prev
                </Link>
              )}

              {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) =>
                n === page ? (
                  <span
                    key={n}
                    aria-current="page"
                    className="rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-base-950"
                  >
                    {n}
                  </span>
                ) : (
                  <Link
                    key={n}
                    href={pageHref(n)}
                    className="rounded-lg border border-base-700 px-3.5 py-2 text-sm text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
                  >
                    {n}
                  </Link>
                ),
              )}

              {page < totalPages && (
                <Link
                  href={pageHref(page + 1)}
                  rel="next"
                  className="rounded-lg border border-base-700 px-3.5 py-2 text-sm text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
                >
                  Next ›
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
