import { absolute } from "@/lib/seo";
import type { App, Version } from "@/lib/types";

/**
 * schema.org SoftwareApplication for the app detail page.
 *
 * Emitted as a JSON-LD script rather than microdata so the markup stays clean,
 * and stringified through JSON.stringify with `<` escaped — app descriptions
 * are imported from F-Droid and are not ours to trust inside a script tag.
 */
export default function AppJsonLd({
  app,
  latest,
}: {
  app: App;
  latest: Version | undefined;
}) {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: app.name,
    url: absolute(`/app/${app.slug}`),
    applicationCategory: "MobileApplication",
    applicationSubCategory: app.category ?? undefined,
    operatingSystem: latest?.min_android_version
      ? `Android ${latest.min_android_version}+`
      : "Android",
    softwareVersion: latest?.version_name ?? undefined,
    fileSize: latest?.file_size ? `${latest.file_size}B` : undefined,
    downloadUrl: latest?.file_url ?? undefined,
    datePublished: latest?.uploaded_at ?? undefined,
    description: app.description ?? undefined,
    image: app.icon_url ?? undefined,
    author: app.developer_name
      ? { "@type": "Organization", name: app.developer_name }
      : undefined,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };

  if (app.rating !== null && app.rating_count > 0) {
    data.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: app.rating,
      ratingCount: app.rating_count,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
