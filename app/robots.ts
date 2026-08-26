import type { MetadataRoute } from "next";
import { absolute, SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Account and admin areas are already gated server-side; keeping them
        // out of the crawl budget stops crawlers hammering redirects too.
        disallow: [
          "/admin",
          "/admin/",
          "/profile",
          "/login",
          "/signup",
          "/auth/",
          "/api/",
        ],
      },
    ],
    sitemap: absolute("/sitemap.xml"),
    host: SITE_URL,
  };
}
