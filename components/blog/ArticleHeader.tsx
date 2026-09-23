import { CategoryBadge } from "@/components/blog/BlogCard";
import { formatDate } from "@/lib/format";
import type { BlogPost } from "@/lib/blog";

/**
 * The article title block, shared verbatim by all three type-specific
 * layouts — extracted from BlogArticleView unchanged (byte-identical
 * classNames/structure) so no existing published post's appearance changes
 * as part of introducing the three layouts.
 */
export default function ArticleHeader({
  post,
  minutes,
}: {
  post: BlogPost;
  minutes: number;
}) {
  return (
    <header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CategoryBadge
          category={post.category}
          href={`/blog?category=${encodeURIComponent(post.category)}`}
        />
        <span className="text-sm text-fg-dim">{minutes} min read</span>
      </div>

      <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl lg:text-5xl">
        {post.title}
      </h1>

      <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted sm:mt-4">
        <span>{post.author}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={post.created_at}>
          {formatDate(post.created_at)}
        </time>
      </p>

      <p className="mt-4 text-base leading-relaxed text-fg-muted sm:mt-5 sm:text-lg">
        {post.description}
      </p>
    </header>
  );
}
