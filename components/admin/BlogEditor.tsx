"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ImageField from "@/components/admin/ImageField";
import MarkdownEditor from "@/components/admin/MarkdownEditor";
import RelatedAppPicker, {
  type PickerApp,
} from "@/components/admin/RelatedAppPicker";
import { createClient } from "@/lib/supabase/client";
import { BLOG_CATEGORIES, CATEGORY_LABELS, type BlogPost } from "@/lib/blog";
import { SITE_URL } from "@/lib/seo";

const DESCRIPTION_LIMIT = 160;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Shared by the Write tab and the edit page. `post` present means edit mode,
 * which changes the buttons and warns before taking a live post down.
 */
export default function BlogEditor({
  apps,
  post,
}: {
  apps: PickerApp[];
  post?: BlogPost;
}) {
  const router = useRouter();
  const editing = Boolean(post);

  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  // Once an author edits the slug by hand, stop overwriting it from the title.
  const [slugTouched, setSlugTouched] = useState(editing);
  const [description, setDescription] = useState(post?.description ?? "");
  const [image, setImage] = useState(post?.featured_image_url ?? "");
  const [category, setCategory] = useState(post?.category ?? BLOG_CATEGORIES[0]);
  const [content, setContent] = useState(post?.content ?? "");
  const [related, setRelated] = useState<string[]>(post?.related_app_ids ?? []);
  const [author, setAuthor] = useState(post?.author ?? "GetApkFree Team");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ slug: string; live: boolean } | null>(
    null,
  );

  const effectiveSlug = slug || slugify(title);

  function onTitleChange(next: string) {
    setTitle(next);
    if (!slugTouched) setSlug(slugify(next));
  }

  function validate(): string | null {
    if (!title.trim()) return "A title is required.";
    if (!effectiveSlug) return "A slug is required.";
    if (!description.trim()) return "A description is required for SEO.";
    if (!category) return "Pick a category.";
    return null;
  }

  async function save(publish: boolean) {
    setError(null);
    setSuccess(null);

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    if (editing && post!.published && !publish) {
      const ok = window.confirm(
        `“${post!.title}” is live. Saving as a draft removes it from the public blog. Continue?`,
      );
      if (!ok) return;
    }

    setSaving(true);
    const supabase = createClient();

    const row = {
      slug: effectiveSlug,
      title: title.trim(),
      description: description.trim(),
      content,
      featured_image_url: image.trim() || null,
      author: author.trim() || "GetApkFree Team",
      category,
      related_app_ids: related,
      published: publish,
    };

    try {
      if (editing) {
        const { error: updateError } = await supabase
          .from("blog_posts")
          .update(row)
          .eq("id", post!.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("blog_posts")
          .insert(row);
        if (insertError) throw insertError;
      }

      // The listing is cached for an hour; drop it so a publish is visible now.
      await fetch("/api/admin/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blogSlug: effectiveSlug }),
      }).catch(() => {
        /* the row is saved either way */
      });

      setSuccess({ slug: effectiveSlug, live: publish });
      router.refresh();

      if (!editing) {
        setTitle("");
        setSlug("");
        setSlugTouched(false);
        setDescription("");
        setImage("");
        setContent("");
        setRelated([]);
      }
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not save the post.";
      setError(
        message.includes("blog_posts_slug_key")
          ? `The slug “${effectiveSlug}” is already taken.`
          : message,
      );
    } finally {
      setSaving(false);
    }
  }

  const overLimit = description.length > DESCRIPTION_LIMIT;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(true);
      }}
      className="space-y-6"
    >
      {error && (
        <p className="rounded-xl border border-danger-500/40 bg-danger-500/10 p-4 text-sm text-danger-300">
          {error}
        </p>
      )}

      {success && (
        <p className="rounded-xl border border-brand-500/40 bg-brand-500/10 p-4 text-sm text-brand-300">
          {success.live ? "Published." : "Saved as a draft."}{" "}
          {success.live ? (
            <Link href={`/blog/${success.slug}`} className="underline">
              View the post
            </Link>
          ) : (
            <span className="text-brand-300/80">
              It will not appear on the public blog until you publish it.
            </span>
          )}
        </p>
      )}

      <div className="grid gap-5 rounded-2xl border border-base-800 bg-base-900 p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="post-title" className="block text-sm font-medium">
            Title <span className="text-danger-300">*</span>
          </label>
          <input
            id="post-title"
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="post-slug" className="block text-sm font-medium">
            Slug <span className="text-danger-300">*</span>
          </label>
          <input
            id="post-slug"
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 font-mono text-sm outline-none focus:border-brand-500"
          />
          <p className="mt-1.5 truncate font-mono text-xs text-fg-dim">
            {SITE_URL}/blog/
            <span className="text-brand-400">{effectiveSlug || "…"}</span>
          </p>
        </div>

        <div className="sm:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="post-description" className="text-sm font-medium">
              Description <span className="text-danger-300">*</span>
            </label>
            <span
              className={`font-mono text-xs ${
                overLimit ? "text-warn-300" : "text-fg-dim"
              }`}
            >
              {description.length}/{DESCRIPTION_LIMIT}
            </span>
          </div>
          <textarea
            id="post-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
          />
          <p className="mt-1 text-xs text-fg-dim">
            {overLimit
              ? "Search engines will truncate this."
              : "Used as the search snippet and the card excerpt."}
          </p>
        </div>

        <div>
          <label htmlFor="post-category" className="block text-sm font-medium">
            Category <span className="text-danger-300">*</span>
          </label>
          <select
            id="post-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
          >
            {BLOG_CATEGORIES.map((c) => (
              <option key={c} value={c} className="bg-base-850">
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="post-author" className="block text-sm font-medium">
            Author
          </label>
          <input
            id="post-author"
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
          />
        </div>

        <div className="sm:col-span-2">
          <ImageField
            label="Featured image"
            value={image}
            onChange={setImage}
            slug={effectiveSlug || "post"}
            kind="cover"
            bucket="blog-images"
            hint="Shown on the card and as the hero. 16:9 works best."
          />
        </div>

        <div className="sm:col-span-2">
          <RelatedAppPicker
            apps={apps}
            selected={related}
            onChange={setRelated}
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Content</p>
        <MarkdownEditor value={content} onChange={setContent} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-bold text-base-950 transition-colors hover:bg-brand-400 disabled:opacity-40"
        >
          {saving ? "Saving…" : editing ? "Update post" : "Publish"}
        </button>

        <button
          type="button"
          onClick={() => void save(false)}
          disabled={saving}
          className="rounded-xl border border-base-700 px-6 py-3 text-sm text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          Save as draft
        </button>

        {editing && (
          <p className="text-xs text-fg-dim">
            Last updated {new Date(post!.updated_at).toLocaleString()}
          </p>
        )}
      </div>
    </form>
  );
}
