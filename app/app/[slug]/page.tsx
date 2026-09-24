import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AppCard from "@/components/AppCard";
import AppJsonLd from "@/components/AppJsonLd";
import AppIcon from "@/components/AppIcon";
import BreadcrumbJsonLd from "@/components/BreadcrumbJsonLd";
import FavoriteToggle from "@/components/FavoriteToggle";
import DownloadButton from "@/components/DownloadButton";
import { CategoryBadge } from "@/components/blog/BlogCard";
import { downloadSourceLabel, hostOf, safetyMethodologyPath } from "@/lib/sources";
import { categoryListicle } from "@/lib/category-content";
import { getBlogPostsForApp, getPrimaryBlogPostsForApp } from "@/lib/blog";
import PermissionsList from "@/components/PermissionsList";
import RatingStars from "@/components/RatingStars";
import ScanBadge from "@/components/ScanBadge";
import SourceBadge from "@/components/SourceBadge";
import ScreenshotGallery from "@/components/ScreenshotGallery";
import VersionHistory from "@/components/VersionHistory";
import {
  getAppBySlug,
  getPopularSlugs,
  getPublishedVersions,
  getRelatedApps,
} from "@/lib/catalogue";
import { formatBytes, formatCount, formatDate, formatRelative } from "@/lib/format";
import {
  absolute,
  appDescriptionSuffix,
  appSummarySentence,
  clampDescription,
  licenseAndTargetSdkLine,
  SITE_NAME,
} from "@/lib/seo";

// Rebuilt at most once an hour. App metadata changes rarely, so this serves
// from cache instead of hitting Supabase on every request, and gives the CDN
// an s-maxage header to work with.
export const revalidate = 3600;

type Props = { params: Promise<{ slug: string }> };

/**
 * Prerenders the most-downloaded pages at build time and, just as importantly,
 * puts the whole route into ISR mode — without this the segment renders fully
 * dynamic and Next sends "private, no-store", which no CDN will cache.
 *
 * The long tail is deliberately left out: unlisted slugs render on first
 * request and are cached from then on, with the same s-maxage header, so
 * covering all 300+ apps here would cost build time for no benefit.
 */
export async function generateStaticParams() {
  const slugs = await getPopularSlugs(50);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const app = await getAppBySlug(slug);
  if (!app) return { title: "App not found", robots: { index: false } };

  const versions = await getPublishedVersions(app.id);
  // No published build — never scanned/approved yet, or unpublished after
  // the fact (e.g. for a content-policy violation) — means there is nothing
  // public to show. 404 rather than rendering a thin placeholder page, so
  // this is never crawlable or linkable as a normal app listing; see the
  // matching guard in the page body below.
  if (versions.length === 0) notFound();

  const latest = versions[0];
  // "Latest" is the placeholder an external listing gets when its source does
  // not publish a version number — "Signal APK Latest" reads like a typo.
  const version =
    latest && latest.version_name !== "Latest" ? ` ${latest.version_name}` : "";

  // Front-load the app name and "APK": that is what people actually type.
  const title = `${app.name} APK${version} — Free Download`;

  const facts = [
    latest?.file_size ? formatBytes(latest.file_size) : null,
    latest?.min_android_version ? `Android ${latest.min_android_version}+` : null,
  ].filter(Boolean).join(" · ");

  const description = clampDescription(
    [app.description, facts && `(${facts})`, appDescriptionSuffix(app.source_type)]
      .filter(Boolean)
      .join(" "),
  );

  const url = absolute(`/app/${app.slug}`);

  return {
    title,
    description,
    alternates: { canonical: url },
    // `latest` is always defined here — the notFound() guard above already
    // returns before this point for any app with no published build, so
    // there is no "index: false" case left to reach.
    robots: latest ? undefined : { index: false, follow: true },
    openGraph: {
      type: "website",
      url,
      title: `${title} | ${SITE_NAME}`,
      description,
      images: app.icon_url ? [{ url: app.icon_url, alt: app.name }] : undefined,
    },
    twitter: {
      card: "summary",
      title: `${title} | ${SITE_NAME}`,
      description,
      images: app.icon_url ? [app.icon_url] : undefined,
    },
  };
}

export default async function AppDetailPage({ params }: Props) {
  const { slug } = await params;
  const app = await getAppBySlug(slug);
  if (!app) notFound();

  const [versions, related, primaryArticles, relatedArticlesRaw] = await Promise.all([
    getPublishedVersions(app.id),
    getRelatedApps(app.category, app.id, 4),
    getPrimaryBlogPostsForApp(app.id),
    getBlogPostsForApp(app.id),
  ]);

  // Deduplicate: a post that is already this app's primary App Related
  // article must never also appear in the generic Related Articles list —
  // both queries can legitimately return the same post (an app_related
  // article can also name its own target app in related_app_ids), so this
  // is decided here, by id, rather than assumed from query design alone.
  const primaryArticleIds = new Set(primaryArticles.map((article) => article.id));
  const articles = relatedArticlesRaw.filter((article) => !primaryArticleIds.has(article.id));

  // Same guard as generateMetadata above: no published build means nothing
  // public to show, so this 404s rather than rendering the page.
  if (versions.length === 0) notFound();

  const latest = versions[0];
  // Category editorial context, not build-specific — shown regardless of
  // whether this app has a published build, and regardless of source_type,
  // since the recommendation is about the category, not this app itself.
  const listicle = categoryListicle(app.category ?? "");
  // P2-1: shows only whichever of License/Target SDK is actually known for
  // the current (newest published) build — see lib/seo.ts for why this is a
  // separate line rather than a fifth cell in the facts grid below.
  const licenseAndSdk = licenseAndTargetSdkLine(app.license, latest?.target_sdk);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <AppJsonLd app={app} latest={latest} />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: absolute("/") },
          ...(app.category
            ? [
                {
                  name: app.category,
                  url: absolute(`/?category=${encodeURIComponent(app.category)}`),
                },
              ]
            : []),
          { name: app.name, url: absolute(`/app/${app.slug}`) },
        ]}
      />
      {/* Visible breadcrumb — mirrors the BreadcrumbJsonLd above exactly
          (Home / Category / App name), same nav markup as the homepage's own
          category breadcrumb and the blog article page's breadcrumb, so all
          three read as one consistent pattern. Supersedes the previous plain
          "← Back to catalogue" link. */}
      <nav aria-label="Breadcrumb" className="text-sm text-fg-dim">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-brand-400 hover:underline">
              Home
            </Link>
          </li>
          {app.category && (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link
                  href={`/?category=${encodeURIComponent(app.category)}`}
                  className="hover:text-brand-400 hover:underline"
                >
                  {app.category}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="max-w-[16rem] truncate font-medium text-fg sm:max-w-sm">
            {app.name}
          </li>
        </ol>
      </nav>

      {/* ---- App header ----
          Favourite toggle is two instances, not one repositioned by CSS:
          mobile gets the compact absolute-positioned icon (same corner
          treatment AppCard already uses everywhere else), so it reads as
          part of the icon/title block instead of sitting alone as its own
          full-width row below the badges. Desktop has the horizontal room
          for the labelled "button" variant to sit naturally at the end of
          the row instead. */}
      <header className="relative mt-5 flex flex-col gap-4 sm:mt-6 sm:flex-row sm:items-start sm:gap-5">
        <div className="sm:hidden">
          <FavoriteToggle appId={app.id} appName={app.name} />
        </div>

        <AppIcon src={app.icon_url} name={app.name} size={80} priority />

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-4xl">
            {app.name}
          </h1>
          <p className="mt-1 text-fg-muted">{app.developer_name}</p>
          {/* A technical implementation detail, not something a reader scans
              for — smaller and dimmer than the developer name above it
              rather than matching its weight. */}
          <p className="mt-1 font-mono text-xs break-all text-fg-dim">
            {app.package_name}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {app.category && (
              <Link
                href={`/?category=${encodeURIComponent(app.category)}#catalogue`}
                className="rounded-full border border-base-700 px-2.5 py-0.5 text-xs text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
              >
                {app.category}
              </Link>
            )}
            <SourceBadge
              sourceType={app.source_type}
              externalUrl={app.external_url}
            />
            <RatingStars rating={app.rating} count={app.rating_count} />
            <span className="text-sm text-azure-400">
              {formatCount(app.download_count ?? 0)} downloads
            </span>
          </div>
        </div>

        <div className="hidden sm:block">
          <FavoriteToggle appId={app.id} appName={app.name} variant="button" />
        </div>
      </header>

      {/* ---- Answer-first summary: one factual sentence a reader or search
          engine can quote without assembling it from the facts grid below. */}
      <p className="mt-5 max-w-2xl leading-relaxed text-fg-muted">
        {appSummarySentence({
          name: app.name,
          category: app.category,
          sourceType: app.source_type,
          version: latest?.version_name ?? null,
          fileSize: latest?.file_size ?? null,
          minAndroidVersion: latest?.min_android_version ?? null,
          developer: app.developer_name,
        })}
      </p>

      {/* ---- Quick info bar ---- */}
      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-base-800 bg-base-800 sm:grid-cols-4">
        <Fact label="Size" value={formatBytes(latest?.file_size ?? null)} />
        <Fact
          label="Requires"
          value={
            latest?.min_android_version
              ? `Android ${latest.min_android_version}+`
              : "Unknown"
          }
        />
        <Fact
          label="Last updated"
          value={latest ? formatRelative(latest.uploaded_at) : "—"}
          sub={latest ? formatDate(latest.uploaded_at) : undefined}
        />
        <div className="flex flex-col justify-center gap-1.5 bg-base-900 px-4 py-3.5">
          <dt className="text-xs text-fg-dim">Safety</dt>
          <dd className="flex flex-col items-start gap-1">
            <ScanBadge
              status={
                app.source_type === "external"
                  ? "external"
                  : (latest?.scan_status ?? null)
              }
              scannedAt={latest?.scanned_at ?? null}
            />
            <Link
              href={safetyMethodologyPath(app.source_type)}
              className="text-xs text-brand-400 hover:underline"
            >
              what does this mean?
            </Link>
          </dd>
        </div>
      </dl>

      {/* ---- License / Target SDK: optional, so a separate line rather than
          a fixed fifth grid cell — see lib/seo.ts's licenseAndTargetSdkLine.
          The "what does this mean?" link only appears when target SDK is
          actually part of the line, so it never dangles next to a license-only
          fact with nothing target-SDK-related to explain. ---- */}
      {licenseAndSdk && (
        <p className="mt-3 text-sm text-fg-dim">
          {licenseAndSdk}
          {typeof latest?.target_sdk === "number" && (
            <>
              {" — "}
              <Link
                href="/blog/how-to-check-apk-target-sdk-android"
                className="text-brand-400 hover:underline"
              >
                what does target SDK mean?
              </Link>
            </>
          )}
        </p>
      )}

      {/* ---- Primary download ----
          Placed directly under the quick-info bar rather than below the version
          history: it is the page's primary action and belongs above the fold. */}
      {latest ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <DownloadButton
            versionId={latest.id}
            versionName={latest.version_name}
            fileUrl={
              app.source_type === "external" ? app.external_url : latest.file_url
            }
            external={app.source_type === "external"}
            appName={app.name}
            appCategory={app.category}
          >
            {app.source_type === "external"
              ? downloadSourceLabel(app.source_type, app.external_url)
              : undefined}
          </DownloadButton>
          <span className="text-sm text-fg-dim sm:w-40">
            {app.source_type === "external" ? (
              // Naming the destination host is the honest version of an
              // outbound link: people should know they are leaving before
              // they click, not after.
              <>Opens {hostOf(app.external_url) ?? "the official page"}</>
            ) : (
              <>
                {formatBytes(latest.file_size)} · APK
              </>
            )}
          </span>
        </div>
      ) : (
        <p className="mt-6 rounded-2xl border border-base-800 bg-base-900 p-5 text-fg-muted">
          No builds have cleared scanning for this app yet, so there is nothing
          to download.
        </p>
      )}

      {app.source_type === "external" && (
        <p className="mt-3 rounded-xl border border-azure-500/25 bg-azure-500/5 p-4 text-sm leading-relaxed text-fg-muted">
          GetApkFree does not host this app. The button above takes you to{" "}
          <span className="font-medium text-azure-300">
            {hostOf(app.external_url) ?? "the publisher"}
          </span>
          , where the developer publishes it — so it is not one of the builds we
          scan ourselves.
        </p>
      )}

      {/* ---- Description ---- */}
      <section className="mt-8 sm:mt-10">
        <h2 className="text-lg font-bold tracking-tight">About this app</h2>
        <p className="mt-3 leading-relaxed text-fg-muted">{app.description}</p>
      </section>

      {/* ---- Screenshots ---- */}
      <ScreenshotGallery screenshots={app.screenshots ?? []} appName={app.name} />

      {/* ---- Permissions (collapsed) ---- */}
      <PermissionsList
        id="permissions"
        permissions={latest?.permissions ?? []}
        versionName={latest?.version_name ?? null}
      />

      {/* ---- Version history (collapsed) ---- */}
      <VersionHistory
        id="version-history"
        versions={versions}
        appName={app.name}
        appCategory={app.category}
      />

      <p className="mt-6 rounded-2xl border border-base-800 bg-base-900 p-5 text-sm text-fg-muted">
        New to sideloading?{" "}
        <Link href="/how-to-install" className="text-brand-400 hover:underline">
          Read the install guide
        </Link>{" "}
        before opening an APK.
        {latest && (
          <>
            {" "}Not sure this build supports your phone?{" "}
            <Link
              href="/blog/apk-minimum-android-version-how-to-check"
              className="text-brand-400 hover:underline"
            >
              See how to check your device&rsquo;s Android version
            </Link>
            .
          </>
        )}
      </p>

      {/* ---- Category listicle link: editorial context, kept as its own
          standalone paragraph rather than folded into the install-guide box
          above, since it's a discovery recommendation, not sideloading
          procedure. ---- */}
      {listicle && (
        <p className="mt-6 text-sm">
          <Link
            href={`/blog/${listicle.slug}`}
            className="font-medium text-brand-400 hover:underline"
          >
            {listicle.anchorText}
          </Link>
        </p>
      )}

      {/* ---- Related apps ---- */}
      {related.length > 0 && (
        <section className="mt-12 sm:mt-16">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            More in {app.category}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Other apps in this category, most downloaded first.
          </p>
          <div className="mt-5 grid gap-4 sm:mt-6 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
            {related.map((item) => (
              <AppCard key={item.id} app={item} />
            ))}
          </div>
        </section>
      )}

      {/* ---- Primary App Related articles: three-type blog system —
          getPrimaryBlogPostsForApp, lib/blog.ts. Posts whose article_type is
          app_related AND whose target_app_id is this exact app, i.e.
          content specifically about this app rather than content that
          merely mentions it. Deliberately its own, distinctly-headed
          section rather than folded into "Related articles" below, so a
          reader can tell "written about this app" apart from "mentions this
          app" at a glance. Renders only when at least one exists; no
          placeholder/empty state. ---- */}
      {primaryArticles.length > 0 && (
        <section className="mt-12 sm:mt-16">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            Guides &amp; Articles About This App
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Written specifically about {app.name}.
          </p>
          <ul className="mt-5 space-y-3 sm:mt-6">
            {primaryArticles.map((article) => (
              <li key={article.id}>
                <Link
                  href={`/blog/${article.slug}`}
                  className="block rounded-xl border border-base-800 bg-base-900 p-4 transition-colors hover:border-brand-500/50"
                >
                  <CategoryBadge category={article.category} />
                  <p className="mt-2 font-medium text-fg">{article.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Related articles: automatic App -> Blog reverse lookup
          (getBlogPostsForApp, lib/blog.ts) — every published post whose own
          related_app_ids names this app. Complements the Blog -> App
          direction already shown in each post's own sidebar. Renders only
          when a real published post names this app; no empty-state copy,
          no placeholder cards. Excludes (by id) anything already shown in
          the primary section above, via the `articles` dedup computed
          alongside the data fetch. ---- */}
      {articles.length > 0 && (
        <section className="mt-12 sm:mt-16">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            Related articles
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            Guides and articles that mention {app.name}.
          </p>
          <ul className="mt-5 space-y-3 sm:mt-6">
            {articles.map((article) => (
              <li key={article.id}>
                <Link
                  href={`/blog/${article.slug}`}
                  className="block rounded-xl border border-base-800 bg-base-900 p-4 transition-colors hover:border-brand-500/50"
                >
                  <CategoryBadge category={article.category} />
                  <p className="mt-2 font-medium text-fg">{article.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col justify-center gap-1 bg-base-900 px-4 py-3.5">
      <dt className="text-xs text-fg-dim">{label}</dt>
      <dd className="font-medium text-fg">
        {value}
        {sub && <span className="block text-xs font-normal text-fg-dim">{sub}</span>}
      </dd>
    </div>
  );
}
