import Link from "next/link";
import AppCarousel, { CAROUSEL_ITEM } from "@/components/AppCarousel";
import BlogCard from "@/components/blog/BlogCard";
import CatalogueSection from "@/components/catalogue/CatalogueSection";
import CategoryAppList, {
  PAGE_SIZE as CATEGORY_PAGE_SIZE,
} from "@/components/catalogue/CategoryAppList";
import CategoryCards from "@/components/catalogue/CategoryCards";
import FilterProvider from "@/components/catalogue/FilterProvider";
import FeaturedAppCard from "@/components/FeaturedAppCard";
import WhyGetApkFree from "@/components/WhyGetApkFree";
import { getRecentPosts, HOME_RECENT_POSTS_LIMIT, getPostsBySlugs } from "@/lib/blog";
import { getCatalogue } from "@/lib/catalogue";
// PREVIEW EXPERIMENT — Variant B early-preload investigation, not yet committed.
import { alreadyKnownApps, deltaPreloadUrl } from "@/lib/catalogue-delta";
import { trendingScore } from "@/lib/format";
import { categoryListicle, isCategory } from "@/lib/category-content";
import { CATEGORIES } from "@/lib/types";
import type { Filters } from "@/components/catalogue/FilterProvider";
import type { AppSummary } from "@/lib/types";

/**
 * Everything on the homepage that needs Supabase. Split out of page.tsx so it
 * can sit behind its own <Suspense> boundary — a root app/loading.tsx would
 * also swallow /about, /how-to-install and every other page.
 */
export default async function HomeSections({
  filters,
  categoryPage,
}: {
  filters: Filters;
  /** Normalised, unclamped page number for the category browse list below —
      meaningless (and ignored) unless filters.category is set. */
  categoryPage: number;
}) {
  // The one already-audited, per-category editorial relationship
  // (lib/category-content.ts's CATEGORY_LISTICLE — the same "best
  // open-source X apps" guide already linked from this category's own hero
  // above and from every app/[slug] page in this category) drives this
  // section too, rather than lib/blog-app-category-mapping.ts's blog-category
  // matching: that mechanism only ever covered 4 of the 8 app categories and,
  // even for those 4, returned few/no results because most posts share the
  // "guides" blog category regardless of topic. Reusing a verified
  // relationship instead of inventing a new one. Resolved synchronously from
  // `filters` alone, so it can join the same Promise.all below instead of
  // creating a second round trip after the fact.
  const categorySlug =
    filters.category && isCategory(filters.category)
      ? categoryListicle(filters.category)?.slug
      : undefined;

  // getRecentPosts() throws on a genuine Supabase failure (see
  // lib/supabase/query-result.ts) — caught here so a blog-side outage only
  // drops the homepage's blog teaser, not the whole page (unlike getCatalogue,
  // which reports its own error inline and is handled below). The category
  // section behaves the same way for the same reason — and simply has
  // nothing to fetch at all when the active category has no listicle.
  const [{ apps, error }, latestPosts, categoryRelatedPosts] = await Promise.all([
    getCatalogue(),
    getRecentPosts(HOME_RECENT_POSTS_LIMIT).catch(() => []),
    categorySlug ? getPostsBySlugs([categorySlug]).catch(() => []) : Promise.resolve([]),
  ]);

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

  /*
   * A real, crawlable, paginated browse list for the active category —
   * separate from CatalogueSection's own interactive grid, which never
   * server-renders past its first PAGE_SIZE results. Only computed (and
   * only rendered below) when the category has more apps than a single
   * CatalogueSection page already shows; smaller categories are already
   * fully covered by that first page, so this would just repeat it.
   *
   * Sorted the same way CatalogueSection defaults to ("trending"), so page
   * 1 here lines up with what a visitor already sees above before this
   * section starts covering the rest.
   */
  let categoryPageApps: AppSummary[] = [];
  let categoryTotalPages = 1;
  let categoryPageClamped = 1;
  if (filters.category) {
    const categoryApps = apps.filter((a) => a.category === filters.category);
    if (categoryApps.length > CATEGORY_PAGE_SIZE) {
      const sorted = [...categoryApps].sort(
        (a, b) =>
          trendingScore(b.downloadCount, b.lastUpdated) -
          trendingScore(a.downloadCount, a.lastUpdated),
      );
      categoryTotalPages = Math.max(1, Math.ceil(sorted.length / CATEGORY_PAGE_SIZE));
      categoryPageClamped = Math.min(categoryPage, categoryTotalPages);
      const start = (categoryPageClamped - 1) * CATEGORY_PAGE_SIZE;
      categoryPageApps = sorted.slice(start, start + CATEGORY_PAGE_SIZE);
    }
  }

  // PREVIEW EXPERIMENT — Variant B early-preload investigation, not yet
  // committed. The preload() call itself lives in DeltaPreload (a separate,
  // earlier Suspense sibling in app/page.tsx) — this only computes the same
  // already-known subset so CatalogueSection can render it immediately
  // instead of the full 272 while the delta request is in flight.
  const catalogueInitialApps = alreadyKnownApps(apps);
  const catalogueDeltaUrl = deltaPreloadUrl(apps);

  return (
    /* The category cards and the catalogue share one filter state, so a
       selection made in either place is reflected in both. Keyed on the
       incoming params so a header search remounts it with that query. */
    <FilterProvider
      key={`${filters.search}|${filters.category}|${filters.android}|${filters.sort}`}
      initial={filters}
    >
      {/* Popular Categories — leads the page body, right after the hero,
          so browsing-by-category is the first thing offered below the
          fold. */}
      <CategoryCards counts={counts} />

      {exploreApps.length > 0 && (
        /* id kept as "trending": the header nav, the 404 page and any link
           anyone has already shared point at #trending — only the visible
           heading below is renamed to "Featured Apps". */
        <section
          id="trending"
          aria-labelledby="explore-apps-heading"
          className="mt-12 sm:mt-16"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2
                id="explore-apps-heading"
                className="text-xl font-bold tracking-tight sm:text-2xl"
              >
                Featured Apps
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Popular picks from the GetApkFree catalogue
              </p>
            </div>
            <Link
              href="/apps"
              className="shrink-0 text-sm font-medium text-brand-400 hover:underline"
            >
              See all →
            </Link>
          </div>

          {/* Cards stay server-rendered — the carousel only wraps them. */}
          <AppCarousel label="Featured apps">
            {exploreApps.map((app, index) => (
              <li key={app.id} className={CAROUSEL_ITEM}>
                {/* Only the first card is a realistic LCP candidate — the
                    rest of the carousel is offscreen/scrolled-to. */}
                <FeaturedAppCard app={app} priority={index === 0} />
              </li>
            ))}
          </AppCarousel>
        </section>
      )}

      {recentlyUpdated.length > 0 && (
        <section id="recently-updated" className="mt-12 sm:mt-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Recently Updated</h2>
              <p className="mt-1 text-sm text-fg-muted">
                The ten most recent builds to clear scanning
              </p>
            </div>
            <Link
              href="/apps"
              className="shrink-0 text-sm font-medium text-brand-400 hover:underline"
            >
              See all →
            </Link>
          </div>

          <div className="mt-5 divide-y divide-base-800 overflow-hidden rounded-2xl border border-base-800 bg-base-900 sm:mt-6">
            {recentlyUpdated.map((app) => (
              <FeaturedAppCard key={app.id} app={app} dense />
            ))}
          </div>
        </section>
      )}

      {/* Heading/CTA sits as CatalogueSection's own sibling, not a wrapper
          around it — CatalogueSection renders its own <section id="catalogue">
          with its own top margin, so nesting it here would double that gap.
          Its internals are unchanged; this only adds the homepage's framing
          above it. */}
      <div className="mt-12 flex flex-wrap items-end justify-between gap-4 sm:mt-20">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Explore All Apps</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Search, filter and browse the full catalogue
          </p>
        </div>
        <Link
          href="/apps"
          className="shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-base-950 transition-colors hover:bg-brand-400"
        >
          Browse All Apps →
        </Link>
      </div>

      <CatalogueSection
        apps={apps}
        initialApps={catalogueInitialApps}
        deltaUrl={catalogueDeltaUrl}
      />

      {filters.category && categoryPageApps.length > 0 && (
        <CategoryAppList
          apps={categoryPageApps}
          category={filters.category}
          page={categoryPageClamped}
          totalPages={categoryTotalPages}
        />
      )}

      {/* Category -> blog internal linking, driven by CATEGORY_LISTICLE
          (lib/category-content.ts). Renders only when the active category
          has a listicle AND that post is actually published — never an
          empty heading or placeholder. Reuses BlogCard and the exact grid
          layout "Latest from the Blog" below already uses, rather than a
          new card design. */}
      {filters.category && categoryRelatedPosts.length > 0 && (
        <section className="mt-12 sm:mt-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                {filters.category} Guides &amp; Articles
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Related posts from the GetApkFree blog
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 sm:mt-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {categoryRelatedPosts.map((post) => (
              <BlogCard key={post.id} post={post} />
            ))}
          </div>
        </section>
      )}

      {latestPosts.length > 0 && (
        <section className="mt-12 sm:mt-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                Latest from the Blog
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Guides and picks from the GetApkFree team
              </p>
            </div>
            <Link
              href="/blog"
              className="shrink-0 text-sm font-medium text-brand-400 hover:underline"
            >
              See all →
            </Link>
          </div>

          <div className="mt-5 grid gap-5 sm:mt-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {latestPosts.map((post) => (
              <BlogCard key={post.id} post={post} />
            ))}
          </div>
        </section>
      )}

      <WhyGetApkFree />
    </FilterProvider>
  );
}
