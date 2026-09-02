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