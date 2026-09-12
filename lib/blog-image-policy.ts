/**
 * Pure policy for blog featured images — accepted formats, the size limit,
 * and the standard output dimensions/quality. No server-only imports here
 * (no sharp, no Supabase client), so this is safe for both the "use client"
 * uploader (components/admin/FeaturedImageUploader.tsx) and the server-side
 * processor (lib/blog-images.ts) to import — the two previously each kept
 * their own copy of the size limit and accepted-type list, which is exactly
 * the kind of thing that quietly drifts apart. Now there is one definition.
 */

/** OG-card ratio. Anything larger is wasted bytes on a card nobody zooms. */
export const FULL = { width: 1200, height: 630 } as const;
export const THUMB = { width: 600, height: 315 } as const;

/** WebP quality (0-100) for the output. 82 holds up well for a photo-style
 *  hero image while staying well clear of visible banding; pushing higher
 *  buys very little perceptible quality for a real jump in bytes. */
export const QUALITY = 82;

/** sharp's CPU/size trade-off knob for WebP encoding (0 fastest, 6 smallest).
 *  4 is sharp's own default and lands well for a one-off admin upload — this
 *  never runs in a hot request path, so there is no reason to trade quality
 *  for encode speed. */
export const WEBP_EFFORT = 4;

/**
 * Vercel rejects request bodies over 4.5MB before the function runs, so a
 * larger limit here would be a promise the platform breaks with an opaque 413.
 * The UI warns above this too, where the message can actually be useful.
 */
export const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Formats sharp can genuinely decode with the prebuilt binary this project
 * depends on.
 *
 * HEIC is deliberately absent. sharp ships libheif without the HEVC codec —
 * `heifsave: Unsupported compression` — and iPhone HEICs are HEVC-coded, so
 * they cannot be decoded here at any quality setting. AVIF is fine because it
 * is AV1, which is royalty-free and is compiled in. GIF is accepted — sharp
 * reads its first frame, which is exactly the "safely converted from a
 * static frame" case; nothing here attempts to preserve animation.
 */
export const ACCEPTED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

const HEIC_MIME = ["image/heic", "image/heif"];

/**
 * Rejects what sharp cannot read, naming HEIC specifically since that's the
 * one format real users actually hit (an iPhone's default camera format).
 * Server-side callers still cannot trust this alone — a spoofed MIME type
 * only ever gets this far as a fast, cheap pre-check; the authoritative
 * check is sharp's own decode attempt on the real bytes (see
 * lib/blog-images.ts's processImage), which fails safely on anything this
 * check happened to let through incorrectly.
 */
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

/** True when a file exceeds the shared upload limit. */
export function isOversized(bytes: number): boolean {
  return bytes > MAX_BYTES;
}

/** The `accept` attribute value for a file `<input>`, derived from the same list the server checks. */
export const ACCEPT_ATTR = ACCEPTED_MIME.join(",");
