import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import RatingStars from "@/components/RatingStars";
import type { AppSummary } from "@/lib/types";

/**
 * Compact homepage teaser card — Featured Apps and (via `dense`) Recently
 * Updated. Deliberately lighter than the catalogue's own AppCard (no
 * description, no source/scan badges, no size/date row): a homepage scan
 * card only needs enough to recognise the app and decide to tap it, and the
 * full detail lives one click away on the app page, which this card's
 * "Download" action already goes to — the same "detail page first" pattern
 * every other list of apps on the site already uses, since the actual
 * install/download mechanism lives there (store link, hosted file, version
 * picker), not on a list card.
 */
export default function FeaturedAppCard({
  app,
  dense = false,
}: {
  app: AppSummary;
  /** Recently Updated's tighter horizontal row: icon + name/meta + a small
      Download link, no card border/padding. */
  dense?: boolean;
}) {
  if (dense) {
    return (
      <Link
        href={`/app/${app.slug}`}
        className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-base-850 sm:px-5"
      >
        <AppIcon src={app.iconUrl} name={app.name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg transition-colors group-hover:text-brand-400">
            {app.name}
          </p>
          <p className="truncate text-xs text-fg-dim">
            {app.latestVersion ? `v${app.latestVersion} • ` : ""}
            {app.category}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-400">
          Download
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={`/app/${app.slug}`}
      className="group flex h-full w-full min-w-0 flex-col rounded-2xl border border-base-800 bg-base-900 p-4 transition-colors hover:border-brand-500/50 hover:bg-base-850 focus-visible:border-brand-500 focus-visible:outline-none"
    >
      <AppIcon src={app.iconUrl} name={app.name} size={48} />
      <p className="mt-3 truncate font-semibold text-fg transition-colors group-hover:text-brand-400">
        {app.name}
      </p>
      {app.category && (
        <p className="mt-0.5 truncate text-xs text-fg-dim">{app.category}</p>
      )}
      {app.rating !== null && (
        <div className="mt-2">
          <RatingStars rating={app.rating} count={app.ratingCount} compact showCount={false} />
        </div>
      )}
      <span className="mt-auto block w-full rounded-xl bg-brand-500 py-2 text-center text-sm font-semibold text-base-950 transition-colors group-hover:bg-brand-400">
        Download
      </span>
    </Link>
  );
}
