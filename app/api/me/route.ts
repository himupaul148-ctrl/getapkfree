import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getUser } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who the caller is, according to the server.
 *
 * The badge reads this rather than deciding for itself, so the indicator and
 * the `/admin` gate cannot disagree — both end at the same `isAdmin()`, which
 * reads `users.is_admin` against the cookie session. A client cannot talk
 * itself into an admin badge by editing local state; the worst it can do is
 * display a badge while every privileged action still fails server-side.
 *
 * Never cached: a stale "you are an admin" is precisely the wrong thing to
 * serve from a CDN.
 */
export async function GET() {
  const user = await getUser();

  if (!user) {
    return NextResponse.json(
      { signedIn: false, isAdmin: false, username: null, userId: null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const [admin, supabase] = await Promise.all([isAdmin(), createClient()]);

  const { data } = await supabase
    .from("users")
    .select("username")
    .eq("id", user.id)
    .maybeSingle<{ username: string | null }>();

  return NextResponse.json(
    {
      signedIn: true,
      isAdmin: admin,
      username:
        data?.username ??
        (typeof user.user_metadata?.username === "string"
          ? user.user_metadata.username
          : null),
      userId: user.id,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
