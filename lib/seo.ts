import { formatBytes } from "./format.ts";
import type { SourceType } from "@/lib/sources";

/**
 * One source of truth for the canonical origin.
 *
 * Set NEXT_PUBLIC_SITE_URL in Vercel when getapkfree.com goes live — canonical
 * URLs, Open Graph images and the sitemap all key off this, and pointing them
 * at the wrong host is the sort of thing nobody notices until search results
 * are already wrong.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://getapkfree.vercel.app"
).replace(/\/$/, "");

export const SITE_NAME = "GetApkFree";

/**
 * The sitewide/homepage default description — feeds the root layout's
 * fallback <meta name="description">/og:description/twitter:description
 * (app/layout.tsx) and the homepage's own (app/page.tsx), both of which wrap
 * it in clampDescription() before use, same as every other page's
 * description in this codebase. Kept naturally under clampDescription's
 * default 160-character max (currently well under, at 137) rather than
 * relying on that wrap to silently truncate it: a right-truncated ellipsis
 * is an acceptable fallback for content nobody wrote to length, not the
 * intended shape for the site's own primary description, which is short
 * enough by design to never need it.
 */
export const SITE_DESCRIPTION =
  "Free, open-source Android APKs. F-Droid builds are versioned and malware-scanned — everything else links straight to its official source.";

/** Absolute URL for a site-relative path. */
export function absolute(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Trim to a sensible meta-description length without cutting mid-word. */
export function clampDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The closing clause of an app detail page's meta description — what
 * GetApkFree actually did with this build, not a blanket claim repeated for
 * every listing.
 *
 * "Open-source" and "malware-scanned" are only true for the site's own
 * F-Droid builds. An external listing is neither: it is the vendor's own
 * proprietary app, and the page body already says outright that GetApkFree
 * "does not host this app" and it is "not one of the builds we scan
 * ourselves" (see app/app/[slug]/page.tsx). A meta description repeating the
 * F-Droid claim for one of these would contradict the page it sits on — and
 * be indexed as fact regardless.
 */
export function appDescriptionSuffix(sourceType: SourceType): string {
  return sourceType === "external"
    ? "Free download, linked to its official source."
    : "Free, open-source, malware-scanned.";
}

/**
 * A category page's meta description — deliberately the same wording for
 * every category rather than branching on that category's actual F-Droid/
 * external mix. Most categories contain both, so a claim like "every build
 * is malware-scanned" would be true for some listings in the category and
 * false for others depending on which category happened to be requested.
 * This sentence holds regardless of the mix (see appDescriptionSuffix above
 * for the equivalent per-app fix).
 */
export function categoryMetaDescription(category: string): string {
  return `Browse free, open-source Android ${category.toLowerCase()} apps. F-Droid builds are malware-scanned by file hash; official-source apps link straight to their publisher.`;
}

/**
 * A blog category page's meta description — one distinct, natural sentence
 * per category rather than a single reused template. A template risks the
 * one collision this file's blog copy already has to watch for: "guides" is
 * both a blog category (lib/blog-categories.ts) and the generic word the
 * blog listing's own base description already uses for its content ("Guides,
 * tips and app recommendations..." — see app/blog/page.tsx), so a template
 * like "${category} guides..." would read as "Guides guides..." for that one
 * category. Bespoke copy per category sidesteps that entirely.
 *
 * Takes a plain string, not BlogCategory, matching categoryMetaDescription's
 * own convention above: the caller (app/blog/page.tsx) already validates the
 * category against BLOG_CATEGORIES via getPublishedPostsPaged's internal
 * normaliseBlogCategory() before this is ever invoked, so the fallback below
 * is defensive only — reachable in practice only if that upstream validation
 * is ever removed.
 */
export function blogCategoryMetaDescription(category: string): string {
  const descriptions: Record<string, string> = {
    privacy:
      "Guides and recommendations on Android privacy and security — open-source apps, safer defaults, and what your permissions really mean.",
    productivity:
      "Guides and recommendations for staying productive on Android — open-source task managers, note apps, and workflow tools.",
    gaming:
      "Guides and recommendations for open-source and free Android games, tested by the GetApkFree team.",
    tools:
      "Guides and recommendations for open-source Android utilities — system tools, file managers, and more.",
    guides:
      "Step-by-step Android guides from the GetApkFree team — installing APKs, checking versions, and everyday troubleshooting.",
    news: "The latest open-source Android app news, releases, and updates from the GetApkFree team.",
  };
  return (
    descriptions[category] ??
    "Guides, tips and app recommendations from the GetApkFree team."
  );
}

function joinWithOxfordComma(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The data an app detail page has on hand to build its summary sentence from. */
export type AppSummaryFacts = {
  name: string;
  category: string | null;
  sourceType: SourceType;
  /** Latest published build's version_name, or null if there is none. */
  version: string | null;
  /** Latest published build's file_size in bytes, or null if unknown. */
  fileSize: number | null;
  /** Latest published build's min_android_version, or null if unknown. */
  minAndroidVersion: string | null;
  developer: string | null;
};

/**
 * A one- or two-sentence, answer-first summary placed right under an app
 * page's header — the single fact-dense passage a search or AI engine can
 * quote without having to assemble it from the page's fact grid. Built only
 * from fields the page already has; any field that is missing is dropped
 * rather than guessed.
 *
 * Mirrors appDescriptionSuffix's open-source claim: an external listing is a
 * vendor's own proprietary app that GetApkFree neither built nor scanned
 * (see the page's own disclosure), so it only ever gets "free", never
 * "open-source".
 *
 * "Latest" is the placeholder version_name an external listing gets when its
 * source does not publish a real version number (see generateMetadata in
 * app/app/[slug]/page.tsx) — treated the same as no version at all, since
 * stating it as a fact ("the latest version is Latest") would not be one.
 */
export function appSummarySentence(app: AppSummaryFacts): string {
  const kind = app.sourceType === "external" ? "free" : "free, open-source";
  const categoryWord = app.category ? ` ${app.category}` : "";
  const identity = `${app.name} is a ${kind} Android${categoryWord} app`;

  const hasRealVersion = Boolean(app.version) && app.version !== "Latest";
  const size = app.fileSize !== null ? formatBytes(app.fileSize) : null;

  const coreFacts = [
    hasRealVersion ? `the latest version is ${app.version}` : null,
    size ? `it is ${size}` : null,
    app.minAndroidVersion ? `requires Android ${app.minAndroidVersion}+` : null,
  ].filter((clause): clause is string => clause !== null);

  if (coreFacts.length === 0) {
    // No version/size/min-Android fact to anchor a second sentence — fold a
    // lone developer fact into the first sentence instead of producing an
    // orphan "Is published by X." with no stated subject.
    return app.developer
      ? `${identity}, published by ${app.developer}.`
      : `${identity}.`;
  }

  const allFacts = app.developer
    ? [...coreFacts, `is published by ${app.developer}`]
    : coreFacts;

  return `${identity}. ${capitalize(joinWithOxfordComma(allFacts))}.`;
}

/**
 * P2-1's small metadata line for the app detail page: "License: X · Target
 * SDK: Y", showing only whichever of the two facts is actually known, and
 * nothing at all when neither is. Deliberately separate from the facts grid
 * (Size/Requires/Last updated/Safety) rather than a fifth cell in it — both
 * facts are optional and the grid's cells currently are not, so folding
 * these in would mean inventing an "Unknown" fallback for facts that are
 * meant to stay invisible when absent.
 *
 * Target SDK is always the raw numeric Android API level (e.g. "35") — see
 * the P2-1 audit for why converting it to a release-name string like
 * min_android_version would be wrong: the Android ecosystem always refers to
 * target SDK by its raw API level, never a marketing version name.
 */
export function licenseAndTargetSdkLine(
  license: string | null | undefined,
  targetSdk: number | null | undefined,
): string | null {
  const hasLicense = typeof license === "string" && license.trim().length > 0;
  const hasTargetSdk = typeof targetSdk === "number" && Number.isFinite(targetSdk) && targetSdk > 0;

  const parts = [
    hasLicense ? `License: ${(license as string).trim()}` : null,
    hasTargetSdk ? `Target SDK: ${targetSdk}` : null,
  ].filter((clause): clause is string => clause !== null);

  return parts.length ? parts.join(" · ") : null;
}
