import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import ScanBadge from "@/components/ScanBadge";
import RatingStars from "@/components/RatingStars";
import FavoriteToggle from "@/components/FavoriteToggle";
import { formatBytes, formatCount, formatRelative } from "@/lib/format";
import type { AppSummary } from "@/lib/types";

export default function AppCard({ app, rank }: { app: AppSummary; rank?: number }) {
  return (
    <div className="relative h-full">
      <FavoriteToggle appId={app.id} appName={app.name} />
      <Link
        href={`/app/${app.slug}`}
        className="group flex h-full flex-col rounded-2xl border border-base-800 bg-base-900 p-5 transition-colors hover:border-brand-500/50 hover:bg-base-850 focus-visible:border-brand-500 focus-visible:outline-none"
      >
      {/* Leave room for the heart in the top-right corner. */}
      <div className="flex items-start gap-4 pr-10">
        <AppIcon src={app.iconUrl} name={app.name} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-fg transition-colors group-hover:text-brand-400">
            {app.name}
          </h3>
          <p className="truncate text-sm text-fg-dim">{app.developer}</p>
          {app.category && (
            <span className="mt-2 inline-block rounded-full border border-base-700 px-2.5 py-0.5 text-xs text-fg-muted">
              {app.category}
            </span>
          )}
        </div>
      </div>

      <p className="mt-4 line-clamp-2 flex-1 text-sm leading-relaxed text-fg-muted">
        {app.description}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <ScanBadge status={app.scanStatus} scannedAt={app.scannedAt} />
        {app.rating !== null && (
          <RatingStars rating={app.rating} count={app.ratingCount} compact />
        )}
      </div>

      <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-base-800 pt-3 text-xs text-fg-dim">
        {rank !== undefined && (
          <div className="flex gap-1.5">
            <dt className="sr-only">Rank</dt>
            <dd className="font-mono text-fg-muted">#{rank}</dd>
          </div>
        )}
        {app.latestVersion && (
          <div className="flex gap-1.5">
            <dt className="sr-only">Version</dt>
            <dd className="font-mono text-brand-400">v{app.latestVersion}</dd>
          </div>
        )}
        <div className="flex gap-1.5">
          <dt className="sr-only">Downloads</dt>
          <dd className="text-azure-400">{formatCount(app.downloadCount)} downloads</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="sr-only">Size</dt>
          <dd>{formatBytes(app.fileSize)}</dd>
        </div>
        <div className="ml-auto flex gap-1.5">
          <dt className="sr-only">Updated</dt>
          <dd>{formatRelative(app.lastUpdated)}</dd>
        </div>
      </dl>
      </Link>
    </div>
  );
}
