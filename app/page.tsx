import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";
import { LogoMark } from "@/components/Logo";
import HeaderSearch from "@/components/HeaderSearch";
import { CATEGORY_ICON_PATHS, CATEGORY_TINTS } from "@/lib/category-icons";
import { isCategory } from "@/lib/category-content";
import type { Category } from "@/lib/category-content";
// PREVIEW EXPERIMENT — Variant B early-preload investigation, not yet committed.
import DeltaPreload from "@/components/catalogue/DeltaPreload";
import HomeSections from "@/components/HomeSections";
import { PAGE_SIZE as CATEGORY_PAGE_SIZE } from "@/components/catalogue/CategoryAppList";
import {
  AppGridSkeleton,
  CategoryGridSkeleton,
  ListSkeleton,
  SectionHeadingSkeleton,
} from "@/components/Skeletons";
import { getCatalogue } from "@/lib/catalogue";
import { normalisePage } from "@/lib/blog";
import { categoryIntro, categoryListicle } from "@/lib/category-content";
import {
  normaliseAndroid,
  normaliseCategory,
  normaliseSort,
  normaliseSource,
} from "@/lib/filters";
import {
  absolute,
  categoryMetaDescription,
  clampDescription,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";

/**
 * The homepage's own title — kept as one constant so the plain <title> and
 * the openGraph/twitter overrides below can never drift apart from each
 * other. Deliberately NOT changed in app/layout.tsx's title.default or
 * openGraph.title/twitter.title: those are inherited by the category and
 * search branches of this same generateMetadata() too (neither sets its own
 * openGraph/twitter), so a layout-level edit would have silently changed
 * their og:title/twitter:title as well. Overriding only here, with the
 * layout's other openGraph/twitter fields restated verbatim, changes
 * nothing for those other branches.
 */
const HOME_TITLE = "GetApkFree - free android apk download";

/**
 * Same reasoning as HOME_TITLE above, for the description: computed once so
 * the plain description and the openGraph/twitter overrides below can never
 * drift apart. Wrapped in clampDescription() for the same reason
 * app/layout.tsx's own DEFAULT_DESCRIPTION is — SITE_DESCRIPTION is already
 * short by design (see its doc comment in lib/seo.ts), but the homepage's
 * description should follow the same clamp-at-use convention every other
 * page's description in this codebase already does, not rely on the
 * constant staying short on its own.
 */
const HOME_DESCRIPTION = clampDescription(SITE_DESCRIPTION);

// Reading searchParams for shareable filter URLs makes this route dynamic, so
// it cannot be ISR. The Supabase query behind it is cached for an hour instead
// (see lib/catalogue.ts), which is where the real cost was.
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  search?: string;
  q?: string;
  category?: string;
  android?: string;
  sort?: string;
  page?: string;
}>;

/**
 * Categories are query parameters rather than their own routes, so this is
 * where a category-specific title comes from. Filtered and searched views are
 * marked noindex: they are useful to share but would otherwise flood the index
 * with near-duplicate pages, all canonicalising back here anyway.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const params = await searchParams;
  const category = normaliseCategory(params.category);
  const search = (params.search ?? params.q ?? "").trim();
  const filtered = Boolean(category || search);

  if (category) {
    // Mirrors /apps' own pagination pattern: page 1 is canonical at the bare
    // category URL (no `?page=1`, which would be a second URL for the same
    // content); a later page is self-canonical at its own `?page=N`, and an
    // out-of-range or invalid page clamps down to the last real page rather
    // than 404ing or canonicalising to something that doesn't exist.
    const { apps: catalogueApps } = await getCatalogue();
    const categoryCount = catalogueApps.filter((a) => a.category === category).length;
    const totalPages = Math.max(1, Math.ceil(categoryCount / CATEGORY_PAGE_SIZE));
    const page = Math.min(normalisePage(params.page), totalPages);

    const canonicalPath =
      page > 1
        ? `/?category=${encodeURIComponent(category)}&page=${page}`
        : `/?category=${encodeURIComponent(category)}`;

    return {
      title:
        page > 1
          ? `${category} Apps — Page ${page} | Free Open-Source APKs`
          : `${category} Apps — Free Open-Source APKs`,
      description: categoryMetaDescription(category),
      alternates: { canonical: absolute(canonicalPath) },
      robots: { index: true, follow: true },
    };
  }

  if (search) {
    return {
      title: `Search: ${search}`,
      description: `Search results for "${search}" in the GetApkFree catalogue.`,
      alternates: { canonical: absolute("/") },
      robots: { index: false, follow: true },
    };
  }

  return {
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    alternates: { canonical: absolute("/") },
    robots: { index: !filtered, follow: true },
    // Restates the layout's other openGraph/twitter fields verbatim so only
    // `title` changes here — Next.js merges these objects shallowly (a
    // segment that sets its own `openGraph` replaces the whole object, not
    // just the fields it names), so leaving them out would silently drop
    // description/type/siteName/locale/url from the homepage's og tags.
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_GB",
      url: SITE_URL,
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
    },
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    q?: string;
    category?: string;
    android?: string;
    sort?: string;
    source?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const filters = {
    // `q` is the older param name; keep reading it so existing links still work.
    search: params.search ?? params.q ?? "",
    category: normaliseCategory(params.category),
    android: normaliseAndroid(params.android),
    sort: normaliseSort(params.sort),
    source: normaliseSource(params.source),
  };
  // Only meaningful when a category is active — HomeSections ignores it
  // otherwise. Clamping against the category's real page count happens
  // there, where the category's app count is already being computed.
  const categoryPage = normalisePage(params.page);

  // Independent of categoryPage by construction — the same category browses
  // to the same breadcrumb/intro/listicle link on every page of its results.
  const intro = categoryIntro(filters.category);
  const listicle = categoryListicle(filters.category);

  // Real, dynamic count for the category hero below — getCatalogue() is
  // cache()-deduped against the identical call generateMetadata() already
  // made for this same request, so this costs nothing extra (no second
  // Supabase round trip). Only computed when a category is actually active;
  // the default homepage never touches this.
  const categoryCount = filters.category
    ? (await getCatalogue()).apps.filter((a) => a.category === filters.category).length
    : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      {filters.category && (
        <>
          <BreadcrumbJsonLd
            items={[
              { name: "Home", url: absolute("/") },
              { name: "Categories", url: absolute("/#categories") },
              {
                name: filters.category,
                url: absolute(`/?category=${encodeURIComponent(filters.category)}`),
              },
            ]}
          />
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-fg-dim sm:mb-5">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link href="/" className="hover:text-brand-400 hover:underline">
                  Home
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>
                <Link href="/#categories" className="hover:text-brand-400 hover:underline">
                  Categories
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="truncate font-medium text-fg">
                {filters.category}
              </li>
            </ol>
          </nav>
        </>
      )}

      {/* Static copy — paints immediately while the catalogue streams in.
          Soft mint hero panel: the homepage's primary visual anchor,
          holding the headline, the site's main search entry point and the
          trust row, all above the fold on a phone. */}
      <section className="relative overflow-hidden rounded-3xl border border-brand-500/15 bg-gradient-to-br from-brand-500/10 via-brand-500/5 to-transparent px-5 py-8 sm:px-8 sm:py-12 lg:px-12 lg:py-16">
        <div className="relative z-10 lg:grid lg:grid-cols-[1fr_auto] lg:items-center lg:gap-10">
          <div className="max-w-2xl">
            {filters.category && isCategory(filters.category) ? (
              // Category hero: icon tile beside the (unchanged-wording) H1
              // and a real, dynamic count pill — works for any of the 8
              // categories without hard-coding one, reading straight off
              // CATEGORY_TINTS/CategoryIcon and the count computed above.
              // The H1's own text is untouched from the default homepage's
              // category branch, just laid out next to the icon now.
              <div className="flex items-start gap-3.5 sm:gap-4">
                <span
                  className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl sm:h-16 sm:w-16 ${CATEGORY_TINTS[filters.category as Category].bg} ${CATEGORY_TINTS[filters.category as Category].text}`}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={CATEGORY_ICON_PATHS[filters.category as Category]} />
                  </svg>
                </span>
                <div className="min-w-0 pt-1">
                  <h1 className="text-2xl font-extrabold tracking-tight text-balance sm:text-3xl lg:text-4xl">
                    {filters.category} Apps —{" "}
                    <span className="bg-gradient-to-r from-brand-400 to-azure-400 bg-clip-text text-transparent">
                      Free and Open-Source
                    </span>
                  </h1>
                  <p className="mt-1.5 text-sm font-semibold text-brand-500 sm:text-base">
                    {categoryCount.toLocaleString()} App{categoryCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-300">
                  Free apps • Scanned or official
                </span>
                <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance sm:mt-5 sm:text-4xl lg:text-5xl">
                  Discover Better{" "}
                  <span className="bg-gradient-to-r from-brand-400 to-azure-400 bg-clip-text text-transparent">
                    Android Apps
                  </span>
                </h1>
              </>
            )}
            <p className="mt-2 text-sm font-medium text-fg-muted sm:text-base">
              Free • Safe • Open-Source Android Apps
            </p>
            <p className="mt-3 text-base leading-relaxed text-fg-muted sm:mt-4 sm:text-lg">
              {intro ??
                "Discover Android apps, games and tools with confidence. F-Droid builds are versioned, malware-scanned by file hash, and published with their full changelog — everything else links straight to its official source."}
            </p>
            {listicle && (
              <p className="mt-2 text-sm">
                <Link
                  href={`/blog/${listicle.slug}`}
                  className="font-medium text-brand-400 hover:underline"
                >
                  {listicle.anchorText}
                </Link>
              </p>
            )}

            {/* Same debounced /api/search logic and suggestions dropdown as
                the header's own search — just the homepage's larger visual
                scale (HeaderSearch's `size="large"`). */}
            <div className="mt-6 max-w-xl sm:mt-7">
              <HeaderSearch
                idPrefix="hero"
                placeholder="Search apps, games & tools…"
                size="large"
              />
            </div>

            <ul className="mt-5 grid grid-cols-3 gap-2 sm:mt-6 sm:gap-4">
              <TrustItem icon={<FreeIcon />} title="Free Apps" detail="Always free" />
              <TrustItem icon={<SafeIcon />} title="Safe Downloads" detail="Scanned or official" />
              <TrustItem icon={<BoltIcon />} title="No Registration" detail="Download instantly" />
            </ul>
          </div>

          {/* Decorative brand visual — reuses the existing logo mark rather
              than a new asset; hidden on the very narrowest phones so the
              headline/search stay the priority. */}
          <div className="mt-6 hidden justify-self-center sm:flex lg:mt-0">
            <div className="relative flex h-40 w-40 items-center justify-center lg:h-56 lg:w-56">
              <div
                className="absolute inset-0 rounded-full bg-brand-500/10 blur-2xl"
                aria-hidden="true"
              />
              <div
                className="absolute inset-6 rounded-full border border-brand-500/20"
                aria-hidden="true"
              />
              <LogoMark size={96} />
            </div>
          </div>
        </div>
      </section>

      {/* PREVIEW EXPERIMENT — Variant B early-preload investigation, not yet
          committed. A separate, minimal Suspense sibling positioned before
          HomeSections' own boundary — see components/catalogue/DeltaPreload.tsx. */}
      <Suspense fallback={null}>
        <DeltaPreload />
      </Suspense>

      <Suspense fallback={<HomeSkeleton />}>
        <HomeSections filters={filters} categoryPage={categoryPage} />
      </Suspense>
    </div>
  );
}

function TrustItem({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <li className="flex flex-col items-center gap-1.5 rounded-xl border border-brand-500/15 bg-base-900/60 px-2 py-3 text-center sm:flex-row sm:items-center sm:gap-2.5 sm:rounded-2xl sm:px-3 sm:py-2.5 sm:text-left">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-500">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] leading-tight font-semibold text-fg sm:text-xs">
          {title}
        </span>
        <span className="block truncate text-[10px] leading-tight text-fg-dim sm:text-xs">
          {detail}
        </span>
      </span>
    </li>
  );
}

function trustIconProps() {
  return {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function FreeIcon() {
  return (
    <svg {...trustIconProps()}>
      <path d="M7 3v6M4 6h6" />
      <rect x="4" y="12" width="16" height="9" rx="2" />
      <path d="M9 12v-1a3 3 0 0 1 6 0v1" />
    </svg>
  );
}

function SafeIcon() {
  return (
    <svg {...trustIconProps()}>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg {...trustIconProps()}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </svg>
  );
}

function HomeSkeleton() {
  return (
    <>
      <section className="mt-10 sm:mt-16">
        <SectionHeadingSkeleton />
        <div className="mt-5 sm:mt-6">
          <AppGridSkeleton
            count={5}
            className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-5"
          />
        </div>
      </section>

      <section className="mt-12 sm:mt-20">
        <SectionHeadingSkeleton />
        <div className="mt-5 sm:mt-6">
          <CategoryGridSkeleton />
        </div>
      </section>

      <section className="mt-12 sm:mt-20">
        <SectionHeadingSkeleton />
        <div className="mt-5 sm:mt-6">
          <AppGridSkeleton count={6} />
        </div>
      </section>

      <section className="mt-12 sm:mt-20">
        <SectionHeadingSkeleton />
        <div className="mt-5 sm:mt-6">
          <ListSkeleton />
        </div>
      </section>
    </>
  );
}
