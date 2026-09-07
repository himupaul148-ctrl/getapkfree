import { SITE_NAME, SITE_URL } from "@/lib/seo";

/**
 * schema.org WebSite, with a SearchAction pointing at the homepage's existing
 * `q` search param (see app/page.tsx) — this is what makes a sitelinks
 * searchbox possible, not a new search feature.
 *
 * Rendered once, sitewide, from the root layout, alongside OrganizationJsonLd.
 */
export default function WebSiteJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
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
