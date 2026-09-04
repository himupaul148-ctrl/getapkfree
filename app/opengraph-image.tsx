import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

/**
 * Sitewide social share image. Applies to every route that doesn't define its
 * own opengraph-image — app/app/[slug] and app/blog/[slug] already set
 * openGraph.images (icon and featured image respectively) and take priority
 * over this file, per Next's per-segment resolution. Every other page —
 * the homepage, all category views, /blog, /about, /how-to-install,
 * /contact, /privacy, /terms, /dmca, and any blog post without a featured
 * image — currently has no share image at all, so a shared link unfurls as
 * bare text (or nothing, on unfurlers that drop the card without an image).
 *
 * Colors are lifted from app/globals.css's dark theme (--c-base-950,
 * --c-brand-400, --c-azure-400) rather than re-picked, so this matches the
 * homepage hero's own gradient instead of drifting from it.
 *
 * Statically generated at build time — no fonts or external assets, so no
 * request-time cost and nothing new for the CSP to allow.
 */
export const alt = `${SITE_NAME} — Free, Open-Source Android APK Downloads`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "80px",
          background: "#070a0f",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "72px",
              height: "72px",
              borderRadius: "18px",
              background: "linear-gradient(135deg, #4ade80, #38bdf8)",
            }}
          />
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: "#f6f8fb" }}>
            {SITE_NAME}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "48px",
            fontSize: 60,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "#f6f8fb",
            maxWidth: "980px",
          }}
        >
          Free, Open-Source Android Apps
        </div>

        <div
          style={{
            display: "flex",
            marginTop: "28px",
            fontSize: 30,
            lineHeight: 1.4,
            color: "#9aa4b2",
            maxWidth: "900px",
          }}
        >
          {SITE_DESCRIPTION}
        </div>
      </div>
    ),
    { ...size },
  );
}
