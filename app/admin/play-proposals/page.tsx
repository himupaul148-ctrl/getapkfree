import PlayProposalsReview, {
  type ManagedProposal,
} from "@/components/admin/PlayProposalsReview";
import type { ApprovedProposalEnrichmentCardData } from "@/components/admin/ApprovedProposalEnrichmentStatus";
import { createClient } from "@/lib/supabase/server";
import { getAttemptsByAppIds } from "@/lib/apk/github-apk-enrichment-store";
import { describeEnrichmentStatus } from "@/lib/metadata/play-proposals-enrichment-ui";

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

/** Bounded, forward-looking cap — today there are only a handful of these in production, but this keeps the query from ever becoming unbounded. */
const MAX_RECENTLY_APPROVED = 50;

type AppliedNewAppProposalRow = {
  id: string;
  package_name: string;
  play_url: string;
  proposed_fields: Record<string, unknown>;
  applied_at: string | null;
};

type ApprovedAppRow = {
  id: string;
  slug: string;
  name: string;
  icon_url: string | null;
  package_name: string;
};

/**
 * Loads the "Recently approved (GitHub-discovered)" section's data —
 * entirely separate from, and never mutating, the existing pending-queue
 * query above. Every step here is a single batched query keyed by the
 * small, bounded set of applied new_app proposals; nothing here issues a
 * query per proposal/app/card. Mirrors app/admin/apps/page.tsx's own
 * proven batched-query shape for resolving GitHub source/enrichment data
 * for a list of apps.
 *
 * A card only ever appears for a proposal that is proposal_type='new_app',
 * status='applied', has a matching apps row (resolved by package_name —
 * play_import_proposals.app_id is never populated for a new_app proposal,
 * even after approval, so package_name is the only real join key here,
 * exactly as lib/apk/app-github-source.ts's resolveAppGithubSource()
 * already relies on elsewhere), AND has a matching
 * play_discovery_candidates row with source='github'. A rejected/pending/
 * metadata_update/non-GitHub proposal can never produce a card — each is
 * excluded by construction, not by a runtime check the UI could get wrong.
 */
async function loadRecentlyApprovedGithubCards(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ApprovedProposalEnrichmentCardData[]> {
  const { data: proposals } = await supabase
    .from("play_import_proposals")
    .select("id, package_name, play_url, proposed_fields, applied_at")
    .eq("proposal_type", "new_app")
    .eq("status", "applied")
    .order("applied_at", { ascending: false })
    .limit(MAX_RECENTLY_APPROVED)
    .returns<AppliedNewAppProposalRow[]>();

  const applied = proposals ?? [];
  if (applied.length === 0) return [];

  const proposalIds = applied.map((p) => p.id);
  const packageNames = [...new Set(applied.map((p) => p.package_name))];

  const [{ data: candidates }, { data: apps }] = await Promise.all([
    supabase
      .from("play_discovery_candidates")
      .select("proposal_id, source_ref")
      .eq("source", "github")
      .in("proposal_id", proposalIds)
      .returns<{ proposal_id: string; source_ref: string }[]>(),
    supabase
      .from("apps")
      .select("id, slug, name, icon_url, package_name")
      .in("package_name", packageNames)
      .returns<ApprovedAppRow[]>(),
  ]);

  const sourceRepoByProposalId = new Map((candidates ?? []).map((c) => [c.proposal_id, c.source_ref]));
  const appByPackageName = new Map((apps ?? []).map((a) => [a.package_name, a]));

  // Only proposals that are BOTH GitHub-discovered AND resolved to a real
  // app row survive to this point — this is the actual filter that keeps
  // non-GitHub and orphaned proposals off the page, not a UI-level check.
  const githubApproved = applied
    .map((p) => ({ proposal: p, sourceRepo: sourceRepoByProposalId.get(p.id), app: appByPackageName.get(p.package_name) }))
    .filter(
      (row): row is { proposal: AppliedNewAppProposalRow; sourceRepo: string; app: ApprovedAppRow } =>
        Boolean(row.sourceRepo) && Boolean(row.app),
    );

  if (githubApproved.length === 0) return [];

  const appIds = githubApproved.map((row) => row.app.id);
  const attemptsByAppId = await getAttemptsByAppIds(supabase, appIds);

  const versionIds = [...attemptsByAppId.values()]
    .map((a) => a.version_id)
    .filter((id): id is string => Boolean(id));
  let versionsById = new Map<string, { version_name: string; version_code: number; published: boolean }>();
  if (versionIds.length > 0) {
    const { data: versions } = await supabase
      .from("versions")
      .select("id, version_name, version_code, published")
      .in("id", versionIds)
      .returns<{ id: string; version_name: string; version_code: number; published: boolean }[]>();
    versionsById = new Map((versions ?? []).map((v) => [v.id, v]));
  }

  return githubApproved.map(({ proposal, sourceRepo, app }) => {
    const attempt = attemptsByAppId.get(app.id) ?? null;
    const version = attempt?.version_id ? (versionsById.get(attempt.version_id) ?? null) : null;
    return {
      proposalId: proposal.id,
      appId: app.id,
      appName: app.name,
      appSlug: app.slug,
      iconUrl: app.icon_url,
      packageName: app.package_name,
      sourceRepo,
      approvedAt: proposal.applied_at,
      status: describeEnrichmentStatus(attempt, version),
    };
  });
}

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

  // Entirely separate from, and never affecting, the pending-queue query
  // above. A failure here (e.g. a transient query error) must never break
  // the rest of this admin page — it only means the "Recently approved"
  // section renders with nothing to show, exactly like a legitimate "no
  // GitHub-discovered approvals yet" outcome.
  let approvedCards: ApprovedProposalEnrichmentCardData[] = [];
  try {
    approvedCards = await loadRecentlyApprovedGithubCards(supabase);
  } catch (caught) {
    console.error("[admin/play-proposals] failed to load recently-approved enrichment status:", caught);
  }

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
        <PlayProposalsReview proposals={proposals} approvedCards={approvedCards} />
      </div>
    </div>
  );
}
