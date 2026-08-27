import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drops the cached catalogue after an admin writes to it.
 *
 * `getCatalogue` is wrapped in unstable_cache with a one-hour window, so
 * without this a newly added app stays invisible on the homepage until the
 * window lapses — the tag existed but nothing was clearing it.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  let slug: string | null = null;
  let blogSlug: string | null = null;
  try {
    const body = await request.json();
    slug = body.slug ? String(body.slug) : null;
    blogSlug = body.blogSlug ? String(body.blogSlug) : null;
  } catch {
    /* body is optional */
  }

  // Next 16 takes a revalidation profile as the second argument; the
  // single-argument form is deprecated. "max" gives stale-while-revalidate,
  // so the admin never waits on a cold catalogue query.
  revalidateTag("catalogue", "max");
  // The homepage is force-dynamic, but its cached data comes from the tag
  // above; the detail page is ISR and needs its own path dropped.
  if (slug) revalidatePath(`/app/${slug}`);

  // Blog posts have their own cache tag and their own ISR paths.
  if (blogSlug) {
    revalidateTag("blog", "max");
    revalidatePath("/blog");
    revalidatePath(`/blog/${blogSlug}`);
  }

  revalidatePath("/sitemap.xml");

  return NextResponse.json({ revalidated: true, slug, blogSlug });
}
