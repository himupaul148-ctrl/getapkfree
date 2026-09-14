import { formatShortRelative } from "@/lib/format";

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

const STATUS_LABELS: Record<string, string> = {
  no_github_source: "No GitHub source linked",
  github_repo_not_found: "GitHub repository not found",
  no_release: "No GitHub release yet",
  no_apk_asset: "No APK available",
  multiple_apk_assets: "Multiple APK assets — needs review",
  package_mismatch: "Package mismatch",
  import_failed: "Import failed",
  already_has_version: "Already has a version",
  imported_unpublished: "APK imported, awaiting publication",
};

export default function GithubEnrichmentStatus({ attempt }: { attempt: EnrichmentAttemptSummary | null }) {
  if (!attempt) return null;

  const label = STATUS_LABELS[attempt.status] ?? attempt.status;
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
