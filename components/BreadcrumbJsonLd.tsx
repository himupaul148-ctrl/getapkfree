/**
 * schema.org BreadcrumbList, generic over whatever trail the calling page
 * builds — each route constructs its own `items` from data it already has
 * (see app/app/[slug]/page.tsx, app/blog/[slug]/page.tsx, app/blog/page.tsx),
 * this component just serializes it.
 *
 * Escaped the same way AppJsonLd/BlogJsonLd escape their output.
 */
export default function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[];
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
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
