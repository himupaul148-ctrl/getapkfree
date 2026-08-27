import Link from "next/link";
import { notFound } from "next/navigation";
import BlogEditor from "@/components/admin/BlogEditor";
import type { PickerApp } from "@/components/admin/RelatedAppPicker";
import { createClient } from "@/lib/supabase/server";
import type { BlogPost } from "@/lib/blog";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EditBlogPostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const supabase = await createClient();

  // Reads through the admin policy, so an unpublished draft resolves here even
  // though the public queries would not find it.
  const [postRes, appsRes] = await Promise.all([
    supabase
      .from("blog_posts")
      .select("*")
      .eq("id", postId)
      .maybeSingle<BlogPost>(),
    supabase
      .from("apps")
      .select("id, name, category")
      .order("name")
      .returns<PickerApp[]>(),
  ]);

  const post = postRes.data;
  if (!post) notFound();

  return (
    <div>
      <Link
        href="/admin/blog?tab=posts"
        className="text-sm text-fg-dim transition-colors hover:text-brand-400"
      >
        ← All posts
      </Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">Edit post</h2>
        <p className="text-xs text-fg-dim">
          {post.published ? "Published" : "Draft"} · created{" "}
          {formatDate(post.created_at)} · last updated{" "}
          {formatDate(post.updated_at)}
        </p>
      </div>

      <div className="mt-6">
        <BlogEditor apps={appsRes.data ?? []} post={post} />
      </div>
    </div>
  );
}
