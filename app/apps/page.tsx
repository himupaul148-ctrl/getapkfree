import type { Metadata } from "next";
import Link from "next/link";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";
import { getCatalogue } from "@/lib/catalogue";
import { normalisePage } from "@/lib/blog";
import { absolute, SITE_NAME } from "@/lib/seo";

// getCatalogue() reads searchParams-free, but this route itself reads `page`,
// which makes it dynamic — the same trade-off the homepage and /blog already
// make. The query underneath stays unstable_cache'd for an hour regardless
// (see lib/catalogue.ts), so this costs nothing extra against Supabase.
export const dynamic = "force-dynamic";

// 48 rather than the homepage's 24: this route has no images, badges or
// interactive filtering per row, so a row costs far less to render, and a
// bigger page means fewer total pages to crawl at the current ~262-app scale.
const PAGE_SIZE = 48;

/**
 * Mirrors app/blog/page.tsx's own canonical/pagination pattern: page 1 is
 * canonical at the bare route (no `?page=1` — that would be a second URL for
 * the same content), every later page is self-canonical at its own `?page=N`.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const { apps } = await getCatalogue();

  const totalPages = Math.max(1, Math.ceil(apps.length / PAGE_SIZE));
  const page = Math.min(normalisePage(params.page), totalPages);

  const canonicalPath = page > 1 ? `/apps?page=${page}` : "/apps";
  const url = absolute(canonicalPath);

  const title =
    page > 1
      ? `All Apps — Page ${page} | ${SITE_NAME}`
      : "All Apps — Browse the Full APK Catalogue";
  const description =
    "Every app in the GetApkFree catalogue, one link per app. Free, open-source, malware-scanned Android APKs.";

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
  };
}

export default async function AppsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const { apps, error } = await getCatalogue();

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-5">
          <p className="font-semibold text-red-300">Could not reach Supabase</p>
          <p className="mt-1 font-mono text-sm text-red-400/90">{error}</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(apps.length / PAGE_SIZE));
  // Clamp rather than 404: a stale link to ?page=99 should still show something.
  const page = Math.min(normalisePage(params.page), totalPages);
  const start = (page - 1) * PAGE_SIZE;
  const pageApps = apps.slice(start, start + PAGE_SIZE);

  function pageHref(target: number): string {
    return target > 1 ? `/apps?page=${target}` : "/apps";
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: absolute("/") },
          { name: "Apps", url: absolute("/apps") },
        ]}
      />

      <header className="max-w-3xl">
        <p className="font-mono text-sm text-brand-400">GetApkFree Catalogue</p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
          All Apps
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fg-muted">
          Every app currently published on GetApkFree, {apps.length} in total.
          Looking to search or filter instead?{" "}
          <Link href="/#catalogue" className="text-brand-400 hover:underline">
            Use the homepage catalogue
          </Link>
          .
        </p>
      </header>

      {apps.length === 0 ? (
        <p className="mt-12 rounded-2xl border border-base-800 bg-base-900 p-10 text-center text-fg-muted">
          No apps published yet. Check back soon!
        </p>
      ) : (
        <>
          <p className="mt-8 text-sm text-fg-dim">
            Showing {start + 1}–{start + pageApps.length} of {apps.length} apps
          </p>

          <ul className="mt-5 divide-y divide-base-800 overflow-hidden rounded-2xl border border-base-800 bg-base-900">
            {pageApps.map((app) => (
              <li key={app.id}>
                <Link
                  href={`/app/${app.slug}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-base-850"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">
                    {app.name}
                  </span>
                  {app.category && (
                    <span className="text-sm text-fg-dim">{app.category}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <nav
              aria-label="Catalogue pages"
              className="mt-10 flex flex-wrap items-center justify-center gap-2"
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
        </>
      )}
    </div>
  );
}
