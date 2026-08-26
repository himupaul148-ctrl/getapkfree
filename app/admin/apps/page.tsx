import AppsManager, { type ManagedApp } from "@/components/admin/AppsManager";
import { createClient } from "@/lib/supabase/server";
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
  versions: { id: string; published: boolean }[];
};

export default async function AdminAppsPage() {
  const supabase = await createClient();

  // Admins can read unpublished versions, so these counts cover every build,
  // not just the ones the public site shows.
  const { data, error } = await supabase
    .from("apps")
    .select(
      "id, name, slug, package_name, category, description, developer_name, created_at, download_count, source_type, external_url, versions(id, published)",
    )
    .order("created_at", { ascending: false })
    .returns<Row[]>();

  const apps: ManagedApp[] = (data ?? []).map((row) => ({
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
  }));

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
