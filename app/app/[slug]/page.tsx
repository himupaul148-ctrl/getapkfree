import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppCard from "@/components/AppCard";
import AppIcon from "@/components/AppIcon";
import FavoriteToggle from "@/components/FavoriteToggle";
import DownloadButton from "@/components/DownloadButton";
import PermissionsList from "@/components/PermissionsList";
import RatingStars from "@/components/RatingStars";
import ScanBadge from "@/components/ScanBadge";
import ScreenshotGallery from "@/components/ScreenshotGallery";
import VersionHistory from "@/components/VersionHistory";
import {
  getAppBySlug,
  getPublishedVersions,
  getRelatedApps,
} from "@/lib/catalogue";
import { formatBytes, formatCount, formatDate, formatRelative } from "@/lib/format";
import { getFavoriteIds } from "@/lib/profile";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const app = await getAppBySlug(slug);
  if (!app) return { title: "App not found" };
  return { title: app.name, description: app.description ?? undefined };
}

export default async function AppDetailPage({ params }: Props) {
  const { slug } = await params;
  const app = await getAppBySlug(slug);
  if (!app) notFound();

  const [versions, related, user, favoriteIds] = await Promise.all([
    getPublishedVersions(app.id),
    getRelatedApps(app.category, app.id, 4),
    getUser(),
    getFavoriteIds(),
  ]);
  const signedIn = Boolean(user);

  const latest = versions[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link
        href="/"
        className="text-sm text-fg-dim transition-colors hover:text-brand-400"
      >
        ← Back to catalogue
      </Link>

      {/* ---- App header ---- */}
      <header className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start">
        <AppIcon src={app.icon_url} name={app.name} size={104} />

        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            {app.name}
          </h1>
          <p className="mt-1 text-fg-muted">{app.developer_name}</p>
          <p className="mt-1 font-mono text-sm break-all text-fg-dim">
            {app.package_name}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {app.category && (
              <Link
                href={`/?category=${encodeURIComponent(app.category)}#catalogue`}
                className="rounded-full border border-base-700 px-2.5 py-0.5 text-xs text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
              >
                {app.category}
              </Link>
            )}
            <RatingStars rating={app.rating} count={app.rating_count} />
            <span className="text-sm text-azure-400">
              {formatCount(app.download_count ?? 0)} downloads
            </span>
          </div>
        </div>

        <FavoriteToggle
          appId={app.id}
          appName={app.name}
          signedIn={signedIn}
          initialFavorite={favoriteIds.has(app.id)}
          variant="button"
        />
      </header>

      {/* ---- Quick info bar ---- */}
      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-base-800 bg-base-800 sm:grid-cols-4">
        <Fact label="Size" value={formatBytes(latest?.file_size ?? null)} />
        <Fact
          label="Requires"
          value={
            latest?.min_android_version
              ? `Android ${latest.min_android_version}+`
              : "Unknown"
          }
        />
        <Fact
          label="Last updated"
          value={latest ? formatRelative(latest.uploaded_at) : "—"}
          sub={latest ? formatDate(latest.uploaded_at) : undefined}
        />
        <div className="flex flex-col justify-center gap-1.5 bg-base-900 px-4 py-3.5">
          <dt className="text-xs text-fg-dim">Safety</dt>
          <dd>
            <ScanBadge
              status={latest?.scan_status ?? null}
              scannedAt={latest?.scanned_at ?? null}
            />
          </dd>
        </div>
      </dl>

      {/* ---- Primary download ----
          Placed directly under the quick-info bar rather than below the version
          history: it is the page's primary action and belongs above the fold. */}
      {latest ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <DownloadButton
            versionId={latest.id}
            versionName={latest.version_name}
            fileUrl={latest.file_url}
          />
          <span className="text-sm text-fg-dim sm:w-40">
            {formatBytes(latest.file_size)} · APK
          </span>
        </div>
      ) : (
        <p className="mt-6 rounded-2xl border border-base-800 bg-base-900 p-5 text-fg-muted">
          No builds have cleared scanning for this app yet, so there is nothing
          to download.
        </p>
      )}

      {/* ---- Description ---- */}
      <section className="mt-10">
        <h2 className="text-lg font-bold tracking-tight">About this app</h2>
        <p className="mt-3 leading-relaxed text-fg-muted">{app.description}</p>
      </section>

      {/* ---- Screenshots ---- */}
      <ScreenshotGallery screenshots={app.screenshots ?? []} appName={app.name} />

      {/* ---- Permissions (collapsed) ---- */}
      <PermissionsList
        permissions={latest?.permissions ?? []}
        versionName={latest?.version_name ?? null}
      />

      {/* ---- Version history (collapsed) ---- */}
      <VersionHistory versions={versions} />

      <p className="mt-6 rounded-2xl border border-base-800 bg-base-900 p-5 text-sm text-fg-muted">
        New to sideloading?{" "}
        <Link href="/how-to-install" className="text-brand-400 hover:underline">
          Read the install guide
        </Link>{" "}
        before opening an APK.
      </p>

      {/* ---- Related apps ---- */}
      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="text-2xl font-bold tracking-tight">
            More in {app.category}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Other apps in this category, most downloaded first.
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => (
              <AppCard
                key={item.id}
                app={item}
                signedIn={signedIn}
                favorite={favoriteIds.has(item.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col justify-center gap-1 bg-base-900 px-4 py-3.5">
      <dt className="text-xs text-fg-dim">{label}</dt>
      <dd className="font-medium text-fg">
        {value}
        {sub && <span className="block text-xs font-normal text-fg-dim">{sub}</span>}
      </dd>
    </div>
  );
}
