import { NextResponse, type NextRequest } from "next/server";
import { searchApps, validateSearchQuery } from "@/lib/search";
import { supabase } from "@/lib/supabase/public";

// Needs nothing beyond a Supabase REST call, but every other route in this
// project runs nodejs — matched here for consistency rather than adopting
// a new runtime just for this one endpoint.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, read-only, unauthenticated — the header search combobox
 * (components/HeaderSearch.tsx) is this route's only caller, but nothing
 * here checks who's asking, since the data it returns (published apps'
 * name/slug/icon/category) is exactly what the public catalogue already
 * exposes on every app card. Uses the same public/anon Supabase client
 * every other public catalogue read already uses — the service-role key
 * is never imported into this file.
 */
export async function GET(request: NextRequest) {
  const rawQuery = request.nextUrl.searchParams.get("q") ?? "";
  const validation = validateSearchQuery(rawQuery);

  if (validation.kind === "too_long") {
    return NextResponse.json({ error: "Search query is too long." }, { status: 400 });
  }
  if (validation.kind === "empty") {
    return NextResponse.json({ query: "", results: [] });
  }

  try {
    const results = await searchApps(validation.value, supabase);
    return NextResponse.json({ query: validation.value, results });
  } catch (caught) {
    // Never surface the underlying Supabase/Postgres error text — it could
    // name a column, constraint, or internal detail. Logged server-side
    // for diagnosis; the client only ever sees a generic message.
    console.error("[api/search] search failed:", caught);
    return NextResponse.json({ error: "Search is temporarily unavailable." }, { status: 502 });
  }
}
