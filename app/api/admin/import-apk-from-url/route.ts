import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { runApkUrlImport } from "@/lib/apk/import-pipeline";

// The pipeline needs DNS resolution, raw HTTPS sockets, temp files, ZIP
// parsing and Supabase Storage — none of which run on the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only. DOWNLOAD → VALIDATE → PARSE → STORE → SAVE (unpublished, scan
 * pending) — the actual pipeline lives in lib/apk/import-pipeline.ts so it
 * can be unit-tested without a Next.js request context; this route is just
 * the auth check and the JSON in/out around it.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // Deliberately reads nothing but `url`. package_name, version_code,
  // scan_status, published, storage_path, file_url etc. are never looked
  // at, even if present — every value that ends up in the database comes
  // from the downloaded APK itself or from the pipeline's own logic.
  const rawUrl = body && typeof body === "object" ? (body as Record<string, unknown>).url : undefined;

  const supabase = await createClient();
  const result = await runApkUrlImport(rawUrl, supabase);
  return NextResponse.json(result.body, { status: result.status });
}
