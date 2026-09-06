import AppsManager, { type ManagedApp } from "@/components/admin/AppsManager";
import { createClient } from "@/lib/supabase/server";
import { sortVersionsByCodeDesc, type ManagedVersion } from "@/lib/admin/version-publish";
import type { SourceType } from "@/lib/sources";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  slug: string;
  package_name: string;
  category: string | null;
  description: string | null;
  developer_name: string | null;
  created_at: string;
  download_count: number | null;
  source_type: SourceType;
  external_url: string | null;
  icon_url: string | null;
  screenshots: string[] | null;
  rating: number | null;
  rating_count: number | null;
  manual_fields: string[] | null;
  versions: {
    id: string;
    published: boolean;
    version_name: string;
    version_code: number;
    scan_status: string | null;
    scanned_at: string | null;
    min_android_version: string | null;
    uploaded_at: string;
    file_size: number | null;
  }[];
};

/** Highest version_code wins, matching how the public pages pick a build. */
function newest(row: Row) {
  return [...(row.versions ?? [])].sort(
    (a, b) => b.version_code - a.version_code,
  )[0];
}

export default async function AdminAppsPage() {
  const supabase = await createClient();

  // Admins can read unpublished versions, so these counts cover every build,
  // not just the ones the public site shows. scan_status/min_android_version/
  // uploaded_at/file_size are pulled per version now too, so the manager can
  // show and gate on each build individually rather than the app as a whole.
  const { data, error } = await supabase
    .from("apps")
    .select(
      "id, name, slug, package_name, category, description, developer_name, created_at, download_count, source_type, external_url, icon_url, screenshots, rating, rating_count, manual_fields, versions(id, published, version_name, version_code, scan_status, scanned_at, min_android_version, uploaded_at, file_size)",
    )
    .order("created_at", { ascending: false })
    .returns<Row[]>();

  const apps: ManagedApp[] = (data ?? []).map((row) => {
    const versions: ManagedVersion[] = sortVersionsByCodeDesc(
      (row.versions ?? []).map((v) => ({
        id: v.id,
        versionName: v.version_name,
        versionCode: v.version_code,
        published: v.published,
        scanStatus: v.scan_status,
        scannedAt: v.scanned_at,
        minAndroidVersion: v.min_android_version,
        uploadedAt: v.uploaded_at,
        fileSize: v.file_size,
      })),
    );

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      packageName: row.package_name,
      category: row.category,
      description: row.description,
      developer: row.developer_name,
      createdAt: row.created_at,
      downloadCount: row.download_count ?? 0,
      versionCount: row.versions?.length ?? 0,
      publishedCount: (row.versions ?? []).filter((v) => v.published).length,
      sourceType: row.source_type ?? "fdroid",
      externalUrl: row.external_url ?? null,
      iconUrl: row.icon_url ?? null,
      screenshots: row.screenshots ?? [],
      rating: row.rating ?? null,
      ratingCount: row.rating_count ?? 0,
      manualFields: row.manual_fields ?? [],
      // Newest build carries the version number the edit form shows.
      latestVersionId: newest(row)?.id ?? null,
      latestVersionName: newest(row)?.version_name ?? null,
      versions,
    };
  });

  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Apps</h2>
      <p className="mt-1 text-sm text-fg-muted">
        {apps.length} app{apps.length === 1 ? "" : "s"} in the catalogue —{" "}
        {apps.filter((a) => a.sourceType === "external").length} external,{" "}
        {apps.filter((a) => a.sourceType !== "external").length} hosted via F-Droid.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error.message}
        </p>
      )}

      <div className="mt-6">
        <AppsManager apps={apps} />
      </div>
    </div>
  );
}
