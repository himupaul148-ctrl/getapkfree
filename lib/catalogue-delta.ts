// Relative imports (not the usual @/lib/... alias) so this module is
// directly test-importable under plain `node --test`, which has no
// bundler/path-alias resolution — same convention as lib/blog-related-app-ids.ts
// and lib/net/safe-fetch.ts, this project's other directly-tested pure modules.
import { trendingScore } from "./format.ts";
import type { AppSummary } from "./types.ts";

/**
 * PREVIEW EXPERIMENT — Variant B early-preload investigation. Not yet
 * committed. Rebuilds the delta selection model validated in the prior
 * local investigation (never committed itself, so recovered from that
 * validated design rather than git history): initial known = 34, delta =
 * 238, total = 272. Selection logic is unchanged between this pass and the
 * one before it — only WHERE the preload() call happens is the variable
 * under test this time.
 */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Matches CatalogueSection's own PAGE_SIZE / default "trending" sort. */
export const DELTA_INITIAL_PAGE_SIZE = 24;

/**
 * Every app ID already visible somewhere on the homepage before any user
 * interaction: the Explore carousel (top 12 by downloads, same tie-breaks as
 * HomeSections' exploreApps), Recently updated (top 10 by lastUpdated), and
 * CatalogueSection's own first page (top 24 by trending — its default sort).
 * Deduplicated, since the three lists overlap heavily in practice.
 */
export function computeAlreadyKnownIds(apps: AppSummary[]): string[] {
  const exploreIds = [...apps]
    .filter((app) => app.latestVersion !== null)
    .sort(
      (a, b) =>
        b.downloadCount - a.downloadCount ||
        (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? "") ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 12)
    .map((app) => app.id);

  const recentIds = [...apps]
    .filter((app) => app.lastUpdated)
    .sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""))
    .slice(0, 10)
    .map((app) => app.id);

  const trendingIds = [...apps]
    .sort(
      (a, b) =>
        trendingScore(b.downloadCount, b.lastUpdated) -
        trendingScore(a.downloadCount, a.lastUpdated),
    )
    .slice(0, DELTA_INITIAL_PAGE_SIZE)
    .map((app) => app.id);

  return [...new Set([...exploreIds, ...recentIds, ...trendingIds])];
}

export function alreadyKnownApps(apps: AppSummary[]): AppSummary[] {
  const ids = new Set(computeAlreadyKnownIds(apps));
  return apps.filter((app) => ids.has(app.id));
}

export function deltaPreloadUrl(apps: AppSummary[]): string {
  return `/api/catalogue-delta?exclude=${computeAlreadyKnownIds(apps).join(",")}`;
}

/**
 * The merge step CatalogueSection runs once the delta response arrives (and
 * again, identically, on a retry after a failed attempt) — appends only the
 * delta apps not already present by id. Extracted as its own pure function
 * so "no duplicate merge" / "retry merge correctness" can be tested directly
 * against real data instead of only through source inspection.
 */
export function mergeCatalogueDelta(
  current: AppSummary[],
  deltaApps: AppSummary[],
): AppSummary[] {
  const known = new Set(current.map((app) => app.id));
  return [...current, ...deltaApps.filter((app) => !known.has(app.id))];
}

export type ExcludeParamValidation =
  | { valid: true; ids: string[] }
  | { valid: false; error: string };

/** Mirrors lib/blog-related-app-ids.ts's validation shape for this project's UUID-list convention. */
export function parseExcludeParam(raw: string | null): ExcludeParamValidation {
  if (!raw) return { valid: true, ids: [] };
  const ids = raw.split(",").filter(Boolean);
  for (const id of ids) {
    if (!UUID_RE.test(id)) {
      return { valid: false, error: `invalid id: ${JSON.stringify(id)}` };
    }
  }
  return { valid: true, ids };
}
