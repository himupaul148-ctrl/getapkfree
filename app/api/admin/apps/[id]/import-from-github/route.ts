import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { importGithubApkForApp } from "@/lib/apk/github-release-import";

// The pipeline needs DNS resolution, raw HTTPS sockets, temp files, and ZIP
// parsing — none of which run on the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Admin-only. Enriches one already-approved, zero-version app with a real
 * APK, sourced ONLY from the GitHub repository its own Play-discovery
 * approval already traces back to (lib/apk/app-github-source.ts) — never
 * from Google Play, never from a mirror. All the actual logic — resolving
 * the source, inspecting the release, downloading, validating, parsing,
 * the package-name safety gate, storing, and saving an UNPUBLISHED version
 * — lives in lib/apk/github-release-import.ts, exercised directly by its
 * own tests; this route only adds admin authentication, request/response
 * plumbing, and the target app lookup around it.
 *
 * Reads/writes through the request's own authenticated (cookie-bound)
 * Supabase client, exactly like every other admin route — never the
 * service-role key.
 *
 * `published` is never set true by this route or the pipeline it calls —
 * publishing stays a separate, deliberate action through the existing
 * publish gate (lib/admin/version-publish.ts).
 */
export async function POST(request: NextRequest, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing app id." }, { status: 400 });
  }

  // Deliberately reads nothing but an optional selectedAssetUrl, used only
  // to resolve a prior `multiple_apk_assets` result — every other value
  // that ends up in the database still comes from the downloaded APK
  // itself or from the pipeline's own logic, never from this request body.
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // No body at all is fine — selectedAssetUrl is optional.
  }
  const selectedAssetUrl =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).selectedAssetUrl === "string"
      ? ((body as Record<string, unknown>).selectedAssetUrl as string)
      : undefined;

  const supabase = await createClient();

  const { data: app, error } = await supabase
    .from("apps")
    .select("id, package_name")
    .eq("id", id)
    .maybeSingle<{ id: string; package_name: string }>();

  if (error) {
    return NextResponse.json({ status: "import_failed", error: "Could not load that app." }, { status: 500 });
  }
  if (!app) {
    return NextResponse.json({ error: "App not found." }, { status: 404 });
  }

  const result = await importGithubApkForApp(
    supabase,
    { id: app.id, packageName: app.package_name },
    { selectedAssetUrl },
  );

  const httpStatus = result.status === "import_failed" ? 502 : 200;
  return NextResponse.json(result, { status: httpStatus });
}
