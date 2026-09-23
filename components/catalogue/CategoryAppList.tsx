import Link from "next/link";
import AppCard from "@/components/AppCard";
import type { AppSummary } from "@/lib/types";

/**
 * Cards per page — matches CatalogueSection's own PAGE_SIZE, so a page here
 * lines up with what "Show more" would reveal one click at a time on the
 * interactive grid above it.
 */
export const PAGE_SIZE = 24;

/**
 * A server-rendered, fully paginated, crawlable browse list for one
 * category — real <a href> links and real ?category=X&page=N URLs, no
 * JavaScript required.
 *
 * Exists alongside CatalogueSection's own interactive search/filter widget
 * (unchanged), not instead of it: CatalogueSection only ever server-renders
 * a category's first PAGE_SIZE apps (by trending) before "Show more" takes
 * over client-side, so anything beyond that page has no crawlable URL of
 * its own without this. Only rendered by the caller for categories with
 * more than PAGE_SIZE apps — smaller categories are already fully covered
 * by CatalogueSection's own first page, so a second list here would just
 * repeat it for no benefit.
 */
export default function CategoryAppList({
  apps,
  category,
  page,
  totalPages,
}: {
  /** Already sliced to the current page. */
  apps: AppSummary[];
  category: string;
  page: number;
  totalPages: number;
}) {
  function pageHref(target: number): string {
    const qs = new URLSearchParams({ category });
    if (target > 1) qs.set("page", String(target));
    return `/?${qs.toString()}`;
  }

  return (
    <section className="mt-12 sm:mt-20">
      <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
        All {category} apps
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        Every {category} app in the catalogue — page {page} of {totalPages}.
      </p>

      {/* Same rich AppCard the interactive catalogue grid above already uses
          (icon, description, source/safety badges, rating, favourite) —
          reusing it here rather than a second, lighter card keeps one
          consistent card design for the whole page and gives this
          server-rendered, fully crawlable list the same visual quality as
          the JS-driven grid, not a plainer fallback. */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:mt-6 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
        {apps.map((app) => (
          <AppCard key={app.id} app={app} />
        ))}
      </div>

      {totalPages > 1 && (
        <nav
          aria-label={`${category} pages`}
          className="mt-8 flex flex-wrap items-center justify-center gap-2"
        >
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
              rel="prev"
              className="rounded-lg border border-base-700 px-3.5 py-2 text-sm text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
            >
              ‹ Prev
            </Link>
          )}

          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) =>
            n === page ? (
              <span
                key={n}
                aria-current="page"
                className="rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-base-950"
              >
                {n}
              </span>
            ) : (
              <Link
                key={n}
                href={pageHref(n)}
                className="rounded-lg border border-base-700 px-3.5 py-2 text-sm text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
              >
                {n}
              </Link>
            ),
          )}

          {page < totalPages && (
            <Link
              href={pageHref(page + 1)}
              rel="next"
              className="rounded-lg border border-base-700 px-3.5 py-2 text-sm text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
            >
              Next ›
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
