import ArticleHeader from "@/components/blog/ArticleHeader";
import MarkdownRenderer from "@/components/blog/MarkdownRenderer";
import QuickAnswer from "@/components/blog/QuickAnswer";
import RelatedArticles from "@/components/blog/RelatedArticles";
import type { ArticleLayoutProps } from "@/components/blog/article-layout-types";

/**
 * GENERAL: a clean information/guide page. Structure: header (category,
 * title, meta, description) -> compact Quick Answer -> article body (whose
 * own markdown already carries an FAQ section when the author wrote one —
 * see lib/faq.ts's doc comment; there is no separate FAQ block to render
 * here, it is simply part of the body) -> Related Articles. Related Apps
 * renders in BlogArticleView's own sidebar, not duplicated here.
 *
 * Ignores `targetApp` — a general post never has one — kept in the prop
 * type only so BlogArticleView can select between all three layouts with
 * one shared, type-safe prop shape (see article-layout-types.ts).
 */
export default function GeneralArticleLayout({
  post,
  html,
  minutes,
  relatedArticles,
}: ArticleLayoutProps) {
  return (
    <>
      <ArticleHeader post={post} minutes={minutes} />
      <QuickAnswer description={post.description} />
      <MarkdownRenderer html={html} />
      <RelatedArticles articles={relatedArticles} />
    </>
  );
}
