import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import ScanBadge from "@/components/ScanBadge";
import SourceBadge from "@/components/SourceBadge";
import RatingStars from "@/components/RatingStars";
import FavoriteToggle from "@/components/FavoriteToggle";
import { formatBytes, formatCount, formatRelative } from "@/lib/format";
import type { AppSummary } from "@/lib/types";

export default function AppCard({ app, rank }: { app: AppSummary; rank?: number }) {
  return (
    <div className="relative h-full w-full min-w-0">
      <FavoriteToggle appId={app.id} appName={app.name} />
      <Link
        href={`/app/${app.slug}`}
        className="group flex h-full flex-col rounded-2xl border border-base-800 bg-base-900 p-4 transition-colors hover:border-brand-500/50 hover:bg-base-850 focus-visible:border-brand-500 focus-visible:outline-none sm:p-5"
      >
      {/* Leave room for the heart in the top-right corner. */}
      <div className="flex items-start gap-3 pr-9 sm:gap-4 sm:pr-10">
        <AppIcon src={app.iconUrl} name={app.name} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-fg transition-colors group-hover:text-brand-400">
            {app.name}
          </h3>
          <p className="truncate text-sm text-fg-dim">{app.developer}</p>
          {app.category && (
            <span className="mt-1.5 inline-block rounded-full border border-base-700 px-2.5 py-0.5 text-xs text-fg-muted sm:mt-2">
              {app.category}
            </span>
          )}
        </div>
      </div>

      {/* Single line, not two: the full description lives on the app detail
          page — here it's a scan-friendly preview, and one line keeps the
          card compact without dropping any of the badges/facts below it. */}
      <p className="mt-2.5 line-clamp-1 flex-1 text-sm leading-relaxed text-fg-muted sm:mt-3">
        {app.description}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mt-3">
        <SourceBadge sourceType={app.sourceType} externalUrl={app.externalUrl} />
        {app.sourceType !== "external" && (
          <ScanBadge
            status={app.scanStatus}
            scannedAt={app.scannedAt}
            showDate={false}
          />
        )}
        {app.rating !== null && (
          <RatingStars rating={app.rating} count={app.ratingCount} compact />
        )}
      </div>

      <dl className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-base-800 pt-2.5 text-xs text-fg-dim sm:mt-3">
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
        {app.hostedLocally && (
          <div className="flex gap-1.5">
            <dt className="sr-only">Size</dt>
            <dd>{formatBytes(app.fileSize)}</dd>
          </div>
        )}
        <div className="ml-auto flex gap-1.5">
          <dt className="sr-only">Updated</dt>
          <dd>{formatRelative(app.lastUpdated)}</dd>
        </div>
      </dl>
      </Link>
    </div>
  );
}
