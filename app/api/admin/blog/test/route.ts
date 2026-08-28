import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.BLOG_PUBLISH_SUPABASE_SERVICE_KEY;

    // Validate environment variables
    if (!supabaseUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SUPABASE_URL is missing' },
        { status: 500 }
      );
    }

    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: 'BLOG_PUBLISH_SUPABASE_SERVICE_KEY is missing' },
        { status: 500 }
      );
    }

    // Initialize Supabase client with service role key
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Test the connection by querying blog_posts table
    const { data, error, count } = await supabase
      .from('blog_posts')
      .select('*', { count: 'exact' })
      .limit(1);

    if (error) {
      return NextResponse.json(
        {
          error: 'Failed to query blog_posts table',
          details: error.message,
          code: error.code,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Supabase connection successful',
        environment: {
          supabaseUrl: supabaseUrl.substring(0, 30) + '...',
          hasServiceRoleKey: !!serviceRoleKey,
        },
        database: {
          totalBlogPosts: count,
          sample: data?.[0] || null,
        },
      },
      { status: 200 }
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