import { createHash, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/admin";

/**
 * Shared pieces for the blog featured-image endpoints.
 *
 * Kept out of the route files so upload and delete cannot drift apart on
 * naming, auth or which bucket they touch.
 */

export const BUCKET = "blog-images";

/** OG card ratio. Anything larger is wasted bytes on a card nobody zooms. */
export const FULL = { width: 1200, height: 630 };
export const THUMB = { width: 600, height: 315 };
export const QUALITY = 82;

/**
 * Vercel rejects request bodies over 4.5MB before the function runs, so a
 * larger limit here would be a promise the platform breaks with an opaque 413.
 * The UI warns above this too, where the message can actually be useful.
 */
export const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Formats sharp can genuinely decode with the prebuilt binary.
 *
 * HEIC is deliberately absent. sharp ships libheif without the HEVC codec —
 * `heifsave: Unsupported compression` — and iPhone HEICs are HEVC-coded, so
 * they cannot be decoded here at any quality setting. AVIF is fine because it
 * is AV1, which is royalty-free and is compiled in.
 */
export const ACCEPTED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

const HEIC_MIME = ["image/heic", "image/heif"];

export type AuthResult =
  | { ok: true; via: "session" | "token" }
  | { ok: false; status: number; error: string };

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided.trim());
  const b = Buffer.from(expected.trim());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Accepts either an admin session or the CI bearer token.
 *
 * The session path is what the browser uses. Shipping the shared token to the
 * browser so the UI could send it would turn a CI credential into something
 * readable by anyone who opens devtools on the admin page — and it cannot be
 * rotated per-user or revoked for one person. The session already exists,
 * already backs every other admin surface, and RLS enforces it independently
 * of what any route remembers to check.
 *
 * The token path stays for curl and any future scripting, which have no
 * cookies to present.
 */
export async function authorise(request: Request): Promise<AuthResult> {
  const header = request.headers.get("authorization");
  const match = header?.match(/^\s*Bearer\s+(.+)\s*$/i);

  if (match) {
    const expected = process.env.BLOG_PUBLISH_TOKEN;
    if (!expected) {
      return {
        ok: false,
        status: 503,
        error: "BLOG_PUBLISH_TOKEN is not configured on this deployment.",
      };
    }
    if (!tokenMatches(match[1], expected)) {
      return { ok: false, status: 401, error: "Unauthorized: invalid token." };
    }
    return { ok: true, via: "token" };
  }

  if (await isAdmin()) return { ok: true, via: "session" };

  return {
    ok: false,
    status: 401,
    error: "Unauthorized: sign in as an admin, or send a bearer token.",
  };
}

/** Service-role client. Never reaches the browser — routes only. */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // The publish route uses BLOG_PUBLISH_SUPABASE_SERVICE_KEY; older code used
  // SUPABASE_SERVICE_ROLE_KEY. Accept either so this works whichever is set.
  const key =
    process.env.BLOG_PUBLISH_SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;
  return createClient(url.trim(), key.trim(), {
    auth: { persistSession: false },
  });
}

export type Processed = {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  /** Content hash, so identical input always lands on the same object name. */
  hash: string;
};

async function render(
  input: Buffer,
  size: { width: number; height: number },
): Promise<Processed> {
  const buffer = await sharp(input, { failOn: "error" })
    .rotate() // honour the EXIF orientation before metadata is dropped
    .resize({
      ...size,
      fit: "cover",
      // Crops toward whatever the saliency heuristic thinks the subject is,
      // rather than assuming it sits dead centre.
      position: sharp.strategy.attention,
      withoutEnlargement: false,
    })
    // sharp strips metadata by default, so there is deliberately no
    // .withMetadata() call here — that method *retains* it, which is the
    // opposite of what is wanted. Verified against the stored object: an input
    // carrying 204 bytes of EXIF comes out with none, so GPS coordinates from
    // a phone photo never reach the public bucket. .rotate() above has already
    // baked in the orientation flag, so dropping EXIF cannot turn an image
    // sideways.
    .webp({ quality: QUALITY, effort: 4 })
    .toBuffer();

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

/** Rejects what sharp cannot read, naming HEIC specifically. */
export function rejectUnsupported(mime: string, filename: string): string | null {
  const type = mime.toLowerCase();

  if (HEIC_MIME.includes(type) || /\.hei[cf]$/i.test(filename)) {
    return (
      "HEIC/HEIF is not supported. The image library here ships without the " +
      "HEVC decoder that Apple's format needs, so the file cannot be read at " +
      "all. Export as JPEG or PNG first — on iPhone, Settings → Camera → " +
      "Formats → Most Compatible."
    );
  }

  if (!(ACCEPTED_MIME as readonly string[]).includes(type)) {
    return `${mime || "That file"} is not a supported image. Use JPEG, PNG, WebP, GIF or AVIF.`;
  }

  return null;
}

export function objectPath(slug: string, hash: string, variant: "full" | "thumb") {
  return `${slug}/${hash}${variant === "thumb" ? "-thumb" : ""}.webp`;
}

export function publicUrl(
  db: NonNullable<ReturnType<typeof serviceClient>>,
  path: string,
) {
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Removes every object under a post's folder except the ones just written.
 *
 * Called after an upload so replacing an image does not leave the previous one
 * behind, and with an empty keep-set on delete.
 */
export async function pruneFolder(
  db: NonNullable<ReturnType<typeof serviceClient>>,
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
