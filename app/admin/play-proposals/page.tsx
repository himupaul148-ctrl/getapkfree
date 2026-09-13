import PlayProposalsReview, {
  type ManagedProposal,
} from "@/components/admin/PlayProposalsReview";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProposalRow = {
  id: string;
  proposal_type: "new_app" | "metadata_update";
  package_name: string;
  play_url: string;
  app_id: string | null;
  proposed_fields: Record<string, unknown>;
  previous_fields: Record<string, unknown> | null;
  created_at: string;
};

type AppRow = {
  id: string;
  slug: string;
  name: string;
  manual_fields: string[] | null;
};

/**
 * Phase 4e: the admin review queue for public.play_import_proposals.
 * Read-only here — every write (approve/reject) goes through the existing
 * Phase 4d API routes (app/api/admin/play-proposals/[id]/{approve,reject}),
 * never through a direct write from this page or its client component.
 *
 * Default view is `status = 'pending'`, newest first — the same
 * server-component-reads-via-RLS pattern app/admin/apps/page.tsx already
 * uses. RLS on play_import_proposals ("admins manage play import
 * proposals") already restricts this SELECT to admins; app/admin/layout.tsx's
 * own isAdmin() redirect is what actually keeps a non-admin from ever
 * rendering this page at all.
 */
export default async function AdminPlayProposalsPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("play_import_proposals")
    .select("id, proposal_type, package_name, play_url, app_id, proposed_fields, previous_fields, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .returns<ProposalRow[]>();

  const rows = data ?? [];

  // metadata_update proposals need their current app's slug/name/manual_fields
  // to link to the live listing and to show which differing fields are
  // protected — batched into one extra query rather than one per proposal.
  const appIds = [...new Set(rows.map((r) => r.app_id).filter((id): id is string => Boolean(id)))];
  let appsById: Record<string, AppRow> = {};
  if (appIds.length > 0) {
    const { data: apps } = await supabase
      .from("apps")
      .select("id, slug, name, manual_fields")
      .in("id", appIds)
      .returns<AppRow[]>();
    appsById = Object.fromEntries((apps ?? []).map((a) => [a.id, a]));
  }

  const proposals: ManagedProposal[] = rows.map((row) => {
    const app = row.app_id ? appsById[row.app_id] : undefined;
    return {
      id: row.id,
      proposalType: row.proposal_type,
      packageName: row.package_name,
      playUrl: row.play_url,
      appId: row.app_id,
      proposedFields: row.proposed_fields,
      previousFields: row.previous_fields,
      createdAt: row.created_at,
      appSlug: app?.slug ?? null,
      appName: app?.name ?? null,
      manualFields: app?.manual_fields ?? [],
    };
  });

  const newAppCount = proposals.filter((p) => p.proposalType === "new_app").length;
  const metadataUpdateCount = proposals.filter((p) => p.proposalType === "metadata_update").length;

  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Play Proposals</h2>
      <p className="mt-1 text-sm text-fg-muted">
        {proposals.length} pending proposal{proposals.length === 1 ? "" : "s"} — {newAppCount} new
        app{newAppCount === 1 ? "" : "s"}, {metadataUpdateCount} metadata update
        {metadataUpdateCount === 1 ? "" : "s"}.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error.message}
        </p>
      )}

      <div className="mt-6">
        <PlayProposalsReview proposals={proposals} />
      </div>
    </div>
  );
}
