import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import {
  BUCKET,
  MAX_BYTES,
  authorise,
  objectPath,
  processImage,
  pruneFolder,
  publicUrl,
  rejectUnsupported,
  serviceClient,
} from "@/lib/blog-images";

// sharp is a native binary; it cannot run on the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readSlug(value: FormDataEntryValue | string | null): string | null {
  const slug = String(value ?? "").trim().toLowerCase();
  return slug && SLUG_RE.test(slug) ? slug : null;
}

/* ------------------------------------------------------------------ POST */

export async function POST(request: NextRequest) {
  const auth = await authorise(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data with 'file' and 'slug' fields." },
      { status: 400 },
    );
  }

  const slug = readSlug(form.get("slug"));
  if (!slug) {
    return NextResponse.json(
      { error: "A valid post slug is required (lowercase words joined by hyphens)." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  const unsupported = rejectUnsupported(file.type, file.name);
  if (unsupported) {
    return NextResponse.json({ error: unsupported }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ` +
          `${MAX_BYTES / 1024 / 1024}MB — Vercel rejects larger request bodies ` +
          `before this route runs. Resize it, or export at a lower quality.`,
      },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  }

  const db = serviceClient();
  if (!db) {
    return NextResponse.json(
      { error: "Supabase is not configured on this deployment." },
      { status: 503 },
    );
  }

  // ---- Process -----------------------------------------------------------

  let processed;
  try {
    processed = await processImage(Buffer.from(await file.arrayBuffer()));
  } catch (caught) {
    // A corrupt file, or a real format sharp cannot decode despite its mime.
    return NextResponse.json(
      {
        error:
          "That image could not be read. It may be corrupt, or saved in a " +
          "format this server cannot decode. Re-export it as JPEG or PNG.",
        details: caught instanceof Error ? caught.message : undefined,
      },
      { status: 400 },
    );
  }

  const { full, thumb } = processed;
  const fullPath = objectPath(slug, full.hash, "full");
  const thumbPath = objectPath(slug, thumb.hash, "thumb");

  // ---- Upload ------------------------------------------------------------
  //
  // upsert because the name is the content hash: re-uploading identical bytes
  // must land on the same object rather than erroring or accumulating copies.

  for (const [path, buffer] of [
    [fullPath, full.buffer],
    [thumbPath, thumb.buffer],
  ] as const) {
    const { error } = await db.storage.from(BUCKET).upload(path, buffer, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) {
      return NextResponse.json(
        { error: `Upload failed: ${error.message}` },
        { status: 502 },
      );
    }
  }

  // Old images for this post go now, not later — an orphan in a public bucket
  // is a file nobody can find and nobody will clean up.
  const removed = await pruneFolder(db, slug, [fullPath, thumbPath]);

  const url = publicUrl(db, fullPath);
  const thumbUrl = publicUrl(db, thumbPath);

  // ---- Point the post at it ---------------------------------------------
  //
  // The post may not exist yet — an author can pick an image before the first
  // publish — so a missing row is not an error.
  const { data: updated } = await db
    .from("blog_posts")
    .update({ featured_image_url: url })
    .eq("slug", slug)
    .select("id")
    .maybeSingle();

  // The post may already be published — getPublishedPosts is cached for an
  // hour and the post page is ISR, so without this the old image keeps
  // serving until that window lapses, with nothing to shorten it. Safe to
  // call even when nothing was actually published yet: revalidating a path
  // Next hasn't generated, or a tag nothing is cached under, is a no-op.
  revalidateTag("blog", "max");
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);

  return NextResponse.json({
    ok: true,
    slug,
    url,
    thumbUrl,
    postUpdated: Boolean(updated),
    replaced: removed.length,
    full: { width: full.width, height: full.height, bytes: full.bytes },
    thumb: { width: thumb.width, height: thumb.height, bytes: thumb.bytes },
    originalBytes: file.size,
  });
}

/* ---------------------------------------------------------------- DELETE */

export async function DELETE(request: NextRequest) {
  const auth = await authorise(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Accept the slug from either the query string or a JSON body, since a
  // DELETE with a body is awkward from some clients.
  let slug = readSlug(request.nextUrl.searchParams.get("slug"));
  if (!slug) {
    try {
      const body = await request.json();
      slug = readSlug(body?.slug);
    } catch {
      /* no body is fine */
    }
  }

  if (!slug) {
    return NextResponse.json(
      { error: "A valid post slug is required." },
      { status: 400 },
    );
  }

  const db = serviceClient();
  if (!db) {
    return NextResponse.json(
      { error: "Supabase is not configured on this deployment." },
      { status: 503 },
    );
  }

  // Idempotent: an empty folder and a missing post both count as done, because
  // the caller's intent — "this post has no featured image" — is satisfied.
  const removed = await pruneFolder(db, slug, []);

  const { data: updated } = await db
    .from("blog_posts")
    .update({ featured_image_url: null })
    .eq("slug", slug)
    .select("id")
    .maybeSingle();

  // Same reasoning as the upload path above: drop the caches this write
  // could be invalidating.
  revalidateTag("blog", "max");
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);

  return NextResponse.json({
    ok: true,
    slug,
    removed: removed.length,
    postUpdated: Boolean(updated),
  });
}
