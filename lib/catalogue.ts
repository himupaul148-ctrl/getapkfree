import { cache } from "react";
import { unstable_cache } from "next/cache";
import { supabase } from "@/lib/supabase/public";
import { latestVersion } from "@/lib/format";
import type { App, AppSummary, AppWithVersions, Version } from "@/lib/types";

// Every apps column toSummary() reads, and no others — screenshots in
// particular is fetched by "*" but never used here (getAppBySlug fetches it
// separately for the app detail page, where it is actually rendered). Was
// costing 1,100 URLs / ~88KB per hourly cache refresh for data this query
// discards before it ever reaches a component.
const SELECT =
  "id, name, slug, package_name, category, description, icon_url, developer_name, created_at, download_count, rating, rating_count, source_type, external_url, hosted_locally, versions(version_name, version_code, file_size, min_android_version, uploaded_at, scanned_at, scan_status)";

/**
 * The joined versions come back already filtered by RLS to published builds,
 * so anything withheld by the scanner never reaches this shape.
 */
export function toSummary(app: AppWithVersions): AppSummary {
  const versions = app.versions ?? [];
  const latest = latestVersion(versions);
  const lastUpdated = versions.reduce<string | null>(
    (newest, v) => (!newest || v.uploaded_at > newest ? v.uploaded_at : newest),
    null,
  );

  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    packageName: app.package_name,
    category: app.category,
    description: app.description,
    iconUrl: app.icon_url,
    developer: app.developer_name,
    downloadCount: app.download_count ?? 0,
    createdAt: app.created_at,
    latestVersion: latest?.version_name ?? null,
    fileSize: latest?.file_size ?? null,
    minAndroid: latest?.min_android_version ?? null,
    lastUpdated,
    scannedAt: latest?.scanned_at ?? null,
    scanStatus: latest?.scan_status ?? null,
    rating: app.rating ?? null,
    ratingCount: app.rating_count ?? 0,
    sourceType: app.source_type ?? "fdroid",
    externalUrl: app.external_url ?? null,
    hostedLocally: app.hosted_locally ?? true,
  };
}

async function fetchCatalogue(): Promise<{ apps: AppSummary[]; error: string | null }> {
  const { data, error } = await supabase
    .from("apps")
    .select(SELECT)
    .order("name")
    .returns<AppWithVersions[]>();

  if (error) return { apps: [], error: error.message };
  return {
    apps: (data ?? [])
      .map(toSummary)
      .filter((app) => app.latestVersion !== null),
    error: null,
  };
}

/**
 * The homepage reads searchParams for shareable filter URLs, which makes it a
 * dynamic route — it cannot be ISR. Caching the query itself gets most of the
 * benefit anyway: Supabase is hit once an hour rather than once per visitor.
 * Tagged so an admin edit can drop it immediately via revalidateTag.
 */
export const getCatalogue = unstable_cache(fetchCatalogue, ["catalogue"], {
  revalidate: 3600,
  tags: ["catalogue"],
});

async function fetchAppBySlug(slug: string): Promise<App | null> {
  const { data } = await supabase
    .from("apps")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<App>();
  return data;
}

/**
 * app/app/[slug]/page.tsx calls this once from generateMetadata and once
 * from the page body for the same slug — without memoization that's two
 * identical, uncached Supabase round trips per render. Wrapped in React's
 * cache(), not unstable_cache: cache() dedupes calls with identical
 * arguments within a single render/request only, and the memoized result is
 * discarded once that request finishes. Nothing is shared across requests
 * or across visitors, so this introduces no cross-request cache semantics
 * and nothing here can go stale the way a longer-lived cache could. Contrast
 * with getCatalogue above, which deliberately does want its result shared
 * across requests for up to an hour.
 */
export const getAppBySlug = cache(fetchAppBySlug);

/**
 * Newest build first. RLS already restricts this to published builds; the
 * explicit filter documents the intent and keeps the page correct if the
 * policy is ever relaxed.
 */
async function fetchPublishedVersions(appId: string): Promise<Version[]> {
  const { data } = await supabase
    .from("versions")
    .select("*")
    .eq("app_id", appId)
    .eq("published", true)
    .order("version_code", { ascending: false })
    .returns<Version[]>();
  return data ?? [];
}

/** Per-request memoized the same way and for the same reason as getAppBySlug above. */
export const getPublishedVersions = cache(fetchPublishedVersions);

/** Other apps in the same category, most downloaded first. */
export async function getRelatedApps(
  category: string | null,
  excludeId: string,
  limit = 4,
): Promise<AppSummary[]> {
  if (!category) return [];
  const { data } = await supabase
    .from("apps")
    .select(SELECT)
    .eq("category", category)
    .neq("id", excludeId)
    .order("download_count", { ascending: false })
    .limit(limit)
    .returns<AppWithVersions[]>();
  return (data ?? []).map(toSummary);
}

/** Slugs of the most-downloaded apps, for build-time prerendering. */
export async function getPopularSlugs(limit = 50): Promise<string[]> {
  const { data } = await supabase
    .from("apps")
    .select("slug")
    .order("download_count", { ascending: false })
    .limit(limit)
    .returns<{ slug: string }[]>();
  return (data ?? []).map((row) => row.slug);
}
