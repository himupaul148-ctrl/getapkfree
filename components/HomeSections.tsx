import Link from "next/link";
import AppCard from "@/components/AppCard";
import AppCarousel, { CAROUSEL_ITEM } from "@/components/AppCarousel";
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

  /*
   * Downloads first, then most recently updated, then name.
   *
   * The heading above this row is deliberately neutral — "Explore Apps" rather
   * than a claim about popularity or freshness. That is what lets the order be
   * a blend: only seven apps have any download at all, all of them 1-3, so a
   * heading promising "most downloaded" would be false today, and one promising
   * "most recently updated" would go false later as downloads accumulate and
   * the first key starts to dominate. A neutral label stays true either way, so
   * this sort needs no revisiting when the traffic arrives.
   *
   * The name key is what keeps the order stable between renders once the
   * other two tie.
   *
   * Apps with no published build are dropped: `latestVersion` is null when RLS
   * returned no published version, and an app with nothing to install does not
   * belong in a row inviting people to explore.
   *
   * 12 rather than 10 — a carousel needs enough travel to be worth scrolling
   * at the 5-across desktop width.
   */
  const exploreApps = [...apps]
    .filter((app) => app.latestVersion !== null)
    .sort(
      (a, b) =>
        b.downloadCount - a.downloadCount ||
        (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? "") ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 12);

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
      {/* Sits above Trending so the editorial route is offered before the
          reader falls into browsing the catalogue. */}
      <section className="mt-16">
        <Link
          href="/blog"
          className="group flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-azure-500/25 bg-azure-500/5 p-5 transition-colors hover:border-azure-500/50"
        >
          <span className="rounded-full bg-azure-500/15 px-2.5 py-0.5 text-xs font-medium text-azure-300">
            New
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-fg">
              Not sure what to install?
            </span>
            <span className="mt-0.5 block text-sm text-fg-muted">
              Read our guides — privacy picks, lightweight tools, and what to
              avoid.
            </span>
          </span>
          <span className="text-sm font-medium text-azure-300 transition-transform group-hover:translate-x-0.5">
            Check the blog →
          </span>
        </Link>
      </section>

      {exploreApps.length > 0 && (
        /* id kept as "trending": the header nav, the 404 page and any link
           anyone has already shared point at #trending. */
        <section
          id="trending"
          aria-labelledby="explore-apps-heading"
          className="mt-16"
        >
          <h2
            id="explore-apps-heading"
            className="text-2xl font-bold tracking-tight"
          >
            Explore Apps
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Discover apps from the GetAPKFree catalogue
          </p>

          {/* Cards stay server-rendered — the carousel only wraps them. */}
          <AppCarousel label="Explore apps">
            {exploreApps.map((app) => (
              <li key={app.id} className={CAROUSEL_ITEM}>
                <AppCard app={app} />
              </li>
            ))}
          </AppCarousel>
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
