import type { Metadata } from "next";
import Link from "next/link";
import BlogCard from "@/components/blog/BlogCard";
import BlogFilters from "@/components/blog/BlogFilters";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";
import {
  CATEGORY_LABELS,
  getPublishedPostsPaged,
  type BlogCategory,
} from "@/lib/blog";
import { SITE_NAME, absolute, blogCategoryMetaDescription, clampDescription } from "@/lib/seo";

const BASE_BLOG_TITLE = "GetApkFree Blog — App guides and recommendations";
const BASE_BLOG_DESCRIPTION =
  "Guides, tips and app recommendations from the GetApkFree team. Find the best open-source Android apps for privacy, productivity, gaming and more.";

// searchParams drive the filters and the page number, which makes this route
// dynamic. getPublishedPostsPaged() is not cached (see its own doc comment
// in lib/blog.ts), but it is bounded — a request here is one small,
// filtered, .range()-limited Supabase query, not a full-table scan.
export const dynamic = "force-dynamic";

/**
 * Mirrors the homepage's per-filter metadata pattern (app/page.tsx): a search
 * is noindexed and points back at the plain listing, while a page number or
 * category is a real, self-referencing, indexable URL rather than always
 * canonicalizing to page 1 — the latter was actively telling crawlers to
 * ignore every page beyond the first, which only gets worse as more posts
 * push older ones past page one.
 *
 * Title/description vary the same way the canonical URL already did before
 * this fix: every category and every page beyond the first is a distinct,
 * self-canonicalized, indexable URL (confirmed by `robots` below), so each
 * needs its own title/description rather than the one generic pair every
 * such URL used to share — the exact P1 SEO gap this fix closes. A search
 * result (robots: noindex) intentionally keeps the plain base title/
 * description: it is not meant to be a distinct indexed page in the first
 * place, so there is nothing to differentiate it *for*.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const query = (params.q ?? "").trim();

  let canonicalPath = "/blog";
  let robots: Metadata["robots"] = { index: true, follow: true };
  let title: string = BASE_BLOG_TITLE;
  let description: string = BASE_BLOG_DESCRIPTION;

  if (query) {
    // Same treatment as the homepage's search results: useful to share, not
    // worth indexing as its own page — it canonicalises back to the plain
    // listing rather than to a query string full of one visitor's input.
    // Title/description stay generic too, for the same reason: a search
    // result is never the page these are meant to distinguish.
    robots = { index: false, follow: true };
  } else {
    // Same bounded, database-level query the page body uses below — reads
    // back the already-clamped page/category rather than recomputing the
    // clamp over a separately fetched full array. `category` here is already
    // validated against BLOG_CATEGORIES by getPublishedPostsPaged itself —
    // "" for anything absent or invalid, the exact same validated value
    // canonicalPath below already relies on, so an invalid ?category= falls
    // back to the plain base title/description below exactly the way it
    // already falls back to the plain canonical.
    const { page, category } = await getPublishedPostsPaged({
      category: params.category,
      page: params.page,
    });

    const qs = new URLSearchParams();
    if (category) qs.set("category", category);
    if (page > 1) qs.set("page", String(page));
    const suffix = qs.toString();
    canonicalPath = suffix ? `/blog?${suffix}` : "/blog";

    const categoryLabel = category
      ? CATEGORY_LABELS[category as BlogCategory]
      : null;

    if (categoryLabel) {
      title = `${categoryLabel} — ${SITE_NAME} Blog`;
      description = blogCategoryMetaDescription(category);
    }

    if (page > 1) {
      // Prefixed, not appended: clampDescription trims from the right, so a
      // long base/category description could otherwise swallow a suffix
      // before a reader (or a search result snippet) ever sees it — a prefix
      // always survives truncation, keeping every later page's description
      // genuinely distinct from page 1's rather than merely differing in a
      // clause that gets cut off first.
      title = `${title} — Page ${page}`;
      description = `Page ${page}: ${description}`;
    }
  }

  description = clampDescription(description);

  const url = absolute(canonicalPath);

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: url,
      types: { "application/rss+xml": absolute("/blog/feed.xml") },
    },
    robots,
    openGraph: {
      type: "website",
      url,
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
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; page?: string }>;
}) {
  const params = await searchParams;

  const { posts, page, pageSize, totalPages, total, category, search } =
    await getPublishedPostsPaged({
      category: params.category,
      search: params.q,
      page: params.page,
    });

  const start = (page - 1) * pageSize;

  function pageHref(target: number) {
    const qs = new URLSearchParams();
    if (search) qs.set("q", search);
    if (category) qs.set("category", category);
    if (target > 1) qs.set("page", String(target));
    const s = qs.toString();
    return s ? `/blog?${s}` : "/blog";
  }

  // Distinguishes "the blog has zero published posts at all" from "zero
  // posts match this filter" without a second, separate unconditional
  // count query: with no category/search active, `total` already *is* the
  // unconditional published-post count, so the two cases coincide exactly.
  // The one case this can't distinguish — an active filter on a blog that
  // also happens to have zero posts of any kind — shows "No posts match…"
  // rather than "No posts yet…", which reads correctly either way.
  const blogIsEmpty = total === 0 && !category && !search;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: absolute("/") },
          { name: "Blog", url: absolute("/blog") },
        ]}
      />
      <header className="max-w-3xl">
        <p className="font-mono text-sm text-brand-400">GetApkFree Blog</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl lg:text-5xl">
          Tips, guides, and app recommendations
        </h1>
        <p className="mt-3 text-base leading-relaxed text-fg-muted sm:mt-4 sm:text-lg">
          What to install, what to avoid, and how to get the most out of
          open-source Android apps.
        </p>
      </header>

      <BlogFilters initialQuery={search} initialCategory={category} />

      {blogIsEmpty ? (
        <p className="mt-12 rounded-2xl border border-base-800 bg-base-900 p-10 text-center text-fg-muted">
          No posts yet. Check back soon!
        </p>
      ) : total === 0 ? (
        <div className="mt-12 rounded-2xl border border-base-800 bg-base-900 p-10 text-center">
          <p className="text-fg-muted">
            No posts match{" "}
            {search && <span className="text-fg">“{search}”</span>}
            {search && category && " in "}
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
          <p className="mt-6 text-sm text-fg-dim sm:mt-8">
            Showing {start + 1}–{start + posts.length} of {total} post
            {total === 1 ? "" : "s"}
          </p>

          <div className="mt-4 grid gap-5 sm:mt-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
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
