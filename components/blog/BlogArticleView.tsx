import Image from "next/image";
import Link from "next/link";
import AppRelatedArticleLayout from "@/components/blog/AppRelatedArticleLayout";
import BlogJsonLd from "@/components/blog/BlogJsonLd";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";
import FaqJsonLd from "@/components/blog/FaqJsonLd";
import GeneralArticleLayout from "@/components/blog/GeneralArticleLayout";
import ItemListJsonLd from "@/components/blog/ItemListJsonLd";
import BlogViewCounter from "@/components/blog/BlogViewCounter";
import RelatedApps from "@/components/blog/RelatedApps";
import ReviewOtherArticleLayout from "@/components/blog/ReviewOtherArticleLayout";
import ShareButtons from "@/components/blog/ShareButtons";
import {
  CATEGORY_LABELS,
  selectArticleLayout,
  type BlogPost,
  type BlogSummary,
  type TargetAppLink,
} from "@/lib/blog";
import { extractFaqPairs } from "@/lib/faq";
import { extractListicleItems } from "@/lib/listicle";
import { isOptimisable } from "@/lib/images";
import { renderMarkdown, readingTime } from "@/lib/markdown";
import { absolute } from "@/lib/seo";
import type { AppSummary } from "@/lib/types";

type AdjacentPost = { slug: string; title: string } | null;

/**
 * The full article render tree for a blog post — header, featured image,
 * body, share row, prev/next, and the related-apps sidebar. Shared verbatim
 * between the public route (app/blog/[slug]/page.tsx) and the admin draft
 * preview (app/admin/blog/[postId]/preview/page.tsx) so a preview is never a
 * second, hand-maintained copy that can drift from what readers actually see.
 *
 * `preview` suppresses everything that is either a public SEO signal (the
 * JSON-LD blocks) or a public side effect (the view-count RPC, share links
 * pointing at a URL that 404s for anyone without an admin session) — never
 * the article content itself, which renders identically either way.
 */
export default function BlogArticleView({
  post,
  apps,
  fallback,
  previous,
  next,
  targetApp = null,
  relatedArticles = [],
  preview = false,
}: {
  post: BlogPost;
  apps: AppSummary[];
  fallback: boolean;
  previous: AdjacentPost;
  next: AdjacentPost;
  /**
   * Three-type blog system: the resolved target app for an APP_RELATED or
   * REVIEW_OTHER post, or null for every other post (the overwhelming
   * majority) and for a post whose target app couldn't be resolved — both
   * cases render identically (the reference section simply doesn't appear),
   * so the caller never has to distinguish "no target app expected" from
   * "expected but unresolved" here.
   */
  targetApp?: TargetAppLink | null;
  /** Other published posts in the same category — see lib/blog.ts's getRelatedArticles(). */
  relatedArticles?: BlogSummary[];
  preview?: boolean;
}) {
  const html = renderMarkdown(post.content);
  const minutes = readingTime(post.content);
  const url = absolute(`/blog/${post.slug}`);
  // Three distinct public templates (General/App Related/Review-Other) share
  // this one shell (JSON-LD, featured image, the two-column grid, the
  // RelatedApps sidebar, share/prev-next) and differ only in what renders
  // inside the <article> column — see the LayoutComponent switch below.
  // Falls back to General for a missing/null/unexpected article_type (the DB
  // column is NOT NULL with a CHECK constraint, so this is a defensive-only
  // path, never expected to actually fire for a real row).
  const layoutType = selectArticleLayout(post.article_type);
  const LayoutComponent =
    layoutType === "app_related"
      ? AppRelatedArticleLayout
      : layoutType === "review_other"
        ? ReviewOtherArticleLayout
        : GeneralArticleLayout;
  // Derived from the exact same post.content the article body (html, above)
  // is rendered from — never a separate source — so the FAQPage markup can
  // only ever describe questions and answers already visible on this page.
  const faqPairs = extractFaqPairs(post.content);
  // Same principle for the curated "best open-source X apps" listicles: read
  // from post.content, not related_app_ids (empty for all of these posts
  // today) or any other separate field.
  const listicleItems = extractListicleItems(post.content);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {!preview && (
        <>
          <BlogJsonLd post={post} />
          <BreadcrumbJsonLd
            items={[
              { name: "Home", url: absolute("/") },
              { name: "Blog", url: absolute("/blog") },
              {
                name: CATEGORY_LABELS[post.category as keyof typeof CATEGORY_LABELS] ?? post.category,
                url: absolute(`/blog?category=${encodeURIComponent(post.category)}`),
              },
              { name: post.title, url: absolute(`/blog/${post.slug}`) },
            ]}
          />
          {faqPairs.length > 0 && <FaqJsonLd pairs={faqPairs} />}
          {listicleItems.length > 0 && <ItemListJsonLd items={listicleItems} />}
          <BlogViewCounter
            slug={post.slug}
            title={post.title}
            category={post.category}
          />
        </>
      )}

      {/* Visible breadcrumb — mirrors the BreadcrumbJsonLd above exactly
          (Home / Blog / Category / Article title), and the same nav markup
          app/page.tsx's own category breadcrumb already uses, so the two
          read as one consistent pattern rather than two different
          conventions. Supersedes the previous plain single-link-back
          navigation entirely, rather than sitting alongside it. */}
      <nav aria-label="Breadcrumb" className="text-sm text-fg-dim">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-brand-400 hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/blog" className="hover:text-brand-400 hover:underline">
              Blog
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href={`/blog?category=${encodeURIComponent(post.category)}`}
              className="hover:text-brand-400 hover:underline"
            >
              {CATEGORY_LABELS[post.category as keyof typeof CATEGORY_LABELS] ?? post.category}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="max-w-[16rem] truncate font-medium text-fg sm:max-w-sm">
            {post.title}
          </li>
        </ol>
      </nav>

      {post.featured_image_url && (
        <div className="relative mt-6 aspect-video w-full overflow-hidden rounded-2xl border border-base-800 bg-base-850">
          <Image
            src={post.featured_image_url}
            alt={post.title}
            fill
            sizes="(max-width: 1024px) 100vw, 1152px"
            priority
            unoptimized={!isOptimisable(post.featured_image_url)}
            className="object-cover"
          />
        </div>
      )}

      <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ---- Article ---- */}
        <article className="min-w-0">
          <LayoutComponent
            post={post}
            html={html}
            minutes={minutes}
            targetApp={targetApp}
            relatedArticles={relatedArticles}
          />

          {!preview && (
            <div className="mt-12 border-t border-base-800 pt-6">
              <ShareButtons url={url} title={post.title} />
            </div>
          )}

          {(previous || next) && (
            <nav
              aria-label="More posts"
              className="mt-10 grid gap-4 border-t border-base-800 pt-8 sm:grid-cols-2"
            >
              {previous ? (
                <Link
                  href={`/blog/${previous.slug}`}
                  rel="prev"
                  className="rounded-xl border border-base-800 bg-base-900 p-4 transition-colors hover:border-brand-500/50"
                >
                  <span className="text-xs text-fg-dim">← Previous</span>
                  <p className="mt-1 font-medium text-fg">{previous.title}</p>
                </Link>
              ) : (
                <div />
              )}

              {next && (
                <Link
                  href={`/blog/${next.slug}`}
                  rel="next"
                  className="rounded-xl border border-base-800 bg-base-900 p-4 text-right transition-colors hover:border-brand-500/50 sm:col-start-2"
                >
                  <span className="text-xs text-fg-dim">Next →</span>
                  <p className="mt-1 font-medium text-fg">{next.title}</p>
                </Link>
              )}
            </nav>
          )}
        </article>

        {/* ---- Sidebar: below the article on mobile, beside it from lg up ---- */}
        <RelatedApps apps={apps} fallback={fallback} />
      </div>
    </div>
  );
}
