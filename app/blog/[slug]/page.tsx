import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BlogArticleView from "@/components/blog/BlogArticleView";
import {
  BLOG_STATIC_PARAMS_LIMIT,
  getAdjacentPosts,
  getPostBySlug,
  getPublishedSlugs,
  getRelatedApps,
  getRelatedArticles,
  getTargetApp,
} from "@/lib/blog";
import { SITE_NAME, absolute, clampDescription } from "@/lib/seo";

export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

/**
 * Puts the segment into ISR mode. Without it the route renders fully dynamic
 * and Next sends `private, no-store`, which no CDN will cache — the same trap
 * the app detail pages hit.
 *
 * Prerenders only the BLOG_STATIC_PARAMS_LIMIT most recent published posts at
 * build time — the same "cap what's prerendered, let the long tail render on
 * first request" strategy app/app/[slug]/page.tsx already uses via
 * getPopularSlugs(50), so a growing blog_posts table never makes the build
 * attempt to pre-generate an unbounded number of pages. A slug outside this
 * set is not unreachable: dynamicParams defaults to true, so Next renders it
 * on demand on first request and caches it from then on via the revalidate
 * above, identically to the app detail route's own long tail.
 */
export async function generateStaticParams() {
  const slugs = await getPublishedSlugs(BLOG_STATIC_PARAMS_LIMIT);
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
    alternates: {
      canonical: url,
      types: { "application/rss+xml": absolute("/blog/feed.xml") },
    },
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

  const [{ apps, fallback }, { previous, next }, targetApp, relatedArticles] = await Promise.all([
    getRelatedApps(post.related_app_ids ?? [], 6),
    getAdjacentPosts(post),
    // Queried for app_related (target required) and review_other (target
    // optional — e.g. a single-app review) posts that actually named a
    // target; GENERAL is excluded even if it somehow carries a target_app_id
    // — see getPrimaryBlogPostsForApp's own doc comment in lib/blog.ts for
    // why. Every other post (the overwhelming majority) skips this entirely.
    post.target_app_id &&
    (post.article_type === "app_related" || post.article_type === "review_other")
      ? getTargetApp(post.target_app_id)
      : Promise.resolve(null),
    // The three-distinct-layouts task's own "Related Articles" section — see
    // getRelatedArticles' own doc comment in lib/blog.ts.
    getRelatedArticles(post),
  ]);

  return (
    <BlogArticleView
      post={post}
      apps={apps}
      fallback={fallback}
      previous={previous}
      next={next}
      targetApp={targetApp}
      relatedArticles={relatedArticles}
    />
  );
}
