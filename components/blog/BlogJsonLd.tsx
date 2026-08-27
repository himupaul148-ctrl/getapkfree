import { SITE_NAME, absolute } from "@/lib/seo";
import type { BlogPost } from "@/lib/blog";

/**
 * schema.org BlogPosting.
 *
 * The payload is escaped the same way `AppJsonLd` escapes app descriptions:
 * a `</script>` sequence inside any string would otherwise close the tag early
 * and let the rest of the field parse as markup.
 */
export default function BlogJsonLd({ post }: { post: BlogPost }) {
  const url = absolute(`/blog/${post.slug}`);

  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    ...(post.featured_image_url ? { image: post.featured_image_url } : {}),
    datePublished: post.created_at,
    dateModified: post.updated_at,
    author: { "@type": "Organization", name: post.author },
    publisher: { "@type": "Organization", name: SITE_NAME },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
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
