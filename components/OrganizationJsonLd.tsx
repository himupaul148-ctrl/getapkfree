import { SITE_NAME, SITE_URL, absolute } from "@/lib/seo";

/**
 * schema.org Organization, identifying GetApkFree as the site's publisher.
 *
 * Rendered once, sitewide, from the root layout — unlike AppJsonLd/BlogJsonLd
 * this carries no per-page data, so it's the same object on every route.
 *
 * `logo` points at the only static, standalone icon asset the repo actually
 * has (app/favicon.ico, 16x16/32x32). The real brand mark
 * (components/Logo.tsx) is inline SVG rendered in the header/footer and was
 * never exported as its own image file, so there is no larger square logo
 * asset available to reference here.
 */
export default function OrganizationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: absolute("/favicon.ico"),
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
