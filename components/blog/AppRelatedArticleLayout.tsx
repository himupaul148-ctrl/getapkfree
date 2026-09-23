import ArticleHeader from "@/components/blog/ArticleHeader";
import AppFacts from "@/components/blog/AppFacts";
import MarkdownRenderer from "@/components/blog/MarkdownRenderer";
import RelatedArticles from "@/components/blog/RelatedArticles";
import TargetAppCard from "@/components/blog/TargetAppCard";
import type { ArticleLayoutProps } from "@/components/blog/article-layout-types";

/**
 * APP_RELATED: an article specifically about one app. Structure: TOP APP
 * CONTEXT (prominent TargetAppCard: icon, name, developer/category, a real
 * View App link to /app/{slug}) -> the same shared ArticleHeader every
 * layout uses -> APP FACTS (only the facts that actually exist) -> article
 * body -> Related Articles.
 *
 * `targetApp` is expected to be non-null for a real app_related post (the
 * validator requires target_app_id for this type), but a deleted/unresolved
 * app must never crash the page: both the top context and the facts block
 * are purely conditional on it, so a missing target app degrades gracefully
 * to essentially the same shape GeneralArticleLayout renders (header + body
 * + related articles), never a broken or empty section.
 */
export default function AppRelatedArticleLayout({
  post,
  html,
  minutes,
  targetApp,
  relatedArticles,
}: ArticleLayoutProps) {
  return (
    <>
      {targetApp && (
        <div className="mb-6">
          <TargetAppCard app={targetApp} variant="prominent" />
        </div>
      )}

      <ArticleHeader post={post} minutes={minutes} />

      {targetApp && <AppFacts app={targetApp} />}

      <MarkdownRenderer html={html} />
      <RelatedArticles articles={relatedArticles} />
    </>
  );
}
