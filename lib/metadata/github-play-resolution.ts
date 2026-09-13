/**
 * Step 3 of the Daily New-App Discovery system: EXTRACTION, kept strictly
 * separate from PLAY VERIFICATION (see the discovery audit's own three-
 * layer split — DISCOVERY / METADATA VERIFICATION / PUBLIC LISTING). This
 * module only ever searches text a GitHub discovery candidate
 * (lib/metadata/github-discovery.ts) already fetched — its homepage
 * field, README excerpt, and description — for a credible Google Play
 * link. It never makes a network request of its own, never contacts
 * Play, never contacts GitHub again, and never writes anywhere.
 *
 * The one place this module touches the network is
 * verifyResolvedPlayUrl() at the bottom — a thin, separate function that
 * a caller must invoke explicitly, and only ever with an already-resolved
 * URL. The pure extractor (resolvePlayLink()) never calls it.
 */
import { parsePlayUrl } from "./play-url.ts";
import type { GithubDiscoveryCandidate } from "./github-discovery.ts";
import type { FetchedMetadata } from "./fetchers.ts";

/* ------------------------------------------------------------------ input */

export type GithubCandidateContent = {
  /**
   * The candidate's own GitHub repo URL. Never scanned for a Play link —
   * a github.com URL cannot itself be one — kept only so a caller has
   * the full candidate context available without a second lookup.
   */
  repository_url: string;
  homepage_url: string | null;
  description: string | null;
  readme_excerpt: string | null;
};

/** Convenience mapper from a github-discovery.ts candidate — no new fields, just picks the ones this module reads. */
export function contentFromCandidate(
  candidate: Pick<GithubDiscoveryCandidate, "repository_url" | "homepage_url" | "description" | "readme_excerpt">,
): GithubCandidateContent {
  return {
    repository_url: candidate.repository_url,
    homepage_url: candidate.homepage_url,
    description: candidate.description,
    readme_excerpt: candidate.readme_excerpt,
  };
}

/* ------------------------------------------------------------- extraction */

type TextSource = "homepage" | "readme" | "description";

export type ExtractedPlayLink = {
  play_url: string;
  package_name: string;
  source: TextSource;
  confidence: "high" | "low";
  reason: string;
};

export type PlayResolutionResult =
  | { status: "resolved"; link: ExtractedPlayLink }
  | { status: "ambiguous"; candidates: ExtractedPlayLink[] }
  | { status: "invalid_play_link"; rawMatches: string[] }
  | { status: "no_play_link" };

/**
 * Loosely matches a Play *app-details* URL (must have a `?` query string —
 * a bare `/store/apps/details` or a generic `https://play.google.com`/
 * `/store` homepage never matches at all, so those are excluded from
 * consideration by construction, not by a later rejection rule). The
 * character class excludes whitespace and the punctuation that commonly
 * wraps a URL in markdown/HTML (`"`, `'`, `<`, `>`, `)`, `]`), so a
 * markdown link `[text](url)` or an HTML `href="url">` naturally isolates
 * just the URL without capturing the surrounding syntax.
 */
const PLAY_DETAILS_LOOSE_PATTERN = /https?:\/\/(?:www\.)?play\.google\.com\/store\/apps\/details\?[^\s"'<>)\]]+/gi;

/** Trailing characters that are never part of a real URL but commonly follow one in prose (end of sentence, markdown emphasis, code-span backtick). */
const TRAILING_PUNCTUATION = /[.,;:!?`*]+$/;

const TRUST_PHRASE = /download|google play/i;
const CONTEXT_WINDOW_BEFORE = 100;
const CONTEXT_WINDOW_AFTER = 40;

function findRawMatches(text: string): { rawUrl: string; index: number }[] {
  const matches: { rawUrl: string; index: number }[] = [];
  for (const m of text.matchAll(PLAY_DETAILS_LOOSE_PATTERN)) {
    const rawUrl = m[0].replace(TRAILING_PUNCTUATION, "");
    if (rawUrl.length > 0) matches.push({ rawUrl, index: m.index ?? 0 });
  }
  return matches;
}

function hasNearbyTrustPhrase(text: string, index: number): boolean {
  const window = text.slice(Math.max(0, index - CONTEXT_WINDOW_BEFORE), index + CONTEXT_WINDOW_AFTER);
  return TRUST_PHRASE.test(window);
}

/** Source priority used for ranking — a repo's own homepage field is the strongest signal a details URL is actually *this* project's listing. */
function sourceWeight(source: TextSource, confidence: "high" | "low"): number {
  if (source === "homepage") return 3;
  return confidence === "high" ? 2 : 1;
}

/**
 * Stable-sorts by descending credibility (Array.prototype.sort is a
 * stable sort per the ES2019 spec, so equal-weight entries keep their
 * original discovery order) — deterministic for the same input, verified
 * by a test that runs this twice and compares.
 */
function rankLinks(links: ExtractedPlayLink[]): ExtractedPlayLink[] {
  return [...links].sort((a, b) => sourceWeight(b.source, b.confidence) - sourceWeight(a.source, a.confidence));
}

/** Keeps only the highest-ranked occurrence of each distinct package_name. */
function dedupeByPackage(rankedLinks: ExtractedPlayLink[]): ExtractedPlayLink[] {
  const seen = new Set<string>();
  const result: ExtractedPlayLink[] = [];
  for (const link of rankedLinks) {
    if (seen.has(link.package_name)) continue;
    seen.add(link.package_name);
    result.push(link);
  }
  return result;
}

/**
 * The one extraction entry point. Searches ONLY the already-fetched
 * `content` fields — makes no network request of any kind. Every valid
 * Play URL found is validated through the existing parsePlayUrl() (never
 * a second, weaker copy of that logic), then ranked and deduplicated by
 * package name. Never picks arbitrarily between two *different* apps —
 * that case is reported as "ambiguous" rather than guessed at.
 */
export function resolvePlayLink(content: GithubCandidateContent): PlayResolutionResult {
  const sources: { source: TextSource; text: string | null }[] = [
    { source: "homepage", text: content.homepage_url },
    { source: "readme", text: content.readme_excerpt },
    { source: "description", text: content.description },
  ];

  const rawInvalid: string[] = [];
  const valid: ExtractedPlayLink[] = [];

  for (const { source, text } of sources) {
    if (!text) continue;
    for (const { rawUrl, index } of findRawMatches(text)) {
      const parsed = parsePlayUrl(rawUrl);
      if (!parsed.ok) {
        rawInvalid.push(rawUrl);
        continue;
      }
      const confidence: "high" | "low" = source === "homepage" || hasNearbyTrustPhrase(text, index) ? "high" : "low";
      const reason =
        source === "homepage"
          ? "the repository's own homepage field is this Play URL"
          : confidence === "high"
            ? `found near a "download"/"Google Play" phrase in the ${source}`
            : `found in the ${source} with no supporting context nearby`;
      valid.push({ play_url: parsed.url, package_name: parsed.packageName, source, confidence, reason });
    }
  }

  if (valid.length === 0) {
    if (rawInvalid.length > 0) {
      return { status: "invalid_play_link", rawMatches: [...new Set(rawInvalid)] };
    }
    return { status: "no_play_link" };
  }

  const deduped = dedupeByPackage(rankLinks(valid));

  if (deduped.length === 1) {
    return { status: "resolved", link: deduped[0] };
  }
  return { status: "ambiguous", candidates: deduped };
}

/* -------------------------------------------------------- Play verification */

/**
 * The same shape as lib/metadata/fetchers.ts's exported fetchMetadata() —
 * injected rather than imported directly, so this stays testable with a
 * fake and so this module never accidentally becomes a second caller of
 * the real network fetcher from anywhere but here.
 */
export type MetadataFetcher = (url: string) => Promise<FetchedMetadata>;

/**
 * PLAY VERIFICATION, deliberately never called by resolvePlayLink() above.
 * A caller must have an already-resolved (or explicitly chosen, in the
 * ambiguous case) Play URL before calling this — this function does not
 * decide which URL is credible, it only fetches what a URL already
 * decided to be credible actually says. Reuses the existing fetchMetadata()
 * dispatcher (lib/metadata/fetchers.ts), which itself calls fromPlay()
 * internally for any play.google.com URL — no new Play-fetching logic is
 * introduced here.
 */
export async function verifyResolvedPlayUrl(
  fetchMetadataFn: MetadataFetcher,
  playUrl: string,
): Promise<FetchedMetadata> {
  return fetchMetadataFn(playUrl);
}
