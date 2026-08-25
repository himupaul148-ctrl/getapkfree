export function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return "Unknown size";
  const mb = bytes / 1024 ** 2;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Compact download counts: 512400 -> "512.4K". */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function daysSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor(daysSince(iso));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Highest version_code wins; version_name strings are not reliably sortable. */
export function latestVersion<T extends { version_code: number }>(
  versions: T[] | null | undefined,
): T | undefined {
  if (!versions?.length) return undefined;
  return versions.reduce((a, b) => (b.version_code > a.version_code ? b : a));
}

/**
 * Trending is deliberately not the same list as "most downloaded": raw volume
 * is damped by how long it has been since the app last shipped a build, so an
 * actively maintained app outranks a dormant one with a bigger lifetime total.
 */
export function trendingScore(downloadCount: number, lastUpdated: string | null): number {
  return downloadCount / Math.max(daysSince(lastUpdated), 1) ** 0.5;
}

/** "9.0" -> 9. Used to compare an app's minimum against a chosen Android level. */
export function androidLevel(version: string | null): number {
  if (!version) return 0;
  const parsed = Number.parseFloat(version);
  return Number.isNaN(parsed) ? 0 : parsed;
}
