import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostics for the blog publish pipeline.
 *
 *   curl https://getapkfree.vercel.app/api/admin/blog/test
 *   curl -H "Authorization: Bearer <token>" .../api/admin/blog/test
 *
 * DELETE THIS ROUTE once the pipeline is working. It is unauthenticated on
 * purpose — the thing most likely to be broken is the token itself, so
 * requiring a valid token to diagnose a token problem would be useless.
 *
 * It never returns a secret. Values are reported as present/absent, a length,
 * and an 8-character SHA-256 prefix. That prefix is enough to prove two sides
 * hold the same string without revealing it: comparing 32 bits of a hash over
 * a 256-bit secret gives an attacker nothing usable.
 */

/** Short, non-reversible identity for a secret. */
function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** Describes a variable without ever disclosing it. */
function describe(name: string) {
  const raw = process.env[name];

  if (raw === undefined) {
    return { name, status: "MISSING" as const };
  }
  if (raw === "") {
    return { name, status: "EMPTY" as const, hint: "The variable exists but has no value." };
  }

  const trimmed = raw.trim();
  const untrimmed = raw !== trimmed;

  return {
    name,
    status: "SET" as const,
    length: raw.length,
    trimmedLength: trimmed.length,
    fingerprint: fingerprint(trimmed),
    // The single most common cause of a token that "looks right" but 401s.
    hasSurroundingWhitespace: untrimmed,
    ...(untrimmed
      ? {
          hint:
            "This value has leading or trailing whitespace, almost certainly " +
            "from a copy-paste. Re-add it in Vercel without it. The endpoint " +
            "trims before comparing, so this is no longer fatal — but the two " +
            "sides should still match exactly.",
        }
      : {}),
  };
}

export async function GET(request: NextRequest) {
  const env = {
    BLOG_PUBLISH_TOKEN: describe("BLOG_PUBLISH_TOKEN"),
    SUPABASE_SERVICE_ROLE_KEY: describe("SUPABASE_SERVICE_ROLE_KEY"),
    NEXT_PUBLIC_SUPABASE_URL: describe("NEXT_PUBLIC_SUPABASE_URL"),
  };

  // ---- What the caller sent -------------------------------------------

  const authHeader = request.headers.get("authorization");
  const match = authHeader?.match(/^\s*Bearer\s+(.+)\s*$/i);
  const sentToken = match ? match[1].trim() : "";

  const expected = (process.env.BLOG_PUBLISH_TOKEN ?? "").trim();

  const auth = {
    authorizationHeaderPresent: Boolean(authHeader),
    schemeParsed: Boolean(match),
    ...(authHeader && !match
      ? {
          hint:
            'The header is present but is not "Bearer <token>". The scheme is ' +
            "case-insensitive, but there must be a single space and a value.",
        }
      : {}),
    ...(sentToken
      ? {
          sentLength: sentToken.length,
          sentFingerprint: fingerprint(sentToken),
          expectedFingerprint: expected ? fingerprint(expected) : null,
          matches: Boolean(expected) && sentToken === expected,
        }
      : {}),
  };

  // ---- Can we actually reach Supabase? --------------------------------

  let supabase: Record<string, unknown> = {
    reachable: false,
    reason: "Not attempted — url or service key missing.",
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) {
    try {
      const db = createClient(url.trim(), key.trim(), {
        auth: { persistSession: false },
      });
      // Cheapest possible round trip that still proves the key is accepted.
      const { count, error } = await db
        .from("blog_posts")
        .select("id", { count: "exact", head: true });

      supabase = error
        ? { reachable: false, reason: error.message }
        : { reachable: true, blogPostCount: count ?? 0 };
    } catch (caught) {
      supabase = {
        reachable: false,
        reason: caught instanceof Error ? caught.message : "Unknown error",
      };
    }
  }

  // ---- A single sentence saying what to do next -----------------------

  let verdict: string;
  if (env.BLOG_PUBLISH_TOKEN.status !== "SET") {
    verdict =
      "BLOG_PUBLISH_TOKEN is not set on this deployment. Add it in Vercel " +
      "(Production) and redeploy — env vars are only picked up by a new build.";
  } else if (!supabase.reachable) {
    verdict = `Supabase is not reachable: ${supabase.reason}`;
  } else if (auth.authorizationHeaderPresent && auth.matches === false) {
    verdict =
      "The token sent does not match the one stored. Compare sentFingerprint " +
      "against expectedFingerprint — if they differ, GitHub and Vercel hold " +
      "different strings.";
  } else if (auth.matches === true) {
    verdict = "Everything checks out. The token matches and Supabase is reachable.";
  } else {
    verdict =
      "Server side looks healthy. Re-run with -H \"Authorization: Bearer <token>\" " +
      "to check the token GitHub holds matches the one Vercel holds.";
  }

  return NextResponse.json(
    {
      verdict,
      env,
      auth,
      supabase,
      deployment: {
        vercelEnv: process.env.VERCEL_ENV ?? "local",
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "unknown",
      },
      note: "Delete app/api/admin/blog/test/route.ts once this is working.",
    },
    { status: 200 },
  );
}
