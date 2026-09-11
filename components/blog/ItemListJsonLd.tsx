import { absolute } from "@/lib/seo";
import type { ListicleItem } from "@/lib/listicle";

/**
 * schema.org ItemList — built strictly from `items`, which the caller
 * derives from the same post.content string the article body (and its
 * Comparison Table) are rendered from (see lib/listicle.ts's
 * extractListicleItems). This component adds no content of its own: it only
 * serialises the order the article already presents.
 *
 * `position` records presentation order — the sequence the article's own
 * headings appear in — not a quality ranking. Several of these articles
 * explicitly say as much themselves (e.g. the privacy/security guide's own
 * FAQ: "There's no single 'most secure' app here, and we're deliberately
 * not naming one"), so `itemListOrder` is deliberately omitted rather than
 * set to a ranked value that would assert something the article itself
 * disclaims.
 *
 * Escaped the same way BlogJsonLd/FaqJsonLd/AppJsonLd escape their output:
 * a `</script>` sequence inside any field would otherwise close the tag
 * early.
 */
export default function ItemListJsonLd({ items }: { items: ListicleItem[] }) {
  if (items.length === 0) return null;

  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absolute(`/app/${item.slug}`),
    })),
    numberOfItems: items.length,
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
