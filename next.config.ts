import type { NextConfig } from "next";
import { OPTIMISED_IMAGE_HOSTS, supabaseHost } from "./lib/images";

/**
 * Content-Security-Policy, sent Report-Only for now: it logs violations to the
 * browser console without blocking anything, so a directive that turns out to
 * be too tight cannot take the site down. Promote it to the enforcing
 * `Content-Security-Policy` header only after the console is quiet.
 *
 * Two directives are looser than they look, both for reasons in the code:
 *
 *   script-src 'unsafe-inline' — components/ThemeScript.tsx renders a raw
 *   inline <script> before paint (it has to, or the page flashes dark before
 *   switching to a stored light theme), and Analytics.tsx's gtag init is
 *   inline too. Neither carries a nonce. Tightening this means generating a
 *   per-request nonce in proxy.ts and threading it through both, which is an
 *   architectural change rather than a header one. Even with inline allowed,
 *   this still blocks an injected <script src="https://evil.example/x.js">,
 *   which is the bulk of what CSP buys at this stage.
 *
 *   img-src https: — an admin can paste an icon or screenshot URL from any
 *   host, and anything off the optimiser allowlist renders as a plain <img>
 *   straight to that host (see components/AppIcon.tsx). A narrow list here
 *   would break icons that are already live.
 *
 * Google Analytics and AdSense are both inert right now — neither env var is
 * set — so their origins below come from Google's documented endpoints rather
 * than from observed traffic. Actually serving ads pulls from more Google
 * subdomains than the loader alone; Report-Only is precisely how to find out
 * which, without breaking the page while you look.
 */
function contentSecurityPolicy(): string {
  const supabase = supabaseHost();

  const connect = [
    "'self'",
    supabase ? `https://${supabase}` : null,
    "https://www.google-analytics.com",
    "https://*.google-analytics.com",
    "https://pagead2.googlesyndication.com",
  ].filter(Boolean);

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://pagead2.googlesyndication.com",
    // Inline style attributes: components/AppIcon.tsx sizes its initials badge
    // with style={{ width, height }}, among others.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    // Nothing on the site embeds an iframe, and nothing should embed us.
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

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
        // Baseline security headers on every route. Only the CSP is
        // Report-Only; the other four enforce immediately, because none of
        // them can break anything here — the site uses no camera, microphone,
        // geolocation, payment or USB API, and is not meant to be framed by
        // anyone else. Strict-Transport-Security is deliberately absent:
        // Vercel already sends it for the custom domain, and a second copy
        // from here would only risk the two disagreeing.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy-Report-Only",
            value: contentSecurityPolicy(),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
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
