import type { FaqPair } from "@/lib/faq";

/**
 * schema.org FAQPage — built strictly from `pairs`, which the caller derives
 * from the same post.content string the article body itself is rendered
 * from (see lib/faq.ts's extractFaqPairs). This component adds no content
 * and does no parsing of its own: it only serialises what it is given, so it
 * can never describe a question or answer that isn't already visible on the
 * page.
 *
 * Escaped the same way BlogJsonLd/AppJsonLd escape their output: a
 * `</script>` sequence inside any field would otherwise close the tag early.
 */
export default function FaqJsonLd({ pairs }: { pairs: FaqPair[] }) {
  if (pairs.length === 0) return null;

  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((pair) => ({
      "@type": "Question",
      name: pair.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: pair.answer,
      },
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
