import type { BlogPost, BlogSummary, TargetAppLink } from "@/lib/blog";

/**
 * The one prop shape all three type-specific layouts
 * (GeneralArticleLayout/AppRelatedArticleLayout/ReviewOtherArticleLayout)
 * share, so BlogArticleView can pick one at runtime (based on
 * selectArticleLayout(post.article_type)) and render it polymorphically
 * without a separate call per type. General ignores `targetApp` (it never
 * has one to show) rather than omitting it from its own prop type — a
 * narrower type there would make the dynamic `LayoutComponent = ... ?  : `
 * selection in BlogArticleView fail to type-check.
 */
export type ArticleLayoutProps = {
  post: BlogPost;
  html: string;
  minutes: number;
  targetApp: TargetAppLink | null;
  relatedArticles: BlogSummary[];
};
