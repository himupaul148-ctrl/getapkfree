import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import SourceBadge from "@/components/SourceBadge";
import type { AppSummary } from "@/lib/types";

/**
 * Sidebar app list. Deliberately links into `/app/[slug]` rather than straight
 * at a download — the point of a post is to move readers onto app pages, where
 * the scan status, versions and permissions are.
 */
export default function RelatedApps({
  apps,
  fallback,
}: {
  apps: AppSummary[];
  fallback: boolean;
}) {
  if (apps.length === 0) return null;

  return (
    <aside className="lg:sticky lg:top-24">
      <h2 className="text-sm font-semibold tracking-wider text-fg-dim uppercase">
        {fallback ? "Trending This Week" : "Related Apps"}
      </h2>

      <ul className="mt-4 space-y-3">
        {apps.map((app) => (
          <li key={app.id}>
            <Link
              href={`/app/${app.slug}`}
              className="group flex items-start gap-3 rounded-xl border border-base-800 bg-base-900 p-3 transition-colors hover:border-brand-500/50 hover:bg-base-850"
            >
              <AppIcon src={app.iconUrl} name={app.name} size={44} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg transition-colors group-hover:text-brand-400">
                  {app.name}
                </p>
                {app.category && (
                  <p className="truncate text-xs text-fg-dim">{app.category}</p>
                )}
                <div className="mt-1.5">
                  <SourceBadge
                    sourceType={app.sourceType}
                    externalUrl={app.externalUrl}
                  />
                </div>
              </div>

              <span className="mt-1 shrink-0 rounded-lg bg-brand-500/10 px-2.5 py-1 text-xs font-semibold text-brand-300 transition-colors group-hover:bg-brand-500 group-hover:text-base-950">
                Download
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
