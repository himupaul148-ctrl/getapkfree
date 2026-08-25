import AppCard from "@/components/AppCard";
import CatalogueSection from "@/components/catalogue/CatalogueSection";
import CategoryCards from "@/components/catalogue/CategoryCards";
import FilterProvider from "@/components/catalogue/FilterProvider";
import {
  normaliseAndroid,
  normaliseCategory,
  normaliseSort,
} from "@/lib/filters";
import { getCatalogue } from "@/lib/catalogue";
import { getFavoriteIds } from "@/lib/profile";
import { getUser } from "@/lib/supabase/server";
import { formatRelative, trendingScore } from "@/lib/format";
import { CATEGORIES } from "@/lib/types";

// Read live from Supabase on every request rather than baking rows in at build time.
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    q?: string;
    category?: string;
    android?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  // `q` is the older param name; keep reading it so existing links still work.
  const search = params.search ?? params.q ?? "";
  const category = normaliseCategory(params.category);
  const android = normaliseAndroid(params.android);
  const sort = normaliseSort(params.sort);

  const [{ apps, error }, user, favoriteIds] = await Promise.all([
    getCatalogue(),
    getUser(),
    getFavoriteIds(),
  ]);
  const signedIn = Boolean(user);

  const trending = [...apps]
    .sort(
      (a, b) =>
        trendingScore(b.downloadCount, b.lastUpdated) -
        trendingScore(a.downloadCount, a.lastUpdated),
    )
    .slice(0, 10);

  const recentlyUpdated = [...apps]
    .filter((app) => app.lastUpdated)
    .sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""))
    .slice(0, 10);

  const counts = Object.fromEntries(
    CATEGORIES.map((c) => [c, apps.filter((a) => a.category === c).length]),
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      {/* Hero */}
      <section className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-300">
          Free apps • Safe downloads
        </span>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          Free, Open-Source Android Apps —{" "}
          <span className="bg-gradient-to-r from-brand-400 to-azure-400 bg-clip-text text-transparent">
            Safe and Scanned
          </span>
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-fg-muted">
          Download legitimate APKs with confidence. Every build is versioned,
          malware-scanned, and published with its full changelog.
        </p>
      </section>

      {error && (
        <div className="mt-10 rounded-xl border border-red-900/60 bg-red-950/40 p-5">
          <p className="font-semibold text-red-300">Could not reach Supabase</p>
          <p className="mt-1 font-mono text-sm text-red-400/90">{error}</p>
        </div>
      )}

      {/* The category cards and the catalogue share one filter state, so a
          selection made in either place is reflected in both. Keyed on the
          incoming params so a header search remounts it with that query. */}
      <FilterProvider
        key={`${search}|${category}|${android}|${sort}`}
        initial={{ search, category, android, sort }}
      >
        {/* Trending */}
        {trending.length > 0 && (
          <section id="trending" className="mt-16">
            <h2 className="text-2xl font-bold tracking-tight">Trending now</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Most downloaded, weighted towards actively maintained builds.
            </p>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {trending.map((app, index) => (
                <AppCard
                  key={app.id}
                  app={app}
                  rank={index + 1}
                  signedIn={signedIn}
                  favorite={favoriteIds.has(app.id)}
                />
              ))}
            </div>
          </section>
        )}

        <CategoryCards counts={counts} />

        <CatalogueSection
          apps={apps}
          signedIn={signedIn}
          favoriteIds={[...favoriteIds]}
        />

        {/* Recently updated */}
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
    </div>
  );
}
