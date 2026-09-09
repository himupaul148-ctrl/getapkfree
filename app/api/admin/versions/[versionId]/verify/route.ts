import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { runVersionVerify } from "@/lib/apk/verify-version";

// The stored APK is fetched over plain fetch() and hashed with node:crypto,
// so this cannot run on edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ versionId: string }> };

/**
 * Re-checks one already-imported build's scan status via a VirusTotal hash
 * lookup — the counterpart to the URL-import pipeline's own automatic
 * lookup, for a build that came back "pending" (VirusTotal had not seen it
 * yet) or whose first check failed. All the actual logic — deriving the
 * hash from the stored file, calling VirusTotal, writing the result — lives
 * in lib/apk/verify-version.ts, exercised directly by its own tests; this
 * route only adds admin authentication and Next.js plumbing around it.
 *
 * Never touches `published`. A clean verdict makes a build *eligible* to
 * publish (via canPublishVersion, unchanged, in lib/admin/version-publish.ts)
 * — publishing itself stays a separate, deliberate action taken from
 * AppsManager.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const { versionId } = await params;
  const supabase = await createClient();

  const result = await runVersionVerify(versionId, supabase);

  return NextResponse.json(result.body, { status: result.status });
}
