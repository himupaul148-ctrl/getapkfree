import type { MetadataRoute } from "next";
import { getCatalogue } from "@/lib/catalogue";
import { absolute } from "@/lib/seo";
import { CATEGORIES } from "@/lib/types";

// Rebuilt on the same hourly cadence as the catalogue itself.
export const revalidate = 3600;

/**
 * One entry per app, plus the eight category views and the static pages.
 *
 * There is no separate route per version — versions are listed inside the app
 * page — so an app appears once, with lastModified taken from its newest
 * published build.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { apps } = await getCatalogue();

  const staticPages: MetadataRoute.Sitemap = [
    { url: absolute("/"), changeFrequency: "hourly", priority: 1 },
    { url: absolute("/how-to-install"), changeFrequency: "monthly", priority: 0.8 },
    { url: absolute("/about"), changeFrequency: "monthly", priority: 0.5 },
    { url: absolute("/privacy"), changeFrequency: "yearly", priority: 0.3 },
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

  return [...staticPages, ...categoryPages, ...appPages];
}
