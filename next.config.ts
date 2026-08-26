import type { NextConfig } from "next";
import { OPTIMISED_IMAGE_HOSTS } from "./lib/images";

const nextConfig: NextConfig = {
  images: {
    // One source of truth with lib/images.ts, so a host the optimiser will
    // accept and a host the components think it will accept cannot diverge.
    remotePatterns: OPTIMISED_IMAGE_HOSTS.map((hostname) => ({
      protocol: "https" as const,
      hostname,
    })),
    // Icons render at 44–104px; screenshots at ~540px wide. Trimming the
    // default ladder avoids generating sizes nothing asks for.
    imageSizes: [44, 56, 88, 104, 128, 256],
    deviceSizes: [640, 828, 1080, 1200, 1920],
    // Optimised icons are immutable in practice — a new build gets a new URL.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  async headers() {
    return [
      {
        // Next already sends immutable caching for /_next/static. This covers
        // anything served straight out of /public.
        source: "/:all*(svg|jpg|jpeg|png|webp|avif|gif|ico|woff|woff2)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // Belt and braces for the CDN: never let an intermediary hold on to a
        // response from a route that renders per-user data. Next sends
        // no-store for dynamic routes anyway, but a misconfigured cache rule
        // serving one person's profile to another is not a failure worth
        // risking on a single layer of defence.
        source: "/:path(admin|profile|login|signup)/:rest*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/:path(admin|profile|login|signup)",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
