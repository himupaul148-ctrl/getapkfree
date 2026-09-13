import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { approveProposal } from "@/lib/metadata/play-proposal-approval";

// Reads/writes public.play_import_proposals and, on a metadata_update,
// public.apps — through the request's own authenticated session, never
// the service-role key. See lib/metadata/play-proposal-approval.ts for the
// actual logic; this route only adds admin authentication, the acting
// admin's id, and Next.js request/response plumbing around it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const user = await getUser();
  if (!user) {
    // isAdmin() already confirmed a signed-in admin, so this is not a
    // realistic path — kept only as a defensive, correctly-typed guard
    // rather than asserting user is non-null past isAdmin().
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const result = await approveProposal(supabase, id, user.id);

  // A metadata_update that actually changed a live app's display fields is
  // the only outcome that can be visible on the public site — the ISR page
  // cache and the hourly catalogue cache both need dropping, exactly as
  // components/admin/AppsManager.tsx's own revalidate() helper already does
  // after any other admin edit. A new_app approval creates a zero-version
  // app, which is confirmed invisible on every public surface until it has
  // a published version, so it needs no revalidation call at all.
  if (result.status === 200 && result.body.success && typeof result.body.appSlug === "string") {
    revalidateTag("catalogue", "max");
    revalidatePath(`/app/${result.body.appSlug}`);
  }

  return NextResponse.json(result.body, { status: result.status });
}
