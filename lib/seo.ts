/**
 * One source of truth for the canonical origin.
 *
 * Set NEXT_PUBLIC_SITE_URL in Vercel when getapkfree.com goes live — canonical
 * URLs, Open Graph images and the sitemap all key off this, and pointing them
 * at the wrong host is the sort of thing nobody notices until search results
 * are already wrong.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://getapkfree.vercel.app"
).replace(/\/$/, "");

export const SITE_NAME = "GetApkFree";

export const SITE_DESCRIPTION =
  "Download free, open-source Android APKs with confidence. Every build is versioned, malware-scanned, and published with its full changelog.";

/** Absolute URL for a site-relative path. */
export function absolute(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Trim to a sensible meta-description length without cutting mid-word. */
export function clampDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
