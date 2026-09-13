/**
 * Validates that a string is a public Google Play app-listing URL and
 * extracts its package id — the one thing this project is allowed to derive
 * from Play without touching any private/internal API: the `?id=` query
 * parameter on the public `play.google.com/store/apps/details` page, the
 * same public URL fromPlay() (lib/metadata/fetchers.ts) already fetches.
 *
 * Kept separate from fetchers.ts and dependency-free (no fetch, no
 * Supabase, no next/cache) specifically so it can be imported directly
 * under this project's plain `node --test` runner — see
 * lib/apk/catalogue-select.test.ts and friends for the same constraint
 * documented elsewhere.
 */

export type PlayUrlResult =
  | { ok: true; url: string; packageName: string }
  | { ok: false; reason: string };

export function parsePlayUrl(raw: string): PlayUrlResult {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "play.google.com") {
    return { ok: false, reason: `not a play.google.com URL (host: "${host}")` };
  }

  if (!/^\/store\/apps\/details\/?$/.test(parsed.pathname)) {
    return {
      ok: false,
      reason: `not a Play Store app-details URL (path: "${parsed.pathname}")`,
    };
  }

  const packageName = parsed.searchParams.get("id")?.trim();
  if (!packageName) {
    return { ok: false, reason: "URL has no ?id= package name" };
  }

  return { ok: true, url: raw, packageName };
}
