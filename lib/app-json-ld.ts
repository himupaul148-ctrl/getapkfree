import { absolute } from "./seo.ts";
import { spdxLicenseUrl } from "./spdx-license.ts";
import type { App, Version } from "./types.ts";

/**
 * Builds the plain object AppJsonLd serializes into a SoftwareApplication
 * JSON-LD script. Pulled out of the component so the exact shape (which
 * fields appear, and under what condition) can be unit-tested without a
 * React renderer — this project has none for components, matching the
 * precedent already set for BlogEditor's save-payload logic
 * (lib/blog-editor-fields.ts).
 *
 * P2-1 adds `license` — via spdxLicenseUrl(), since Schema.org's `license`
 * property expects a URL, not a bare SPDX string — only when the app has
 * one and it safely converts. target_sdk is deliberately never included
 * here at all: there is no standard Schema.org property that means "target
 * SDK" (softwareRequirements means something else — a runtime requirement,
 * not a build-time compliance declaration — and using it for target SDK
 * would misrepresent the fact), so target SDK stays visible-UI-only (see
 * the app detail page's own metadata line).
 */
export function buildAppJsonLdData(
  app: App,
  latest: Version | undefined,
): Record<string, unknown> {
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
    license: spdxLicenseUrl(app.license) ?? undefined,
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

  return data;
}
