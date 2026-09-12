import { timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isAdmin } from "./admin.ts";

/**
 * Authentication/authorisation for the blog featured-image endpoints, kept
 * apart from lib/blog-images.ts (the sharp/storage processing logic) on
 * purpose: this file transitively depends on lib/admin.ts's `isAdmin()`,
 * which reads cookies via lib/supabase/server.ts and only works inside a
 * real Next.js request — it cannot be imported from a plain `node --test`
 * run. lib/blog-images.ts has no such dependency, which is what keeps its
 * image-transformation logic (lib/blog-images.test.ts) unit-testable at all.
 */

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
export function serviceClient(): SupabaseClient | null {
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
