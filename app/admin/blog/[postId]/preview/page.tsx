import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BlogArticleView from "@/components/blog/BlogArticleView";
import { createClient } from "@/lib/supabase/server";
import {
  getAdjacentPosts,
  getRelatedApps,
  getRelatedArticles,
  getTargetApp,
  type BlogPost,
} from "@/lib/blog";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Defense-in-depth on top of app/admin/layout.tsx's own `robots: {index:
 * false, follow: false}` (which every /admin page already inherits) — stated
 * explicitly here too so this page's intent is not just "whatever the parent
 * happens to set today".
 */
export const metadata: Metadata = {
  title: "Draft preview",
  robots: { index: false, follow: false },
};

/**
 * The admin-only draft preview: the exact public article render tree
 * (BlogArticleView), fed by a post row read through the admin RLS policy
 * instead of the public, published-only one.
 *
 * Authorization is entirely inherited, not reimplemented: app/admin/layout.tsx
 * already calls isAdmin() and redirects non-admins to "/" before this page's
 * own code ever runs, and the Supabase query below uses the same
 * session-bound server client (lib/supabase/server.ts) and the same by-id
 * lookup as the existing app/admin/blog/[postId]/edit/page.tsx — the identical
 * mechanism that already lets an admin session read an unpublished row. There
 * is no separate token, no query-string switch, and no public/anon client
 * involved anywhere on this path, so a visitor who is not signed in as an
 * admin — including one who knows this exact URL or the post's slug — gets
 * redirected by the layout before any post data is fetched.
 */
export default async function BlogPostPreviewPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const supabase = await createClient();

  const { data: post } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("id", postId)
    .maybeSingle<BlogPost>();

  if (!post) notFound();

  // All read-only and all already public-safe: getRelatedApps only ever
  // returns apps (never post content), getAdjacentPosts only ever returns
  // other *published* posts' slug/title, and getRelatedArticles only ever
  // returns other *published* posts in the same category — none of these can
  // leak anything about this draft beyond what's already being previewed
  // below.
  const [{ apps, fallback }, { previous, next }, targetApp, relatedArticles] = await Promise.all([
    getRelatedApps(post.related_app_ids ?? [], 6),
    getAdjacentPosts(post),
    // Same conditional lookup as the public route (app_related or
    // review_other with a target_app_id — see app/blog/[slug]/page.tsx), so
    // a draft's preview shows exactly what the public page will once it's
    // published.
    post.target_app_id &&
    (post.article_type === "app_related" || post.article_type === "review_other")
      ? getTargetApp(post.target_app_id)
      : Promise.resolve(null),
    // Same "which layout renders" concern as the public route — a draft's
    // preview must show its Related Articles section exactly as it will
    // once published.
    getRelatedArticles(post),
  ]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3 text-sm text-warn-300">
        <span>
          <strong>Draft preview</strong> — visible only to signed-in admins,
          not indexed, and not linked from the public site.{" "}
          {post.published
            ? "This post is live; this preview reflects the last saved version, including any unpublished edits."
            : "This post is not published."}{" "}
          Last saved {formatDate(post.updated_at)}.
        </span>
        <Link
          href={`/admin/blog/${post.id}/edit`}
          className="shrink-0 rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
        >
          ← Back to editor
        </Link>
      </div>

      <BlogArticleView
        post={post}
        apps={apps}
        fallback={fallback}
        previous={previous}
        next={next}
        targetApp={targetApp}
        relatedArticles={relatedArticles}
        preview
      />
    </div>
  );
}
