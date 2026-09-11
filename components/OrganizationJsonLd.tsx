import { SITE_NAME, SITE_URL, absolute } from "@/lib/seo";

/**
 * schema.org Organization, identifying GetApkFree as the site's publisher.
 *
 * Rendered once, sitewide, from the root layout — unlike AppJsonLd/BlogJsonLd
 * this carries no per-page data, so it's the same object on every route.
 *
 * `logo` points at public/logo.png — a static 512x512 PNG export of the real
 * brand mark (components/Logo.tsx's LogoMark), rather than app/favicon.ico:
 * favicon.ico is served as image/vnd.microsoft.icon, a non-standard format
 * for this field, where a plain PNG is unambiguous to any consumer.
 *
 * No `sameAs`: there is no verified, site-referenced public profile (social
 * or otherwise) to point it at. This entity is also not yet cross-referenced
 * by BlogJsonLd's `publisher` or WebSiteJsonLd — both declare their own
 * separate, minimal Organization stub rather than an `@id` reference to this
 * one — so this description/logo enrichment applies only to this standalone
 * script, not to every place "GetApkFree" appears in the site's structured
 * data. That's deliberate scope for this change, not an oversight.
 */
export default function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: absolute("/logo.png"),
    description:
      "GetApkFree is an open-source Android APK catalogue. It lists F-Droid builds with full version history and malware-scan status, and links external apps to their official publisher.",
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
