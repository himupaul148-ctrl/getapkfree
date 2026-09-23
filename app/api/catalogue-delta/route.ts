import { NextResponse, type NextRequest } from "next/server";
import { getCatalogue } from "@/lib/catalogue";
import { parseExcludeParam } from "@/lib/catalogue-delta";

// PREVIEW EXPERIMENT — Variant B early-preload investigation. Not yet
// committed. Mirrors app/api/search/route.ts's conventions (runtime, generic
// errors).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const validation = parseExcludeParam(request.nextUrl.searchParams.get("exclude"));
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const { apps, error } = await getCatalogue();
    if (error) {
      console.error("[api/catalogue-delta] getCatalogue failed:", error);
      return NextResponse.json({ error: "Catalogue is temporarily unavailable." }, { status: 502 });
    }
    const exclude = new Set(validation.ids);
    const delta = apps.filter((app) => !exclude.has(app.id));
    return NextResponse.json({ apps: delta });
  } catch (caught) {
    console.error("[api/catalogue-delta] failed:", caught);
    return NextResponse.json({ error: "Catalogue is temporarily unavailable." }, { status: 502 });
  }
}
