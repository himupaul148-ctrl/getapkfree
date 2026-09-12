import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCEPTED_MIME,
  FULL,
  MAX_BYTES,
  QUALITY,
  rejectUnsupported,
  THUMB,
  WEBP_EFFORT,
} from "./blog-image-policy.ts";

/**
 * Image processing and storage for the blog featured-image endpoints.
 *
 * Deliberately has NO dependency on lib/blog-image-auth.ts (authorise,
 * serviceClient) or anything that reads cookies/next/headers — that split
 * is what keeps this file's sharp/storage logic importable, and therefore
 * unit-testable (lib/blog-images.test.ts), under a plain `node --test` run.
 * The route (app/api/admin/blog/image/route.ts) imports from both files.
 *
 * The accepted-format list, size limit, and output dimensions/quality live
 * in lib/blog-image-policy.ts (no imports of any kind there) and are
 * re-exported here so existing importers of this module do not need to change.
 */

export { ACCEPTED_MIME, FULL, MAX_BYTES, QUALITY, rejectUnsupported, THUMB };

export const BUCKET = "blog-images";

export type Processed = {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  /** Content hash, so identical input always lands on the same object name. */
  hash: string;
};

/**
 * Resizes+crops `input` to exactly `size`, encoded as WebP. Exported (rather
 * than kept as a render() implementation detail) so its cover-crop behaviour
 * — always exactly the target dimensions, whatever the source aspect ratio,
 * never stretched — can be unit-tested directly against synthetic images.
 *
 * Cropping tries sharp's "attention" saliency heuristic first, so the crop
 * favours whatever the image actually has in it rather than assuming the
 * subject sits dead centre. That heuristic is always present in the
 * prebuilt sharp binary this project depends on, so the fallback below is
 * defensive rather than a case expected to trigger in production — but a
 * resize is never allowed to simply fail outright because a saliency pass
 * had trouble with a particular image; the crop must always still produce
 * the exact target box, just centred instead of subject-aware.
 */
export async function resizeCover(
  input: Buffer,
  size: { width: number; height: number },
  options: { smartCrop?: boolean } = {},
): Promise<Buffer> {
  const smartCrop = options.smartCrop ?? true;

  const pipeline = () =>
    sharp(input, { failOn: "error" })
      .rotate() // honour the EXIF orientation before metadata is dropped
      .resize({
        ...size,
        fit: "cover",
        ...(smartCrop ? { position: sharp.strategy.attention } : {}),
        withoutEnlargement: false,
      })
      // sharp strips metadata by default, so there is deliberately no
      // .withMetadata() call here — that method *retains* it, which is the
      // opposite of what is wanted. Verified against the stored object: an
      // input carrying 204 bytes of EXIF comes out with none, so GPS
      // coordinates from a phone photo never reach the public bucket.
      // .rotate() above has already baked in the orientation flag, so
      // dropping EXIF cannot turn an image sideways.
      .webp({ quality: QUALITY, effort: WEBP_EFFORT })
      .toBuffer();

  if (!smartCrop) return pipeline();

  try {
    return await pipeline();
  } catch {
    // The saliency pass itself failed on this particular image — fall back
    // to a plain centred cover-crop rather than surfacing an error for
    // something a simpler crop would have handled fine.
    return resizeCover(input, size, { smartCrop: false });
  }
}

async function render(
  input: Buffer,
  size: { width: number; height: number },
): Promise<Processed> {
  const buffer = await resizeCover(input, size);
  const meta = await sharp(buffer).metadata();

  return {
    buffer,
    width: meta.width ?? size.width,
    height: meta.height ?? size.height,
    bytes: buffer.length,
    hash: createHash("sha256").update(buffer).digest("hex").slice(0, 16),
  };
}

export type ProcessedPair = { full: Processed; thumb: Processed };

/** Throws with a readable message when the bytes are not a usable image. */
export async function processImage(input: Buffer): Promise<ProcessedPair> {
  const [full, thumb] = await Promise.all([render(input, FULL), render(input, THUMB)]);
  return { full, thumb };
}

export function objectPath(slug: string, hash: string, variant: "full" | "thumb") {
  return `${slug}/${hash}${variant === "thumb" ? "-thumb" : ""}.webp`;
}

export function publicUrl(db: SupabaseClient, path: string) {
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Removes every object under a post's folder except the ones just written.
 *
 * Callers (app/api/admin/blog/image/route.ts) run this only *after* the
 * database row has been confirmed pointing at the new state — never before
 * — so a database write failing partway through can never leave a post
 * referencing a file this function already deleted. An old file lingering a
 * little longer than strictly necessary is harmless; a post pointing at a
 * 404 is not.
 */
export async function pruneFolder(
  db: SupabaseClient,
  slug: string,
  keep: string[] = [],
): Promise<string[]> {
  const { data, error } = await db.storage.from(BUCKET).list(slug, { limit: 100 });
  if (error || !data) return [];

  const doomed = data
    .map((entry) => `${slug}/${entry.name}`)
    .filter((path) => !keep.includes(path));

  if (doomed.length > 0) await db.storage.from(BUCKET).remove(doomed);
  return doomed;
}

/** Alias kept for readability at call sites — this is just the real Supabase client type. */
export type SupabaseLike = SupabaseClient;

export type FeaturedImageUploadResult =
  | { ok: true; url: string; thumbUrl: string; updated: boolean; removed: string[] }
  | { ok: false; error: string };

/**
 * The safety-critical core of the upload endpoint, once the two processed
 * buffers already exist: write them to storage, then point the post at the
 * new URL, and only once *that* database write is confirmed does it prune
 * whatever else was sitting in the slug's folder.
 *
 * Extracted from the route handler specifically so this ordering — never
 * deleting an old image before the database is confirmed pointing at its
 * replacement — is directly unit-testable against a minimal fake client,
 * rather than only verifiable by reading the route file. See
 * lib/blog-images.test.ts for the tests this exists to support:
 * "old featured_image_url is not cleared when processing fails" and
 * "database update happens only after successful processing/storage" are
 * really both properties of this function's ordering.
 */
export async function applyFeaturedImageUpload(
  db: SupabaseLike,
  params: {
    slug: string;
    fullPath: string;
    thumbPath: string;
    fullBuffer: Buffer;
    thumbBuffer: Buffer;
  },
): Promise<FeaturedImageUploadResult> {
  for (const [path, buffer] of [
    [params.fullPath, params.fullBuffer],
    [params.thumbPath, params.thumbBuffer],
  ] as const) {
    const { error } = await db.storage.from(BUCKET).upload(path, buffer, {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) return { ok: false, error: `Upload failed: ${error.message}` };
  }

  const url = publicUrl(db, params.fullPath);
  const thumbUrl = publicUrl(db, params.thumbPath);

  // The post may not exist yet — an author can pick an image before the
  // first publish — so a missing row (data null, error null) is not itself
  // an error; only a genuine database error is.
  const { data: updated, error: updateError } = await db
    .from("blog_posts")
    .update({ featured_image_url: url })
    .eq("slug", params.slug)
    .select("id")
    .maybeSingle();

  if (updateError) {
    // The new image is already safely stored — nothing to unwind. It sits
    // as an extra, harmless object under this slug's folder (named by
    // content hash, so a retry reuses it rather than duplicating it) until
    // a future successful save prunes it away.
    return {
      ok: false,
      error:
        `The image was processed and stored, but saving it to the post failed: ` +
        `${updateError.message}. Nothing was changed — try again.`,
    };
  }

  const removed = await pruneFolder(db, params.slug, [params.fullPath, params.thumbPath]);
  return { ok: true, url, thumbUrl, updated: Boolean(updated), removed };
}

export type FeaturedImageDeleteResult =
  | { ok: true; updated: boolean; removed: string[] }
  | { ok: false; error: string };

/** Same database-then-storage ordering as applyFeaturedImageUpload, for removal. */
export async function applyFeaturedImageDelete(
  db: SupabaseLike,
  slug: string,
): Promise<FeaturedImageDeleteResult> {
  const { data: updated, error: updateError } = await db
    .from("blog_posts")
    .update({ featured_image_url: null })
    .eq("slug", slug)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return {
      ok: false,
      error: `Removing the featured image failed: ${updateError.message}. Nothing was changed — try again.`,
    };
  }

  const removed = await pruneFolder(db, slug, []);
  return { ok: true, updated: Boolean(updated), removed };
}
