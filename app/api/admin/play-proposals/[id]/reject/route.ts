import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { createClient, getUser } from "@/lib/supabase/server";
import { rejectProposal } from "@/lib/metadata/play-proposal-approval";

// Only ever writes to public.play_import_proposals — never apps, versions,
// or Storage. See lib/metadata/play-proposal-approval.ts for the actual
// logic; this route only adds admin authentication, the acting admin's id,
// and Next.js request/response plumbing around it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const { id } = await params;

  // The only field this route reads from the body at all — no URL, no
  // package, no proposed field can be changed through a reject request.
  let reason: string | null = null;
  try {
    const body = await request.json();
    if (typeof body?.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim();
    }
  } catch {
    /* body is optional */
  }

  const supabase = await createClient();
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  const result = await rejectProposal(supabase, id, user.id, reason);
  return NextResponse.json(result.body, { status: result.status });
}
