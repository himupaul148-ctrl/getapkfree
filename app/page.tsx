import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";
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
import { absolute, categoryMetaDescription, SITE_DESCRIPTION } from "@/lib/seo";

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
    title: "GetApkFree — Free, Open-Source Android APK Downloads",
    description: SITE_DESCRIPTION,
    alternates: { canonical: absolute("/") },
    robots: { index: !filtered, follow: true },
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      {filters.category && (
        <BreadcrumbJsonLd
          items={[
            { name: "Home", url: absolute("/") },
            {
              name: filters.category,
              url: absolute(`/?category=${encodeURIComponent(filters.category)}`),
            },
          ]}
        />
      )}

      {/* Static copy — paints immediately while the catalogue streams in. */}
      <section className="max-w-3xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-300">
          Free apps • Scanned or official
        </span>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          {filters.category ? (
            <>
              {filters.category} Apps —{" "}
              <span className="bg-gradient-to-r from-brand-400 to-azure-400 bg-clip-text text-transparent">
                Free and Open-Source
              </span>
            </>
          ) : (
            <>
              Free, Open-Source Android Apps —{" "}
              <span className="bg-gradient-to-r from-brand-400 to-azure-400 bg-clip-text text-transparent">
                Scanned Builds, Official Sources
              </span>
            </>
          )}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-fg-muted">
          {intro ??
            "Download legitimate APKs with confidence. F-Droid builds are versioned, malware-scanned by file hash, and published with their full changelog — everything else links straight to its official source."}
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
      </section>

      <Suspense fallback={<HomeSkeleton />}>
        <HomeSections filters={filters} categoryPage={categoryPage} />
      </Suspense>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <>
      <section className="mt-16">
        <SectionHeadingSkeleton />
        <div className="mt-6">
          <AppGridSkeleton
            count={5}
            className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          />
        </div>
      </section>

      <section className="mt-20">
        <SectionHeadingSkeleton />
        <div className="mt-6">
          <CategoryGridSkeleton />
        </div>
      </section>

      <section className="mt-20">
        <SectionHeadingSkeleton />
        <div className="mt-6">
          <AppGridSkeleton count={6} />
        </div>
      </section>

      <section className="mt-20">
        <SectionHeadingSkeleton />
        <div className="mt-6">
          <ListSkeleton />
        </div>
      </section>
    </>
  );
}
