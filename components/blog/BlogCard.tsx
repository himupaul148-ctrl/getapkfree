import Image from "next/image";
import Link from "next/link";
import { isOptimisable } from "@/lib/images";
import { formatDate } from "@/lib/format";
import { CATEGORY_LABELS, type BlogCategory, type BlogSummary } from "@/lib/blog";

export function CategoryBadge({ category }: { category: string }) {
  const label =
    CATEGORY_LABELS[category as BlogCategory] ?? category;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-azure-500/10 px-2.5 py-0.5 text-xs font-medium text-azure-300">
      {label}
    </span>
  );
}

export default function BlogCard({ post }: { post: BlogSummary }) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-base-800 bg-base-900 transition-colors hover:border-brand-500/50">
      <Link href={`/blog/${post.slug}`} className="block">
        {post.featured_image_url ? (
          <div className="relative aspect-video w-full overflow-hidden bg-base-850">
            <Image
              src={post.featured_image_url}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 380px"
              loading="lazy"
              unoptimized={!isOptimisable(post.featured_image_url)}
              className="object-cover transition-transform group-hover:scale-[1.02]"
            />
          </div>
        ) : (
          // Keeps the grid rhythm when a post has no cover rather than letting
          // one card sit shorter than its neighbours.
          <div className="aspect-video w-full bg-gradient-to-br from-base-850 to-base-800" />
        )}

        <div className="p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <CategoryBadge category={post.category} />
            <span className="text-xs text-fg-dim">
              {post.readMinutes} min read
            </span>
          </div>

          <h2 className="mt-3 text-lg font-bold leading-snug tracking-tight text-fg transition-colors group-hover:text-brand-400">
            {post.title}
          </h2>

          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-fg-muted">
            {post.excerptText}
          </p>

          <p className="mt-4 flex flex-wrap items-center gap-x-2 border-t border-base-800 pt-3 text-xs text-fg-dim">
            <span>{post.author}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
          </p>
        </div>
      </Link>
    </article>
  );
}
