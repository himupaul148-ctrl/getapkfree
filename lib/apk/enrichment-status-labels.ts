/**
 * The one, shared mapping from a github_apk_enrichment_attempts.status
 * value to the label an admin actually sees. Used by both
 * components/admin/GithubEnrichmentStatus.tsx (the AppsManager one-liner)
 * and lib/metadata/play-proposals-enrichment-ui.ts (the admin Play
 * Proposals page's richer "Recently approved" card) — kept in a plain
 * .ts module, not either .tsx component, specifically so a pure lib/
 * module can import it: this project's plain `node --test` runner has no
 * JSX transform (see e.g. lib/header-search-component.test.ts's own doc
 * comment), so nothing under lib/ may ever import a .tsx file directly.
 */
import type { EnrichmentStatus } from "./github-apk-enrichment-store.ts";

export const STATUS_LABELS: Record<EnrichmentStatus, string> = {
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
