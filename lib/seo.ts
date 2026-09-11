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

export const SITE_DESCRIPTION =
  "Download free, open-source Android APKs with confidence. Every build is versioned, malware-scanned, and published with its full changelog.";

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
