import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import type { TargetAppLink } from "@/lib/blog";

/**
 * The article page's reference to its resolved target app — shared by all
 * three type-specific layouts (components/blog/*ArticleLayout.tsx) rather
 * than three near-duplicate cards.
 *
 * "compact" is the original APP_RELATED/REVIEW_OTHER "About this app" card
 * (unchanged pixel-for-pixel from before this task — reuses the exact style
 * the prev/next nav cards already use). "prominent" is the App Related
 * layout's own "TOP APP CONTEXT" banner: bigger icon, developer/category
 * line (only the parts that actually exist, joined with " · "), and a real
 * View App button — still linking to the same canonical /app/{slug} page,
 * never a second copy of the app page's own content.
 */
export default function TargetAppCard({
  app,
  variant = "compact",
}: {
  app: TargetAppLink;
  variant?: "compact" | "prominent";
}) {
  if (variant === "prominent") {
    const subtitle = [app.developer_name, app.category].filter(Boolean).join(" · ");

    return (
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-brand-500/30 bg-brand-500/5 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <AppIcon src={app.icon_url} name={app.name} size={56} />
          <div className="min-w-0">
            <p className="text-xs text-fg-dim">This article is about</p>
            <p className="truncate text-base font-bold text-fg sm:text-lg">
              {app.name}
            </p>
            {subtitle && (
              <p className="truncate text-sm text-fg-muted">{subtitle}</p>
            )}
          </div>
        </div>
        <Link
          href={`/app/${app.slug}`}
          className="shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-base-950 transition-colors hover:bg-brand-400"
        >
          View App
        </Link>
      </div>
    );
  }

  return (
    <Link
      href={`/app/${app.slug}`}
      className="flex items-center gap-3 rounded-xl border border-base-800 bg-base-900 p-4 transition-colors hover:border-brand-500/50"
    >
      <AppIcon src={app.icon_url} name={app.name} size={40} />
      <span className="min-w-0">
        <span className="block text-xs text-fg-dim">About this app</span>
        <span className="block truncate font-medium text-fg">{app.name}</span>
      </span>
    </Link>
  );
}
