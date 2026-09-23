// Relative imports (not the usual @/lib/... alias) so this module is
// directly test-importable under plain `node --test` — same convention as
// lib/catalogue-delta.ts and lib/blog-related-app-ids.ts.
import { androidLevel, trendingScore } from "./format.ts";
import type { AppSummary, SortKey, SourceFilter } from "./types.ts";

/**
 * PREVIEW EXPERIMENT — Variant B early-preload investigation. Not yet
 * committed.
 *
 * CatalogueSection.tsx's search/filter/sort logic, extracted verbatim into a
 * pure function so it can be given real behavioral tests against the actual
 * 272-app dataset (lib/__fixtures__/catalogue-apps.json) instead of only
 * static source-level assertions — CatalogueSection.tsx imports and uses
 * these directly rather than keeping its own inline copy, so the tested
 * function and the shipped function are the same code, not a parallel
 * reimplementation that could silently drift.
 */

/** Name, description and package name, plus developer and category. */
export function matchesQuery(app: AppSummary, needle: string): boolean {
  return (
    app.name.toLowerCase().includes(needle) ||
    (app.description?.toLowerCase().includes(needle) ?? false) ||
    (app.packageName?.toLowerCase().includes(needle) ?? false) ||
    (app.developer?.toLowerCase().includes(needle) ?? false) ||
    (app.category?.toLowerCase().includes(needle) ?? false)
  );
}

export type CatalogueFilters = {
  search: string;
  category: string;
  android: string;
  source: SourceFilter;
  sort: SortKey;
};

export function filterAndSortCatalogue(
  apps: AppSummary[],
  filters: CatalogueFilters,
): AppSummary[] {
  const needle = filters.search.trim().toLowerCase();
  const deviceLevel = androidLevel(filters.android || null);

  const filtered = apps.filter((app) => {
    if (needle && !matchesQuery(app, needle)) return false;
    if (filters.category && app.category !== filters.category) return false;
    if (filters.source !== "all" && app.sourceType !== filters.source) return false;
    // "Android X+" is the device you have — show what will install on it.
    if (deviceLevel && androidLevel(app.minAndroid) > deviceLevel) return false;
    return true;
  });

  const sorted = [...filtered];
  switch (filters.sort) {
    case "downloads":
      sorted.sort((a, b) => b.downloadCount - a.downloadCount);
      break;
    case "newest":
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "rating":
      sorted.sort(
        (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.ratingCount - a.ratingCount,
      );
      break;
    case "updated":
      sorted.sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""));
      break;
    default:
      sorted.sort(
        (a, b) =>
          trendingScore(b.downloadCount, b.lastUpdated) -
          trendingScore(a.downloadCount, a.lastUpdated),
      );
  }
  return sorted;
}
