import BlogCard from "@/components/blog/BlogCard";
import type { BlogSummary } from "@/lib/blog";

/**
 * "Related Articles" on the individual blog article page itself — new for
 * the three-distinct-layouts task, shared by all three type-specific
 * layouts. Reuses BlogCard verbatim (the same card the /blog listing already
 * renders) rather than a new card design, so an article's related-reading
 * section looks like more of the same site, not a bolted-on feature.
 *
 * Renders nothing when there are no related posts (a category with only
 * this one article) — no placeholder/empty-state copy, matching every other
 * "only when real" section on this page (RelatedApps, TargetAppCard,
 * AppFacts, QuickAnswer, EditorialSummary).
 */
export default function RelatedArticles({ articles }: { articles: BlogSummary[] }) {
  if (articles.length === 0) return null;

  return (
    <section className="mt-12 border-t border-base-800 pt-8">
      <h2 className="text-lg font-bold tracking-tight">Related Articles</h2>
      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {articles.map((article) => (
          <BlogCard key={article.id} post={article} />
        ))}
      </div>
    </section>
  );
}
