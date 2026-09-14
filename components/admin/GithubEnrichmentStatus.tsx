import { formatShortRelative } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/apk/enrichment-status-labels";
import type { EnrichmentStatus } from "@/lib/apk/github-apk-enrichment-store";

/**
 * The read-only counterpart to GithubApkImportAction.tsx (untouched by
 * this component): shows what the SCHEDULED enrichment job
 * (scripts/enrich-github-apks.mjs) last decided for this app, when it has
 * ever run for it. Purely additive — renders nothing when no attempt
 * record exists (e.g. an F-Droid app, or a Play-discovered app the
 * scheduled job hasn't reached yet), and never replaces or disables the
 * existing manual "Import GitHub APK" button or its own retry capability.
 *
 * Rendered regardless of the app's current version count: an app that the
 * scheduled job already successfully enriched (imported_unpublished) still
 * shows this line even after it has a version, alongside the normal
 * version-management UI — the app's version list below is unaffected.
 */

export type EnrichmentAttemptSummary = {
  status: string;
  message: string | null;
  lastAttemptedAt: string;
};

export default function GithubEnrichmentStatus({ attempt }: { attempt: EnrichmentAttemptSummary | null }) {
  if (!attempt) return null;

  const label = STATUS_LABELS[attempt.status as EnrichmentStatus] ?? attempt.status;
  const isSuccess = attempt.status === "imported_unpublished";
  const needsAttention = attempt.status === "package_mismatch" || attempt.status === "multiple_apk_assets";

  return (
    <p
      className={`text-xs ${
        isSuccess ? "text-brand-300" : needsAttention ? "text-warn-300" : "text-fg-dim"
      }`}
      title={attempt.message ?? undefined}
    >
      Latest GitHub APK check: {label} · {formatShortRelative(attempt.lastAttemptedAt)}
    </p>
  );
}
