import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import { formatRelative } from "@/lib/format";
import type { EnrichmentStatusDescription } from "@/lib/metadata/play-proposals-enrichment-ui";

/**
 * One read-only card in the admin Play Proposals page's "Recently
 * approved (GitHub-discovered)" section. Purely presentational — every
 * prop is already-resolved data computed server-side
 * (app/admin/play-proposals/page.tsx + describeEnrichmentStatus()); this
 * component makes no decisions, fetches nothing, and renders no
 * Approve/Reject controls at all. The existing pending-queue cards
 * (NewAppCard/MetadataUpdateCard in PlayProposalsReview.tsx) and the
 * existing manual "Import GitHub APK" action (GithubApkImportAction.tsx)
 * are both completely untouched by this component.
 */
export type ApprovedProposalEnrichmentCardData = {
  proposalId: string;
  appId: string;
  appName: string;
  appSlug: string;
  iconUrl: string | null;
  packageName: string;
  sourceRepo: string;
  approvedAt: string | null;
  status: EnrichmentStatusDescription;
};

const TERMINAL_LINK_STATUSES = new Set(["imported_unpublished", "already_has_version"]);

export default function ApprovedProposalEnrichmentStatus({ card }: { card: ApprovedProposalEnrichmentCardData }) {
  const { status } = card;

  return (
    <div className="rounded-2xl border border-base-800 bg-base-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-4">
          <AppIcon src={card.iconUrl} name={card.appName} size={48} />
          <div className="min-w-0">
            <h3 className="font-semibold text-fg">{card.appName}</h3>
            <p className="font-mono text-xs text-fg-dim">{card.packageName}</p>
            <p className="mt-0.5 text-xs text-fg-dim">
              Source: <span className="font-mono">{card.sourceRepo}</span>
            </p>
          </div>
        </div>
        <span className="rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-300">Approved</span>
      </div>

      {card.approvedAt && <p className="mt-2 text-xs text-fg-dim">Approved {formatRelative(card.approvedAt)}</p>}

      <div className="mt-4 space-y-1 rounded-xl border border-base-800 bg-base-950/40 p-3">
        <p
          className={`text-sm font-medium ${
            status.status === "imported_unpublished"
              ? "text-brand-300"
              : status.needsAttention
                ? "text-warn-300"
                : "text-fg-muted"
          }`}
        >
          APK enrichment: {status.label}
        </p>

        {status.lastChecked && <p className="text-xs text-fg-dim">Last checked: {status.lastChecked}</p>}

        {status.showRetry && <p className="text-xs text-fg-dim">Next retry: {status.retryText}</p>}

        {status.versionName && (
          <>
            <p className="text-xs text-fg-dim">
              Version: <span className="font-mono">{status.versionName}</span>
              {status.versionCode !== null ? ` (code ${status.versionCode})` : ""}
            </p>
            <p className="text-xs text-fg-dim">
              Status: {status.published ? "Published" : "Unpublished — ready for review"}
            </p>
          </>
        )}
      </div>

      {TERMINAL_LINK_STATUSES.has(status.status) && (
        <div className="mt-3">
          <Link href="/admin/apps" className="text-xs text-azure-400 hover:underline">
            Open app
          </Link>
        </div>
      )}
    </div>
  );
}
