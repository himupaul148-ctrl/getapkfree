import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Admin status is read from the database, never from the client. The same
 * `is_admin()` predicate backs the RLS policies, so the UI check and the
 * enforcement cannot disagree — hiding the panel is convenience, RLS is what
 * actually stops a non-admin writing.
 */
export async function isAdmin(): Promise<boolean> {
  const user = await getUser();
  if (!user) return false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();

  return data?.is_admin === true;
}

export type AdminStats = {
  apps: number;
  versions: number;
  publishedVersions: number;
  downloads: number;
};

export type RecentUpload = {
  id: string;
  versionName: string;
  published: boolean;
  uploadedAt: string;
  appName: string | null;
  appSlug: string | null;
};

export async function getAdminStats(): Promise<{
  stats: AdminStats;
  recent: RecentUpload[];
}> {
  const supabase = await createClient();

  const [appsRes, versionsRes, publishedRes, countsRes, recentRes] =
    await Promise.all([
      supabase.from("apps").select("id", { count: "exact", head: true }),
      supabase.from("versions").select("id", { count: "exact", head: true }),
      supabase
        .from("versions")
        .select("id", { count: "exact", head: true })
        .eq("published", true),
      // Sum client-side: PostgREST has no SUM without an RPC, and 48 rows is
      // cheaper to add up here than a migration for an aggregate view.
      supabase.from("apps").select("download_count"),
      supabase
        .from("versions")
        .select("id, version_name, published, uploaded_at, apps(name, slug)")
        .order("uploaded_at", { ascending: false })
        .limit(8)
        .returns<
          {
            id: string;
            version_name: string;
            published: boolean;
            uploaded_at: string;
            apps: { name: string; slug: string } | null;
          }[]
        >(),
    ]);

  const downloads = (countsRes.data ?? []).reduce(
    (sum, row: { download_count: number | null }) => sum + (row.download_count ?? 0),
    0,
  );

  return {
    stats: {
      apps: appsRes.count ?? 0,
      versions: versionsRes.count ?? 0,
      publishedVersions: publishedRes.count ?? 0,
      downloads,
    },
    recent: (recentRes.data ?? []).map((row) => ({
      id: row.id,
      versionName: row.version_name,
      published: row.published,
      uploadedAt: row.uploaded_at,
      appName: row.apps?.name ?? null,
      appSlug: row.apps?.slug ?? null,
    })),
  };
}
