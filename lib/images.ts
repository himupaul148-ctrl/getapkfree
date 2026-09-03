/**
 * Hosts the Next image optimiser is allowed to fetch from.
 *
 * next/image refuses any host not listed in `remotePatterns`, returning a 400
 * — which is how Play Store icons silently degraded to initials badges when
 * external listings were added without updating the config.
 *
 * Admins can paste an image URL from anywhere, and opening the optimiser up to
 * `**` would turn it into a free image proxy for the whole internet. So the
 * allowlist stays tight and `isOptimisable` tells the components when to fall
 * back to rendering an unoptimised <img> instead of failing outright.
 */

/**
 * Derived so the storage host follows whichever Supabase project is
 * configured. Exported because next.config.ts needs the same hostname for the
 * CSP `connect-src`, and deriving it twice is how the two end up disagreeing.
 */
export function supabaseHost(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export const OPTIMISED_IMAGE_HOSTS: string[] = [
  "f-droid.org",
  "placehold.co",
  // Play Store icons and screenshots.
  "play-lh.googleusercontent.com",
  // GitHub owner avatars, used as the icon for repo-sourced listings.
  "avatars.githubusercontent.com",
  "raw.githubusercontent.com",
  ...(supabaseHost() ? [supabaseHost() as string] : []),
];

/**
 * True when next/image will accept the URL. Anything else still renders — the
 * components drop to `unoptimized` — it just does not get resized or
 * converted, which is the right trade for a hand-pasted one-off.
 */
export function isOptimisable(src: string | null | undefined): boolean {
  if (!src) return false;
  // Relative paths are served by us and are always fine.
  if (src.startsWith("/")) return true;
  try {
    return OPTIMISED_IMAGE_HOSTS.includes(new URL(src).hostname);
  } catch {
    return false;
  }
}
