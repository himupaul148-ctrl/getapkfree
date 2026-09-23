import ArticleHeader from "@/components/blog/ArticleHeader";
import EditorialSummary from "@/components/blog/EditorialSummary";
import MarkdownRenderer from "@/components/blog/MarkdownRenderer";
import RelatedArticles from "@/components/blog/RelatedArticles";
import TargetAppCard from "@/components/blog/TargetAppCard";
import type { ArticleLayoutProps } from "@/components/blog/article-layout-types";

/**
 * REVIEW_OTHER: an editorial layout for reviews, comparisons, roundups,
 * alternatives, and other non-guide content. Structure: editorial header
 * (the same shared ArticleHeader) -> At a Glance summary -> a compact
 * TargetAppCard when this review names one specific app (optional — a
 * comparison/roundup post legitimately has none) -> article body, with
 * listicle/comparison markup (ordered lists, tables) given a bit more visual
 * weight than the plain-prose default -> Related Articles.
 *
 * Deliberately invents nothing: no star rating, no numeric score, no
 * AggregateRating/Review JSON-LD, no pros/cons list — the existing
 * FaqJsonLd/ItemListJsonLd/BlogJsonLd (rendered by BlogArticleView, not
 * here) already describe only what the article's own markdown genuinely
 * contains, and this layout adds no schema of its own.
 */
const LISTICLE_EMPHASIS =
  "[&_ol]:space-y-4 [&_ol>li]:rounded-xl [&_ol>li]:border [&_ol>li]:border-base-800 [&_ol>li]:bg-base-900 [&_ol>li]:p-4 [&_ol>li]:pl-10 [&_th]:bg-base-850";

export default function ReviewOtherArticleLayout({
  post,
  html,
  minutes,
  targetApp,
  relatedArticles,
}: ArticleLayoutProps) {
  return (
    <>
      <ArticleHeader post={post} minutes={minutes} />
      <EditorialSummary description={post.description} />

      {targetApp && (
        <div className="mt-6">
          <TargetAppCard app={targetApp} variant="compact" />
        </div>
      )}

      <MarkdownRenderer html={html} extraClassName={LISTICLE_EMPHASIS} />
      <RelatedArticles articles={relatedArticles} />
    </>
  );
}
