import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

    // Check authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${publishToken}`) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing token' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { title, description, content, slug } = body;

    // Validate required fields
    if (!title || !description || !slug) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          required: ['title', 'description', 'slug'],
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
      // Update existing post
      result = await supabase
        .from('blog_posts')
        .update({
          title,
          description,
          content,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingPost.id)
        .select();
    } else {
      // Insert new post
      result = await supabase
        .from('blog_posts')
        .insert({
          title,
          description,
          content,
          slug,
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

    return NextResponse.json(
      {
        success: true,
        message: existingPost ? 'Blog post updated' : 'Blog post created',
        post: result.data?.[0],
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