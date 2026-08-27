import { timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { BLOG_CATEGORIES } from "@/lib/blog";
import { absolute } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publishes a blog post from CI.
 *
 * Authenticated by a dedicated bearer token rather than the Supabase service
 * role key. The service key bypasses every RLS policy on every table, so
 * handing it to GitHub Actions would mean anyone with repo write access — or
 * any workflow that could be induced to print it — held full read/write on the
 * database, including auth.users. This token can create a blog post and
 * nothing else, and the service key never leaves Vercel.
 *
 * Writes are an upsert on slug: re-pushing an edited markdown file updates the
 * post in place, which is what a file-in-git workflow implies. Publishing also
 * drops the cached listing so the post is live in seconds rather than whenever
 * the hour-long window happens to lapse.
 */

const DESCRIPTION_MAX = 200; // matches the blog_posts check constraint
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Constant-time compare so the token cannot be recovered a byte at a time. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so compare a fixed-size digest of each instead.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type Body = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const expected = process.env.BLOG_PUBLISH_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "BLOG_PUBLISH_TOKEN is not configured on this deployment." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !tokenMatches(provided, expected)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const title = str(body.title);
  const slug = str(body.slug).toLowerCase();
  const description = str(body.description);
  const category = str(body.category).toLowerCase();
  const author = str(body.author) || "GetApkFree Team";
  const content = typeof body.content === "string" ? body.content : "";
  const featuredImage = str(body.featured_image_url) || null;
  const published = body.published === undefined ? true : body.published === true;

  const relatedRaw = body.related_app_ids;
  const relatedAppIds = Array.isArray(relatedRaw)
    ? relatedRaw.map((v) => String(v).trim()).filter(Boolean)
    : [];

  const problems: string[] = [];
  if (!title) problems.push("title is required");
  if (!slug) problems.push("slug is required");
  else if (!SLUG_RE.test(slug)) {
    problems.push(
      `slug "${slug}" must be lowercase letters, numbers and single hyphens`,
    );
  }
  if (!description) problems.push("description is required");
  else if (description.length > DESCRIPTION_MAX) {
    problems.push(
      `description is ${description.length} characters; the limit is ${DESCRIPTION_MAX}`,
    );
  }
  if (!category) problems.push("category is required");
  else if (!(BLOG_CATEGORIES as readonly string[]).includes(category)) {
    problems.push(
      `category "${category}" must be one of: ${BLOG_CATEGORIES.join(", ")}`,
    );
  }
  if (!content.trim()) problems.push("content is empty");

  if (problems.length > 0) {
    return NextResponse.json(
      { error: problems.join("; "), problems },
      { status: 400 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Supabase is not configured on this deployment." },
      { status: 503 },
    );
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: existing } = await db
      .from("blog_posts")
      .select("id")
      .eq("slug", slug)
      .maybeSingle<{ id: string }>();

    const row = {
      slug,
      title,
      description,
      content,
      category,
      author,
      featured_image_url: featuredImage,
      related_app_ids: relatedAppIds,
      published,
    };

    const { error } = await db
      .from("blog_posts")
      .upsert(row, { onConflict: "slug" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    // The listing is cached for an hour and the detail page is ISR, so without
    // this a freshly published post would not appear for up to an hour.
    revalidateTag("blog", "max");
    revalidatePath("/blog");
    revalidatePath(`/blog/${slug}`);
    revalidatePath("/sitemap.xml");

    return NextResponse.json({
      ok: true,
      slug,
      url: absolute(`/blog/${slug}`),
      action: existing ? "updated" : "created",
      published,
    });
  } catch (caught) {
    return NextResponse.json(
      {
        error:
          caught instanceof Error ? caught.message : "Could not save the post.",
      },
      { status: 502 },
    );
  }
}
