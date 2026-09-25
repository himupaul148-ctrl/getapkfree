import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { buildSingleColumnXlsx } from "@/lib/xlsx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin-only download of every app name in the catalogue as a real XLSX
 * workbook. The export is intentionally independent of the visible table
 * filter/search so "Export Excel" always means the complete catalogue.
 */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("apps")
    .select("name")
    .order("name", { ascending: true })
    .returns<{ name: string }[]>();

  if (error) {
    return NextResponse.json(
      { error: "Could not export the app catalogue." },
      { status: 500 },
    );
  }

  const workbook = buildSingleColumnXlsx(
    "App Name",
    (data ?? []).map((app) => app.name),
  );

  const date = new Date().toISOString().slice(0, 10);

  // NextResponse expects a DOM-compatible BodyInit. Convert the Node Buffer
  // into a standalone ArrayBuffer to satisfy Vercel/TypeScript strict typing.
  const body = new ArrayBuffer(workbook.byteLength);
  new Uint8Array(body).set(workbook);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        `attachment; filename="getapkfree-app-names-${date}.xlsx"`,
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    },
  });
}
