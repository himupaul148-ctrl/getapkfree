/**
 * Where a listing's download actually comes from.
 *
 * `fdroid` apps link straight at F-Droid's repo, which is what the importer
 * produces and what the site has always done. `external` listings are hand-added
 * and redirect to whoever officially publishes the app — we never serve the
 * binary, and we never claim to have scanned it.
 */
export type SourceType = "fdroid" | "external";

/** The publishers we recognise well enough to name in the UI. */
export type Provider =
  | "play"
  | "fdroid"
  | "github"
  | "fdroid-repo"
  | "web";

type ProviderInfo = {
  /** Reads after "Download from …" / "Download via …". */
  label: string;
  /** Short word for the compact card badge. */
  short: string;
};

const PROVIDERS: Record<Provider, ProviderInfo> = {
  play: { label: "Google Play", short: "Google Play" },
  fdroid: { label: "F-Droid", short: "F-Droid" },
  "fdroid-repo": { label: "F-Droid", short: "F-Droid" },
  github: { label: "GitHub", short: "GitHub" },
  web: { label: "the developer", short: "Developer" },
};

/**
 * Host-based, because that is the part of a URL a publisher cannot fake by
 * choosing a path. Unknown hosts fall back to "the developer" rather than
 * guessing — a wrong provider name on a download button is worse than a vague
 * one.
 */
export function providerFromUrl(url: string | null): Provider {
  if (!url) return "web";

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "web";
  }

  if (host === "play.google.com") return "play";
  if (host === "f-droid.org" || host.endsWith(".f-droid.org")) return "fdroid";
  if (host === "github.com" || host === "api.github.com") return "github";
  return "web";
}

/**
 * The badge text. Hosted F-Droid builds read "via" because we link into the
 * repo we mirror metadata from; external ones read "from" because the click
 * leaves the site entirely.
 */
export function downloadSourceLabel(
  sourceType: SourceType,
  externalUrl: string | null,
): string {
  if (sourceType === "fdroid") return "Download via F-Droid";
  return `Download from ${PROVIDERS[providerFromUrl(externalUrl)].label}`;
}

export function sourceShortLabel(
  sourceType: SourceType,
  externalUrl: string | null,
): string {
  if (sourceType === "fdroid") return "F-Droid";
  return PROVIDERS[providerFromUrl(externalUrl)].short;
}

/** Domain shown under the download button so people see where they are going. */
export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
