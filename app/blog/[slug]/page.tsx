import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import BlogJsonLd from "@/components/blog/BlogJsonLd";
import BlogViewCounter from "@/components/blog/BlogViewCounter";
import RelatedApps from "@/components/blog/RelatedApps";
import ShareButtons from "@/components/blog/ShareButtons";
import { CategoryBadge } from "@/components/blog/BlogCard";
import {
  getAdjacentPosts,
  getPostBySlug,
  getPublishedSlugs,
  getRelatedApps,
} from "@/lib/blog";
import { isOptimisable } from "@/lib/images";
import { renderMarkdown, readingTime } from "@/lib/markdown";
import { formatDate } from "@/lib/format";
import { SITE_NAME, absolute, clampDescription } from "@/lib/seo";

export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

/**
 * Puts the segment into ISR mode. Without it the route renders fully dynamic
 * and Next sends `private, no-store`, which no CDN will cache — the same trap
 * the app detail pages hit.
 */
export async function generateStaticParams() {
  const slugs = await getPublishedSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) return { title: "Post not found", robots: { index: false } };

  const url = absolute(`/blog/${post.slug}`);
  const description = clampDescription(post.description);
  const images = post.featured_image_url
    ? [{ url: post.featured_image_url, alt: post.title }]
    : undefined;

  return {
    // `absolute` opts out of the root layout's "%s | GetApkFree" template,
    // which would otherwise append the site name a second time.
    title: { absolute: `${post.title} — ${SITE_NAME} Blog` },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: post.title,
      description,
      images,
      publishedTime: post.created_at,
      modifiedTime: post.updated_at,
      authors: [post.author],
    },
    twitter: {
      card: post.featured_image_url ? "summary_large_image" : "summary",
      title: post.title,
      description,
      images: post.featured_image_url ? [post.featured_image_url] : undefined,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const [{ apps, fallback }, { previous, next }] = await Promise.all([
    getRelatedApps(post.related_app_ids ?? [], 6),
    getAdjacentPosts(post),
  ]);

  const html = renderMarkdown(post.content);
  const minutes = readingTime(post.content);
  const url = absolute(`/blog/${post.slug}`);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <BlogJsonLd post={post} />
      <BlogViewCounter slug={post.slug} />

      <Link
        href="/blog"
        className="text-sm text-fg-dim transition-colors hover:text-brand-400"
      >
        ← Back to the blog
      </Link>

      {post.featured_image_url && (
        <div className="relative mt-6 aspect-video w-full overflow-hidden rounded-2xl border border-base-800 bg-base-850">
          <Image
            src={post.featured_image_url}
            alt=""
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
          <header>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <CategoryBadge category={post.category} />
              <span className="text-sm text-fg-dim">{minutes} min read</span>
            </div>

            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
              {post.title}
            </h1>

            <p className="mt-4 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
              <span>{post.author}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={post.created_at}>
                {formatDate(post.created_at)}
              </time>
            </p>

            <p className="mt-5 text-lg leading-relaxed text-fg-muted">
              {post.description}
            </p>
          </header>

          {/*
            Content is sanitised in renderMarkdown before it reaches here —
            script tags, event-handler attributes and javascript: hrefs are all
            stripped, so this is not raw author HTML.
          */}
          <div
            className="mt-10 leading-relaxed text-fg-muted [&>*+*]:mt-5 [&_a]:text-brand-400 [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-base-700 [&_blockquote]:pl-4 [&_blockquote]:text-fg-dim [&_code]:rounded [&_code]:bg-base-850 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-fg [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-fg [&_img]:rounded-xl [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-base-800 [&_pre]:bg-base-950 [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:text-fg [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:border-base-800 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-base-800 [&_th]:px-3 [&_th]:py-2 [&_th]:text-fg [&_ul]:space-y-1"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          <div className="mt-12 border-t border-base-800 pt-6">
            <ShareButtons url={url} title={post.title} />
          </div>

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
