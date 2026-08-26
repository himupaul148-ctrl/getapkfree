import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AppCard from "@/components/AppCard";
import AccountPanel from "@/components/profile/AccountPanel";
import DownloadsPanel, {
  type DownloadRow,
} from "@/components/profile/DownloadsPanel";
import ProfileNav, { TABS, type TabKey } from "@/components/profile/ProfileNav";
import SettingsPanel from "@/components/profile/SettingsPanel";
import { getProfile } from "@/lib/profile";
import { createClient, getUser } from "@/lib/supabase/server";
import { toSummary } from "@/lib/catalogue";
import type { AppSummary, AppWithVersions } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile",
  description: "Your GetApkFree account, downloads and favourites.",
};

/** Shape returned by the downloads join. */
type RawDownload = {
  id: string;
  downloaded_at: string;
  versions: {
    id: string;
    version_name: string;
    file_size: number | null;
    file_url: string | null;
    apps: { name: string; slug: string; icon_url: string | null } | null;
  } | null;
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: TabKey = TABS.some((t) => t.key === tab)
    ? (tab as TabKey)
    : "account";

  const user = await getUser();
  // Middleware already guards this route; this is the belt-and-braces check so
  // the page is safe even if the matcher is ever narrowed.
  if (!user) redirect("/login?next=/profile");

  const profile = await getProfile();
  if (!profile) redirect("/login?next=/profile");

  const supabase = await createClient();

  const [downloadsResult, favoritesResult] = await Promise.all([
    active === "downloads"
      ? supabase
          .from("downloads")
          .select(
            "id, downloaded_at, versions(id, version_name, file_size, file_url, apps(name, slug, icon_url))",
          )
          .eq("user_id", user.id)
          .order("downloaded_at", { ascending: false })
          .limit(100)
          .returns<RawDownload[]>()
      : Promise.resolve({ data: [] as RawDownload[] }),
    active === "favorites"
      ? supabase
          .from("favorites")
          .select(
            "app_id, created_at, apps(*, versions(version_name, version_code, file_size, min_android_version, uploaded_at, scanned_at, scan_status))",
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .returns<{ app_id: string; apps: AppWithVersions | null }[]>()
      : Promise.resolve({ data: [] as { app_id: string; apps: AppWithVersions | null }[] }),
  ]);

  const downloadRows: DownloadRow[] = (downloadsResult.data ?? []).map((row) => ({
    id: row.id,
    downloaded_at: row.downloaded_at,
    versionId: row.versions?.id ?? null,
    versionName: row.versions?.version_name ?? null,
    fileSize: row.versions?.file_size ?? null,
    fileUrl: row.versions?.file_url ?? null,
    appName: row.versions?.apps?.name ?? null,
    appSlug: row.versions?.apps?.slug ?? null,
    appIcon: row.versions?.apps?.icon_url ?? null,
  }));

  // Same shaping the catalogue uses, so favourite cards render identically.
  const favoriteApps: AppSummary[] = (favoritesResult.data ?? [])
    .map((row) => row.apps)
    .filter((app): app is AppWithVersions => Boolean(app))
    .map(toSummary);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold tracking-tight">
        {profile.username}
      </h1>
      <p className="mt-1 text-fg-muted">{profile.email}</p>

      <div className="mt-8 flex flex-col gap-8 md:flex-row md:gap-10">
        <ProfileNav active={active} />

        <div className="min-w-0 flex-1">
          {active === "account" && <AccountPanel profile={profile} />}

          {active === "downloads" && <DownloadsPanel rows={downloadRows} />}

          {active === "favorites" && (
            <section>
              <h2 className="text-xl font-bold tracking-tight">Favorites</h2>
              <p className="mt-1 text-sm text-fg-muted">
                {favoriteApps.length === 0
                  ? "Nothing saved yet."
                  : `${favoriteApps.length} saved app${favoriteApps.length === 1 ? "" : "s"}.`}
              </p>

              {favoriteApps.length === 0 ? (
                <p className="mt-5 rounded-2xl border border-base-800 bg-base-900 p-8 text-center text-fg-muted">
                  Tap the heart on any app card to save it here.{" "}
                  <Link href="/" className="text-brand-400 hover:underline">
                    Browse the catalogue
                  </Link>
                  .
                </p>
              ) : (
                <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {favoriteApps.map((app) => (
                    <AppCard key={app.id} app={app} />
                  ))}
                </div>
              )}
            </section>
          )}

          {active === "settings" && <SettingsPanel profile={profile} />}
        </div>
      </div>
    </div>
  );
}
