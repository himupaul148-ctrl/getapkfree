import { supabase } from "@/lib/supabase/public";
import { latestVersion } from "@/lib/format";
import type { App, AppSummary, AppWithVersions, Version } from "@/lib/types";

const SELECT =
  "*, versions(version_name, version_code, file_size, min_android_version, uploaded_at, scanned_at, scan_status)";

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
  };
}

export async function getCatalogue(): Promise<{
  apps: AppSummary[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("apps")
    .select(SELECT)
    .order("name")
    .returns<AppWithVersions[]>();

  if (error) return { apps: [], error: error.message };
  return { apps: (data ?? []).map(toSummary), error: null };
}

export async function getAppBySlug(slug: string): Promise<App | null> {
  const { data } = await supabase
    .from("apps")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<App>();
  return data;
}

/**
 * Newest build first. RLS already restricts this to published builds; the
 * explicit filter documents the intent and keeps the page correct if the
 * policy is ever relaxed.
 */
export async function getPublishedVersions(appId: string): Promise<Version[]> {
  const { data } = await supabase
    .from("versions")
    .select("*")
    .eq("app_id", appId)
    .eq("published", true)
    .order("version_code", { ascending: false })
    .returns<Version[]>();
  return data ?? [];
}

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
