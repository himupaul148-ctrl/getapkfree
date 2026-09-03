import type { MetadataRoute } from "next";
import { getCatalogue } from "@/lib/catalogue";
import { getPublishedPosts } from "@/lib/blog";
import { absolute } from "@/lib/seo";
import { CATEGORIES } from "@/lib/types";

/*
 * Rendered per request rather than cached as a response.
 *
 * It previously carried `revalidate = 3600`, which made the generated XML a
 * prerendered route-handler response with its own cache entry — one that
 * outlived its 3600s window because Next 16 serves a stale entry until
 * `expire` (a year here) while it refreshes in the background. Deleting 48
 * apps left the sitemap advertising all of them, and it stayed that way:
 * `revalidateTag("catalogue", "max")` only marks the *data* stale, and the
 * `revalidatePath("/sitemap.xml")` in the admin revalidate route never
 * dropped the response entry.
 *
 * Dropping the response cache removes the layer that went stale. The cost is
 * one render per request, which is nothing: the two queries underneath are
 * still `unstable_cache`d for an hour and tagged, so Supabase is hit no more
 * often than before, and a sitemap is fetched by crawlers, not by visitors.
 * The upshot is that the sitemap now always agrees with the catalogue rather
 * than depending on an invalidation call that demonstrably did not fire.
 */
export const dynamic = "force-dynamic";

/**
 * One entry per app, plus the eight category views and the static pages.
 *
 * There is no separate route per version — versions are listed inside the app
 * page — so an app appears once, with lastModified taken from its newest
 * published build.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ apps }, posts] = await Promise.all([
    getCatalogue(),
    getPublishedPosts(),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: absolute("/"), changeFrequency: "hourly", priority: 1 },
    { url: absolute("/how-to-install"), changeFrequency: "monthly", priority: 0.8 },
    { url: absolute("/blog"), changeFrequency: "weekly", priority: 0.8 },
    { url: absolute("/about"), changeFrequency: "monthly", priority: 0.5 },
    { url: absolute("/privacy"), changeFrequency: "yearly", priority: 0.3 },
    { url: absolute("/terms"), changeFrequency: "yearly", priority: 0.3 },
    { url: absolute("/dmca"), changeFrequency: "yearly", priority: 0.3 },
    { url: absolute("/contact"), changeFrequency: "yearly", priority: 0.3 },
  ];

  const categoryPages: MetadataRoute.Sitemap = CATEGORIES.map((category) => ({
    url: absolute(`/?category=${encodeURIComponent(category)}`),
    changeFrequency: "daily",
    priority: 0.7,
  }));

  const appPages: MetadataRoute.Sitemap = apps.map((app) => ({
    url: absolute(`/app/${app.slug}`),
    lastModified: app.lastUpdated ? new Date(app.lastUpdated) : undefined,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  // Posts carry lastModified from updated_at, so an edit re-surfaces the page
  // to crawlers without waiting for a full recrawl.
  const blogPages: MetadataRoute.Sitemap = posts.map((post) => ({
    url: absolute(`/blog/${post.slug}`),
    lastModified: new Date(post.updated_at),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  return [...staticPages, ...categoryPages, ...blogPages, ...appPages];
}
