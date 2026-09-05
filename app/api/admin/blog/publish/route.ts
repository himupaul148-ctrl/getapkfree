import { timingSafeEqual } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/** Constant-time, trimmed comparison. Lengths differ -> reject before the
 *  timingSafeEqual call, which throws on a length mismatch. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Same rule BLOG_POSTING.md documents and scripts/publish-blog-posts.mjs
 *  already enforces client-side: lowercase words joined by single hyphens.
 *  Repeated here because this route is reachable directly (with the publish
 *  token) without going through that script, and slug has no database-level
 *  format constraint — only UNIQUE. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Every post already in blog-posts/ is 597-2389 words; 500 sits comfortably
 *  below all of them while still catching an accidental stub (a post saved
 *  mid-draft, a truncated paste, a near-empty placeholder) before it goes
 *  live. Word count, not character count, since a "substantive content"
 *  check should track roughly how much was actually written, not how many
 *  characters a few long URLs or code blocks happen to add. */
const MIN_CONTENT_WORDS = 500;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
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
    const { title, description, content, slug, category, published } = body;
    const isPublished = published === true;

    // Validate required fields
    if (!title || !description || !slug || !category) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          required: ['title', 'description', 'slug', 'category'],
          received: Object.keys(body),
        },
        { status: 400 }
      );
    }

    // Slug format: the script already enforces this before it ever calls
    // this route, but this route is reachable directly with just the
    // publish token, and slug has no format constraint at the database
    // level (only UNIQUE) — so a malformed slug from any other caller would
    // otherwise insert silently.
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
      return NextResponse.json(
        {
          error: 'Invalid slug: must be lowercase words joined by hyphens',
          slug,
        },
        { status: 400 }
      );
    }

    // Minimum substantive content: catches an accidental stub before it
    // publishes, without touching the authoring workflow's own validation.
    if (typeof content !== 'string' || wordCount(content) < MIN_CONTENT_WORDS) {
      return NextResponse.json(
        {
          error: `Content is too short: ${typeof content === 'string' ? wordCount(content) : 0} words, minimum ${MIN_CONTENT_WORDS}`,
        },
        { status: 400 }
      );
    }

    // Initialize Supabase client with service role key
    const supabase = createClient(supabaseUrl, serviceRoleKey);

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
      // doesn't silently unpublish it.
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

      result = await supabase
        .from('blog_posts')
        .update(updatePayload)
        .eq('id', existingPost.id)
        .select();
    } else {
      // Insert new post — drafts by default unless published: true is sent
      result = await supabase
        .from('blog_posts')
        .insert({
          title,
          description,
          content,
          slug,
          category,
          published: isPublished,
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