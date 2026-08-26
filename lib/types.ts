import type { SourceType } from "@/lib/sources";

/** "external" means we did not scan it — the official publisher serves it. */
export type ScanStatus =
  | "pending"
  | "clean"
  | "flagged"
  | "failed"
  | "external";

export type App = {
  id: string;
  name: string;
  slug: string;
  package_name: string;
  category: string | null;
  description: string | null;
  icon_url: string | null;
  developer_name: string | null;
  download_count: number;
  created_at: string;
  screenshots: string[];
  rating: number | null;
  rating_count: number;
  source_type: SourceType;
  external_url: string | null;
  hosted_locally: boolean;
};

export type Version = {
  id: string;
  app_id: string;
  version_name: string;
  version_code: number;
  file_url: string | null;
  file_size: number | null;
  min_android_version: string | null;
  changelog: string | null;
  scan_status: ScanStatus;
  published: boolean;
  uploaded_at: string;
  scanned_at: string | null;
  permissions: string[];
};

/** The version fields the catalogue needs in order to summarise an app. */
export type VersionSummary = Pick<
  Version,
  | "version_name"
  | "version_code"
  | "file_size"
  | "min_android_version"
  | "uploaded_at"
  | "scanned_at"
  | "scan_status"
>;

export type AppWithVersions = App & { versions: VersionSummary[] };

/**
 * One app flattened against its newest published build. Derived on the server
 * so the client components filter over a small, already-shaped list.
 */
export type AppSummary = {
  id: string;
  name: string;
  slug: string;
  packageName: string;
  category: string | null;
  description: string | null;
  iconUrl: string | null;
  developer: string | null;
  downloadCount: number;
  createdAt: string;
  latestVersion: string | null;
  fileSize: number | null;
  minAndroid: string | null;
  lastUpdated: string | null;
  scannedAt: string | null;
  scanStatus: ScanStatus | null;
  rating: number | null;
  ratingCount: number;
  sourceType: SourceType;
  externalUrl: string | null;
  hostedLocally: boolean;
};

export const SORT_OPTIONS = [
  "trending",
  "newest",
  "downloads",
  "rating",
  "updated",
] as const;
export type SortKey = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  trending: "Trending",
  newest: "Newest",
  downloads: "Most downloaded",
  rating: "Highest rated",
  updated: "Recently updated",
};

/**
 * Fixed ladder rather than whatever the catalogue happens to contain, so the
 * options do not shift as apps are added. Picking a level means "my device runs
 * this", so it shows apps whose minimum is at or below it.
 */
export const ANDROID_LEVELS = ["8.0", "9.0", "10.0", "11.0", "12.0"] as const;

/**
 * Source filter. "all" is the default because the catalogue is meant to read
 * as one list; the other two exist for people who specifically want builds we
 * link from F-Droid, or specifically want official-store listings.
 */
export const SOURCE_FILTERS = ["all", "fdroid", "external"] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];

export const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = {
  all: "All sources",
  fdroid: "F-Droid only",
  external: "Official stores only",
};

/** The eight categories the site is organised around. */
export const CATEGORIES = [
  "Tools",
  "Games",
  "Productivity",
  "Multimedia",
  "Internet",
  "System",
  "Education",
  "Writing",
] as const;
