"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import FeaturedImageUploader from "@/components/admin/FeaturedImageUploader";
import MarkdownEditor from "@/components/admin/MarkdownEditor";
import RelatedAppPicker, {
  type PickerApp,
} from "@/components/admin/RelatedAppPicker";
import TargetAppPicker from "@/components/admin/TargetAppPicker";
import { createClient } from "@/lib/supabase/client";
import {
  ARTICLE_TYPES,
  ARTICLE_TYPE_LABELS,
  BLOG_CATEGORIES,
  CATEGORY_LABELS,
  DEFAULT_ARTICLE_TYPE,
  type ArticleType,
  type BlogPost,
} from "@/lib/blog";
import { buildInsertRow, buildUpdateRow } from "@/lib/blog-editor-fields";
import { buildPreviewHref } from "@/lib/blog-preview";
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
  // Mirrors slugTouched above: starts false, flips true the moment THIS
  // session's uploader reports a change (a new upload, or an explicit
  // removal — both call onImageChange below). save() only writes
  // featured_image_url when this is true — see the comment on `row` for why.
  const [imageTouched, setImageTouched] = useState(false);
  // True while FeaturedImageUploader has an upload or delete in flight.
  // Saving while that's true would submit whatever `image` held *before*
  // the in-progress operation resolves — disabling the buttons removes the
  // window for that race entirely rather than trying to reconcile it after
  // the fact.
  const [imageBusy, setImageBusy] = useState(false);
  const [category, setCategory] = useState(post?.category ?? BLOG_CATEGORIES[0]);
  const [content, setContent] = useState(post?.content ?? "");
  const [related, setRelated] = useState<string[]>(post?.related_app_ids ?? []);
  const [author, setAuthor] = useState(post?.author ?? "GetApkFree Team");
  const [articleType, setArticleType] = useState<ArticleType>(
    post?.article_type ?? DEFAULT_ARTICLE_TYPE,
  );
  const [targetAppId, setTargetAppId] = useState<string | null>(
    post?.target_app_id ?? null,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<
    { slug: string; live: boolean; id: string } | null
  >(null);

  const effectiveSlug = slug || slugify(title);

  function onTitleChange(next: string) {
    setTitle(next);
    if (!slugTouched) setSlug(slugify(next));
  }

  // The one place `image` is ever set from here on — FeaturedImageUploader
  // calls this same callback for both a successful upload and an explicit
  // removal, so both paths correctly mark the field as touched. This is the
  // single authoritative path: upload/removal response -> this state ->
  // save()'s payload, with nothing else ever writing `image` or
  // `imageTouched` independently.
  function onImageChange(url: string) {
    setImage(url);
    setImageTouched(true);
  }

  /**
   * App Related -> General clears the target app intentionally, rather than
   * leaving it as stale hidden state the admin can't see once the picker
   * disappears. App Related -> Review/Other does NOT clear it — the
   * database allows an optional target app for review_other too (e.g. a
   * single-app review), so a target already chosen stays chosen unless the
   * admin explicitly removes it via TargetAppPicker's own clear control.
   */
  function onArticleTypeChange(next: ArticleType) {
    setArticleType(next);
    if (next === "general") setTargetAppId(null);
  }

  function validate(): string | null {
    if (!title.trim()) return "A title is required.";
    if (!effectiveSlug) return "A slug is required.";
    if (!description.trim()) return "A description is required for SEO.";
    if (!category) return "Pick a category.";
    if (articleType === "app_related" && !targetAppId) {
      return "Choose which app this article is about.";
    }
    return null;
  }

  async function save(publish: boolean) {
    setError(null);
    setSuccess(null);

    // Belt and braces alongside the buttons' own `disabled` below — an Enter
    // key in a text field submits the form directly and would skip a
    // disabled attribute entirely. Saving mid-upload would submit whatever
    // `image` held before that upload resolves.
    if (imageBusy) {
      setError("Wait for the image upload to finish before saving.");
      return;
    }

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

    const fields = {
      slug: effectiveSlug,
      title: title.trim(),
      description: description.trim(),
      content,
      author: author.trim() || "GetApkFree Team",
      category,
      relatedAppIds: related,
      published: publish,
      // Always touched: this form always holds a definite, current value
      // for both — loaded from the existing post on edit, defaulted on a
      // new one — the same way category/author are always resent rather
      // than tri-stated. The write layer's own tri-state support
      // (lib/blog-editor-fields.ts) exists for the OTHER write path (the
      // git-based frontmatter pipeline), which can genuinely omit these
      // fields; this form never can.
      articleType: { touched: true, value: articleType },
      targetAppId: { touched: true, value: targetAppId },
    };

    try {
      let savedId: string;

      if (editing) {
        // See lib/blog-editor-fields.ts for why featured_image_url is only
        // ever included in this payload when imageTouched is true.
        const { error: updateError } = await supabase
          .from("blog_posts")
          .update(buildUpdateRow(fields, image, imageTouched))
          .eq("id", post!.id);
        if (updateError) throw updateError;
        savedId = post!.id;
      } else {
        // .select().single() so the freshly-generated id comes back in the
        // same round trip — needed to link straight to this draft's preview
        // from the success message below, without a second query or forcing
        // a navigation away from this (now-reset) form.
        const { data: inserted, error: insertError } = await supabase
          .from("blog_posts")
          .insert(buildInsertRow(fields, image))
          .select("id")
          .single();
        if (insertError) throw insertError;
        savedId = inserted.id;
      }

      // The listing is cached for an hour; drop it so a publish is visible now.
      await fetch("/api/admin/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blogSlug: effectiveSlug }),
      }).catch(() => {
        /* the row is saved either way */
      });

      // The database now matches local state either way (untouched: left
      // alone and still matching; touched: just written) — reset so a later
      // save in this same session goes back to leaving the column alone
      // unless it's touched again.
      setImageTouched(false);
      setSuccess({ slug: effectiveSlug, live: publish, id: savedId });
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
            <>
              <Link
                href={buildPreviewHref(success.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Preview it
              </Link>{" "}
              <span className="text-brand-300/80">
                — it will not appear on the public blog until you publish it.
              </span>
            </>
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
          <label htmlFor="post-article-type" className="block text-sm font-medium">
            Article Type
          </label>
          <select
            id="post-article-type"
            value={articleType}
            onChange={(e) => onArticleTypeChange(e.target.value as ArticleType)}
            className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
          >
            {ARTICLE_TYPES.map((t) => (
              <option key={t} value={t} className="bg-base-850">
                {ARTICLE_TYPE_LABELS[t]}
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

        {/* Only for App Related (required) and Review/Other (optional — the
            database allows a single-app review). General never shows this:
            target_app_id isn't used there, and onArticleTypeChange above
            already clears any previously-chosen target the moment an admin
            switches back to General. */}
        {articleType !== "general" && (
          <div className="sm:col-span-2">
            <TargetAppPicker
              apps={apps}
              selectedId={targetAppId}
              onChange={setTargetAppId}
              required={articleType === "app_related"}
            />
          </div>
        )}

        <div className="sm:col-span-2">
          <FeaturedImageUploader
            slug={effectiveSlug}
            value={image}
            onChange={onImageChange}
            onBusyChange={setImageBusy}
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
          disabled={saving || imageBusy}
          className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-bold text-base-950 transition-colors hover:bg-brand-400 disabled:opacity-40"
        >
          {saving ? "Saving…" : imageBusy ? "Image uploading…" : editing ? "Update post" : "Publish"}
        </button>

        <button
          type="button"
          onClick={() => void save(false)}
          disabled={saving || imageBusy}
          className="rounded-xl border border-base-700 px-6 py-3 text-sm text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          Save as draft
        </button>

        {editing ? (
          <Link
            href={buildPreviewHref(post!.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-base-700 px-6 py-3 text-sm text-fg-muted transition-colors hover:text-fg"
          >
            Preview
          </Link>
        ) : (
          <span
            title="This post has no saved version yet — save it as a draft first, then use the Preview link that appears above."
            className="text-xs text-fg-dim"
          >
            Preview available after the first save
          </span>
        )}

        {editing && (
          <p className="text-xs text-fg-dim">
            Last updated {new Date(post!.updated_at).toLocaleString()}
          </p>
        )}
      </div>
    </form>
  );
}
