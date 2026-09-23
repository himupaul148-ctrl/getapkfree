import { timingSafeEqual } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateBlogPost } from '@/lib/blog-validation';

/** Constant-time, trimmed comparison. Lengths differ -> reject before the
 *  timingSafeEqual call, which throws on a length mismatch. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Case-insensitive, whitespace-normalised comparison — "My  Post" and
 *  "my post" collide, "My Post" and "My Post 2" do not. */
function normaliseTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.BLOG_PUBLISH_SUPABASE_SERVICE_KEY;
    const publishToken = process.env.BLOG_PUBLISH_TOKEN;

    // Validate environment variables
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: 'Supabase configuration is missing' },
        { status: 500 }
      );
    }

    // Validate authorization token
    if (!publishToken) {
      return NextResponse.json(
        { error: 'BLOG_PUBLISH_TOKEN is not configured' },
        { status: 500 }
      );
    }

    // Check authorization header.
    //
    // Three things the previous `authHeader !== \`Bearer ${token}\`` got wrong:
    // it compared in variable time, which leaks the token a byte at a time to
    // a patient attacker; it was case-sensitive on the scheme, though RFC 7235
    // makes it case-insensitive; and it compared untrimmed, so a value pasted
    // into a secrets box with a trailing newline failed while looking
    // identical in both dashboards.
    const authHeader = request.headers.get('authorization');
    const match = authHeader?.match(/^\s*Bearer\s+(.+)\s*$/i);
    if (!match || !tokenMatches(match[1], publishToken)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing token' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();

    // Shape validation: required fields, slug format, description length,
    // category membership, minimum content length, and related_app_ids
    // format — all centralized in lib/blog-validation.ts so this route and
    // any future caller of that module apply the exact same rules. Existence
    // checks that need a live Supabase query (related_app_ids, slug
    // uniqueness, title collision) stay below, in this route, same as
    // before.
    const validation = validateBlogPost(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error, ...(validation.extra ?? {}) },
        { status: 400 },
      );
    }

    const {
      title,
      description,
      content,
      slug,
      category,
      published,
      relatedAppIds: relatedAppIdsResult,
      featuredImageUrl,
      articleType,
      targetAppId,
    } = validation.data;
    const isPublished = published === true;

    // Initialize Supabase client with service role key
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // related_app_ids: existence check. One batched query against every
    // unique requested ID — never one query per ID — comparing the returned
    // set against what was requested. Any ID that doesn't resolve to a real
    // app rejects the whole request before anything is written; silently
    // dropping the bad ones would let a typo publish successfully and just
    // quietly fail to show up in that post's sidebar later.
    if (relatedAppIdsResult.provided && relatedAppIdsResult.ids.length > 0) {
      const uniqueIds = [...new Set(relatedAppIdsResult.ids)];
      const { data: foundApps, error: appsError } = await supabase
        .from('apps')
        .select('id')
        .in('id', uniqueIds);

      if (appsError) {
        return NextResponse.json(
          { error: 'Failed to validate related_app_ids', details: appsError.message },
          { status: 500 }
        );
      }

      const foundIds = new Set((foundApps ?? []).map((app) => app.id));
      const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        return NextResponse.json(
          { error: 'related_app_ids references apps that do not exist', missingIds },
          { status: 400 }
        );
      }
    }

    // target_app_id: existence check, same shape as related_app_ids above.
    // validateBlogPost() already rejected article_type: "app_related" with
    // no target_app_id at all (a format-only check); this is the live
    // Supabase check that a *provided* target_app_id (required for
    // app_related, optional for general/review_other) actually resolves to
    // a real app — the one thing the pure validator cannot know.
    if (targetAppId.provided && targetAppId.value !== null) {
      const { data: targetApp, error: targetAppError } = await supabase
        .from('apps')
        .select('id')
        .eq('id', targetAppId.value)
        .maybeSingle();

      if (targetAppError) {
        return NextResponse.json(
          { error: 'Failed to validate target_app_id', details: targetAppError.message },
          { status: 500 }
        );
      }

      if (!targetApp) {
        return NextResponse.json(
          { error: 'target_app_id does not reference an existing app', targetAppId: targetAppId.value },
          { status: 400 }
        );
      }
    }

    // Check if blog post already exists
    const { data: existingPost, error: checkError } = await supabase
      .from('blog_posts')
      .select('id')
      .eq('slug', slug)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 = no rows found (expected for new posts)
      return NextResponse.json(
        { error: 'Failed to check existing post', details: checkError.message },
        { status: 500 }
      );
    }

    // Exact-title collision: catches the same topic accidentally published
    // twice under two different slugs. Compares against every other
    // published post's title, excluding this post's own row (by id when
    // updating) so re-saving a post under its unchanged title is not a
    // false positive.
    const { data: publishedTitles, error: titlesError } = await supabase
      .from('blog_posts')
      .select('id, title')
      .eq('published', true);

    if (titlesError) {
      return NextResponse.json(
        { error: 'Failed to check existing titles', details: titlesError.message },
        { status: 500 }
      );
    }

    const normalisedTitle = normaliseTitle(title);
    const collision = (publishedTitles ?? []).find(
      (post) =>
        post.id !== existingPost?.id && normaliseTitle(post.title) === normalisedTitle,
    );
    if (collision) {
      return NextResponse.json(
        {
          error: 'A published post with this exact title already exists',
          conflictingPostId: collision.id,
        },
        { status: 409 }
      );
    }

    let result;

    if (existingPost) {
      // Update existing post. Only touch `published` if the caller
      // explicitly sent it, so re-running an update on a live post
      // doesn't silently unpublish it. related_app_ids follows the same
      // rule: only set when the request actually provided it (an explicit
      // [] included), so a routine content republish whose frontmatter has
      // no related_app_ids at all can never erase a value someone curated
      // by hand through the admin editor.
      const updatePayload: Record<string, unknown> = {
        title,
        description,
        content,
        category,
        updated_at: new Date().toISOString(),
      };

      if (published !== undefined) {
        updatePayload.published = isPublished;
      }

      if (relatedAppIdsResult.provided) {
        updatePayload.related_app_ids = relatedAppIdsResult.ids;
      }

      // Same rule as published/related_app_ids above: only touch the column
      // when the request body actually has the key (an explicit null is a
      // real "clear the image" instruction and is written as such), so a
      // routine content republish whose payload never mentions
      // featured_image_url at all can't silently wipe out an image set
      // through the admin editor.
      if (featuredImageUrl.provided) {
        updatePayload.featured_image_url = featuredImageUrl.value;
      }

      // Same tri-state rule again, for the three-type blog system: a post
      // classified app_related through the admin UI must not have that
      // classification (or its target app) silently cleared back to
      // general/null by a routine republish whose frontmatter never
      // mentions either field.
      if (articleType.provided) {
        updatePayload.article_type = articleType.value;
      }
      if (targetAppId.provided) {
        updatePayload.target_app_id = targetAppId.value;
      }

      result = await supabase
        .from('blog_posts')
        .update(updatePayload)
        .eq('id', existingPost.id)
        .select();
    } else {
      // Insert new post — drafts by default unless published: true is sent.
      // related_app_ids is always included: [] when the request didn't
      // provide it, matching the column's own NOT NULL default.
      // featured_image_url is likewise always included: null when the
      // request didn't provide one, since there is no existing value to
      // protect on a brand-new row. article_type/target_app_id follow suit:
      // there is nothing existing to protect on an insert, so both are
      // always included — DEFAULT_ARTICLE_TYPE ('general') and null when
      // the request didn't mention them, matching the database column's own
      // `not null default 'general'`.
      result = await supabase
        .from('blog_posts')
        .insert({
          title,
          description,
          content,
          slug,
          category,
          published: isPublished,
          related_app_ids: relatedAppIdsResult.ids,
          featured_image_url: featuredImageUrl.value,
          article_type: articleType.value,
          target_app_id: targetAppId.value,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select();
    }

    if (result.error) {
      return NextResponse.json(
        {
          error: 'Failed to publish blog post',
          details: result.error.message,
          code: result.error.code,
        },
        { status: 500 }
      );
    }

    const post = result.data?.[0];

    /*
     * Drop the caches this write invalidates.
     *
     * `getPublishedPosts` is wrapped in unstable_cache with a one-hour window
     * and the post pages are ISR, so without this a post pushed from
     * blog-posts/ stays invisible until the window lapses — which reads as a
     * broken pipeline rather than a cold cache.
     *
     * This route cannot call /api/admin/revalidate the way the admin
     * components do: that endpoint authorises on an admin session cookie, and
     * the Actions runner authenticates with a bearer token instead. So it
     * invalidates directly.
     *
     * Runs for drafts too — a post flipped from published back to draft has to
     * leave the listing just as promptly as it joined it.
     */
    revalidateTag('blog', 'max');
    revalidatePath('/blog');
    revalidatePath(`/blog/${slug}`);
    revalidatePath('/sitemap.xml');

    return NextResponse.json(
      {
        success: true,
        message: existingPost ? 'Blog post updated' : 'Blog post created',
        status: post?.published ? 'published' : 'draft',
        post,
      },
      { status: existingPost ? 200 : 201 }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { error: 'Use POST to publish a blog post' },
    { status: 405 }
  );
}