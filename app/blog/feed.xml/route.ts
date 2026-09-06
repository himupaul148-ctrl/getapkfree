import { NextResponse } from "next/server";
import { getPublishedPosts } from "@/lib/blog";
import { buildBlogRssFeed } from "@/lib/blog-feed";

/*
 * Rendered per request rather than cached as a response — the same fix
 * app/sitemap.ts already applies and documents: a cached route-handler
 * response can outlive the "blog" tag's own invalidation, so the safest way
 * to keep this in step with a publish/edit is to never cache the XML itself.
 * The query underneath is still unstable_cache'd for an hour and tagged
 * "blog", so Supabase isn't hit any more often than /blog already hits it —
 * publishing or editing a post revalidates that tag immediately, exactly as
 * it does for the listing and the sitemap.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const posts = await getPublishedPosts();
  const xml = buildBlogRssFeed(posts);

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
