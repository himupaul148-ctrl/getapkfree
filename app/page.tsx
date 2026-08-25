import { Suspense } from "react";
import HomeSections from "@/components/HomeSections";
import {
  AppGridSkeleton,
  CategoryGridSkeleton,
  ListSkeleton,
  SectionHeadingSkeleton,
} from "@/components/Skeletons";
import {
  normaliseAndroid,
  normaliseCategory,
  normaliseSort,
} from "@/lib/filters";

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
  const filters = {
    // `q` is the older param name; keep reading it so existing links still work.
    search: params.search ?? params.q ?? "",
    category: normaliseCategory(params.category),
    android: normaliseAndroid(params.android),
    sort: normaliseSort(params.sort),
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      {/* Static copy — paints immediately while the catalogue streams in. */}
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

      <Suspense fallback={<HomeSkeleton />}>
        <HomeSections filters={filters} />
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
