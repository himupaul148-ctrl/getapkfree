import AppCard from "@/components/AppCard";
import CatalogueSection from "@/components/catalogue/CatalogueSection";
import CategoryCards from "@/components/catalogue/CategoryCards";
import FilterProvider from "@/components/catalogue/FilterProvider";
import { getCatalogue } from "@/lib/catalogue";
import { formatRelative } from "@/lib/format";
import { CATEGORIES } from "@/lib/types";
import type { Filters } from "@/components/catalogue/FilterProvider";

/**
 * Everything on the homepage that needs Supabase. Split out of page.tsx so it
 * can sit behind its own <Suspense> boundary — a root app/loading.tsx would
 * also swallow /about, /how-to-install and every other page.
 */
export default async function HomeSections({ filters }: { filters: Filters }) {
  const { apps, error } = await getCatalogue();

  if (error) {
    return (
      <div className="mt-10 rounded-xl border border-red-900/60 bg-red-950/40 p-5">
        <p className="font-semibold text-red-300">Could not reach Supabase</p>
        <p className="mt-1 font-mono text-sm text-red-400/90">{error}</p>
      </div>
    );
  }

  // Straight download count, as specified. The "Trending" sort option in the
  // catalogue below still damps by recency — that one exists to differ from
  // "Most downloaded", which this section does not need to.
  const trending = [...apps]
    .sort((a, b) => b.downloadCount - a.downloadCount)
    .slice(0, 10);

  const recentlyUpdated = [...apps]
    .filter((app) => app.lastUpdated)
    .sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""))
    .slice(0, 10);

  const counts = Object.fromEntries(
    CATEGORIES.map((c) => [c, apps.filter((a) => a.category === c).length]),
  );

  return (
    /* The category cards and the catalogue share one filter state, so a
       selection made in either place is reflected in both. Keyed on the
       incoming params so a header search remounts it with that query. */
    <FilterProvider
      key={`${filters.search}|${filters.category}|${filters.android}|${filters.sort}`}
      initial={filters}
    >
      {trending.length > 0 && (
        <section id="trending" className="mt-16">
          <h2 className="text-2xl font-bold tracking-tight">Trending This Week</h2>
          <p className="mt-1 text-sm text-fg-muted">
            The ten most downloaded apps in the catalogue.
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {trending.map((app, index) => (
              <AppCard key={app.id} app={app} rank={index + 1} />
            ))}
          </div>
        </section>
      )}

      <CategoryCards counts={counts} />

      <CatalogueSection apps={apps} />

      {recentlyUpdated.length > 0 && (
        <section id="recently-updated" className="mt-20">
          <h2 className="text-2xl font-bold tracking-tight">Recently updated</h2>
          <p className="mt-1 text-sm text-fg-muted">
            The ten most recent builds to clear scanning.
          </p>

          <ul className="mt-6 divide-y divide-base-800 overflow-hidden rounded-2xl border border-base-800 bg-base-900">
            {recentlyUpdated.map((app) => (
              <li key={app.id}>
                <a
                  href={`/app/${app.slug}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-base-850"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">
                    {app.name}
                  </span>
                  <span className="hidden text-sm text-fg-dim sm:block">
                    {app.category}
                  </span>
                  <span className="font-mono text-sm text-brand-400">
                    v{app.latestVersion}
                  </span>
                  <span className="w-28 text-right text-sm text-fg-muted">
                    {formatRelative(app.lastUpdated)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </FilterProvider>
  );
}
