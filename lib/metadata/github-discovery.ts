/**
 * Step 2 of the Daily New-App Discovery system's DISCOVERY layer (see the
 * discovery audit's own design, and 20260915000000_play_discovery_candidates.sql's
 * doc comment). This module only ever answers "what Android-shaped GitHub
 * repositories exist" — it never writes to Supabase, never calls Play, and
 * never decides an app is real. That is METADATA VERIFICATION's job (the
 * existing, unmodified fromPlay()/classifyProposal() in
 * lib/metadata/play-proposals.ts), performed by a later step against
 * whatever candidates this module returns. This module doesn't even
 * attempt to extract a Play URL from a candidate's text — that extraction
 * is explicitly a separate, later step; this module only carries the raw
 * text (README excerpt, homepage, description) that step will need.
 *
 * Uses ONLY the official GitHub REST Search API
 * (https://docs.github.com/en/rest/search) — no HTML scraping of
 * github.com, mirroring lib/metadata/fetchers.ts's fromGithub()'s own
 * "REST API, not the rendered page" choice, for the same reason: it's the
 * documented, stable, ToS-compliant surface.
 *
 * Every network call goes through an injected fetch-like function
 * (GithubFetchFn), never a bare global `fetch` — so every test in
 * github-discovery.test.ts runs against fixtures, with no real network
 * call, exactly like lib/metadata/play-watchlist-runner.ts's own
 * injected-fetchMetadata pattern.
 */

export const GITHUB_SOURCE = "github" as const;

/* ------------------------------------------------------------ candidate */

export type GithubDiscoveryCandidate = {
  source: "github";
  /** "owner/repo" — the one field the UNIQUE(source, source_ref) constraint on play_discovery_candidates actually dedupes against. */
  source_ref: string;
  candidate_name: string;
  repository_url: string;
  homepage_url: string | null;
  description: string | null;
  stars: number;
  watchers: number;
  license_spdx: string | null;
  created_at: string;
  updated_at: string;
  default_branch: string;
  /** True only once a real, dated release was actually found via the releases API — never inferred. */
  has_dated_release: boolean;
  /** Raw text, kept only so a later, separate step can search it for a play.google.com link. Never parsed or interpreted here. */
  readme_excerpt: string | null;
  /** Carried through purely for the not-a-library/template heuristic and for future reference — never itself a hard filter input beyond that. */
  topics: string[];
  is_fork: boolean;
  is_archived: boolean;
  is_template: boolean;
};

/** The subset of a GitHub Search API repository item this module actually reads. Untyped fields from the real response are ignored, not modelled. */
export type RawGithubSearchItem = {
  full_name?: unknown;
  html_url?: unknown;
  description?: unknown;
  homepage?: unknown;
  stargazers_count?: unknown;
  watchers_count?: unknown;
  license?: { spdx_id?: unknown } | null;
  created_at?: unknown;
  updated_at?: unknown;
  default_branch?: unknown;
  topics?: unknown;
  fork?: unknown;
  archived?: unknown;
  is_template?: unknown;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function bool(value: unknown): boolean {
  return value === true;
}

/**
 * Maps one raw GitHub Search API item into a candidate — pure, no
 * network. `has_dated_release`/`readme_excerpt` are supplied separately
 * (see fetchLatestReleaseDate()/fetchReadmeExcerpt() below) since the
 * search endpoint itself carries neither.
 */
export function mapSearchItemToCandidate(
  item: RawGithubSearchItem,
  extra: { hasDatedRelease: boolean; readmeExcerpt: string | null },
): GithubDiscoveryCandidate | null {
  const fullName = str(item.full_name);
  const htmlUrl = str(item.html_url);
  if (!fullName || !htmlUrl) return null;

  const topicsRaw = item.topics;
  const topics = Array.isArray(topicsRaw) ? topicsRaw.filter((t): t is string => typeof t === "string") : [];

  return {
    source: GITHUB_SOURCE,
    source_ref: fullName,
    candidate_name: fullName,
    repository_url: htmlUrl,
    homepage_url: str(item.homepage),
    description: str(item.description),
    stars: num(item.stargazers_count),
    watchers: num(item.watchers_count),
    license_spdx: str(item.license?.spdx_id),
    created_at: str(item.created_at) ?? "",
    updated_at: str(item.updated_at) ?? "",
    default_branch: str(item.default_branch) ?? "main",
    has_dated_release: extra.hasDatedRelease,
    readme_excerpt: extra.readmeExcerpt,
    topics,
    is_fork: bool(item.fork),
    is_archived: bool(item.archived),
    is_template: bool(item.is_template),
  };
}

/* --------------------------------------------------------------- search query */

export type GithubSearchConfig = {
  /**
   * The date/datetime boundary candidates must have been pushed since —
   * required, and always supplied by the caller. Never computed as
   * "today" inside this module, so a test (or a real caller) fully
   * controls what "recent" means.
   */
  since: string;
  /** Defaults to "android" — the one keyword the search targets. */
  keyword?: string;
  /** Extra raw qualifiers appended verbatim (e.g. "language:kotlin"). */
  extraQualifiers?: string[];
};

/**
 * Builds the GitHub Search API query string. Filters on `pushed:>=since`
 * (GitHub's own proxy for "still active/updated recently") — matchesDateWindow()
 * below independently re-checks both created_at and updated_at against the
 * same boundary once a real item is in hand, so a repository is never
 * accepted purely because the server-side query happened to include it.
 */
export function buildSearchQuery(config: GithubSearchConfig): string {
  const keyword = config.keyword ?? "android";
  const parts = [keyword, `pushed:>=${config.since}`, ...(config.extraQualifiers ?? [])];
  return parts.join(" ");
}

/** True if a candidate's created_at OR updated_at is on/after `since` — the actual date-window enforcement, independent of the search query's own qualifier. */
export function matchesDateWindow(
  candidate: Pick<GithubDiscoveryCandidate, "created_at" | "updated_at">,
  since: string,
): boolean {
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return false;
  const createdMs = Date.parse(candidate.created_at);
  const updatedMs = Date.parse(candidate.updated_at);
  return (Number.isFinite(createdMs) && createdMs >= sinceMs) || (Number.isFinite(updatedMs) && updatedMs >= sinceMs);
}

/* ---------------------------------------------------------- deduplication */

/** Deduplicates by source+source_ref, keeping the first occurrence — the same identity the UNIQUE(source, source_ref) constraint on play_discovery_candidates enforces. */
export function deduplicateCandidates<T extends { source: string; source_ref: string }>(candidates: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const c of candidates) {
    const key = `${c.source}:${c.source_ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}

/* -------------------------------------------------------------- hard filters */

export type HardFilterThresholds = {
  minStars: number;
  minWatchers: number;
  /** A higher star bar used as the "strong evidence of a real release" fallback when no dated release exists. */
  strongEvidenceStars: number;
};

export const DEFAULT_HARD_FILTER_THRESHOLDS: HardFilterThresholds = {
  minStars: 5,
  minWatchers: 1,
  strongEvidenceStars: 50,
};

/** Not a hard rejection by itself — only used to skip wasted README/release requests before those extra calls are made. Kept separate from LIBRARY_KEYWORDS so "cheap" and "authoritative" checks can't silently drift apart. */
const ANDROID_KEYWORD = /android/i;

/** Repos that are clearly not a shippable app, regardless of how "Android" they otherwise look. */
const LIBRARY_KEYWORDS =
  /\b(library|libraries|framework|sdk|toolkit|template|boilerplate|sample|samples|example|examples|tutorial|starter|awesome[- ]|cheatsheet|snippets?)\b/i;

function candidateText(candidate: Pick<GithubDiscoveryCandidate, "candidate_name" | "description" | "topics">): string {
  return [candidate.candidate_name, candidate.description ?? "", ...candidate.topics].join(" ");
}

/** Cheap, pre-network-call filters — evaluated on the raw search item alone, before any README/releases request is made, so obviously-disqualified items never cost extra API calls. */
export function passesCheapFilters(
  candidate: Pick<
    GithubDiscoveryCandidate,
    "candidate_name" | "description" | "topics" | "stars" | "watchers" | "license_spdx" | "is_fork" | "is_archived" | "is_template"
  >,
  thresholds: HardFilterThresholds = DEFAULT_HARD_FILTER_THRESHOLDS,
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const text = candidateText(candidate);

  if (candidate.is_fork) reasons.push("is a fork");
  if (candidate.is_archived) reasons.push("is archived");
  if (candidate.is_template) reasons.push("is a template repository");
  if (!ANDROID_KEYWORD.test(text)) reasons.push("not plausibly an Android project");
  if (LIBRARY_KEYWORD_MATCH(text)) reasons.push("looks like a library/framework/SDK/template/sample/tutorial, not a shippable app");
  if (!candidate.license_spdx) reasons.push("no real license");
  if (candidate.stars < thresholds.minStars && candidate.watchers < thresholds.minWatchers) {
    reasons.push(`star/watch signal too low (stars=${candidate.stars}, watchers=${candidate.watchers})`);
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

function LIBRARY_KEYWORD_MATCH(text: string): boolean {
  return LIBRARY_KEYWORDS.test(text);
}

export type HardFilterResult = { ok: true } | { ok: false; reasons: string[] };

/**
 * The full, authoritative hard-filter check — run once a candidate's
 * has_dated_release/readme_excerpt are known. Re-runs every cheap check
 * too (a candidate is never allowed to reach this point having failed
 * one), then adds the two checks that need real data: a dated release (or
 * the strong-evidence star fallback), and having *some* text a later step
 * could search for a Play URL. Every failing reason is collected — never
 * just the first — so a caller can report exactly why a candidate was
 * rejected. This function decides eligibility on its own; the advisory
 * score in scoreCandidate() below is never consulted here and can never
 * override what this function decides.
 */
export function evaluateHardFilters(
  candidate: GithubDiscoveryCandidate,
  thresholds: HardFilterThresholds = DEFAULT_HARD_FILTER_THRESHOLDS,
): HardFilterResult {
  const cheap = passesCheapFilters(candidate, thresholds);
  const reasons: string[] = cheap.ok ? [] : [...cheap.reasons];

  const hasStrongReleaseEvidence = candidate.has_dated_release || candidate.stars >= thresholds.strongEvidenceStars;
  if (!hasStrongReleaseEvidence) {
    reasons.push("no dated release and no strong evidence of a real release (insufficient stars)");
  }

  const hasExtractableText = Boolean(candidate.homepage_url || candidate.description || candidate.readme_excerpt);
  if (!hasExtractableText) {
    reasons.push("no homepage, description, or README text available for later Play URL extraction");
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

/* -------------------------------------------------------------------- scoring */

export type ScoringWeights = {
  stars: number;
  recency: number;
  readme: number;
  homepage: number;
  release: number;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  stars: 40,
  recency: 30,
  readme: 10,
  homepage: 10,
  release: 10,
};

/**
 * Advisory ranking only — used to order same-day candidates, never to
 * decide eligibility (evaluateHardFilters() above is the only thing that
 * decides that, and this function is never given the power to override
 * it). `now` is a parameter, never `new Date()` internally, so recency
 * scoring is fully deterministic under test.
 */
export function scoreCandidate(
  candidate: GithubDiscoveryCandidate,
  now: Date,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  const starScore = Math.min(1, Math.log10(candidate.stars + 1) / 3) * weights.stars;

  const updatedMs = Date.parse(candidate.updated_at);
  const ageDays = Number.isFinite(updatedMs) ? Math.max(0, (now.getTime() - updatedMs) / 86_400_000) : Infinity;
  const recencyScore = Math.max(0, 1 - ageDays / 30) * weights.recency;

  const readmeScore = candidate.readme_excerpt ? weights.readme : 0;
  const homepageScore = candidate.homepage_url ? weights.homepage : 0;
  const releaseScore = candidate.has_dated_release ? weights.release : 0;

  return Math.round((starScore + recencyScore + readmeScore + homepageScore + releaseScore) * 100) / 100;
}

/* ---------------------------------------------------------------- HTTP layer */

export type GithubFetchResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
};

/** Every network call in this module goes through exactly this shape — never a bare global `fetch`. */
export type GithubFetchFn = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<GithubFetchResponse>;

export type DiscoveryError =
  | { kind: "rate_limited"; message: string }
  | { kind: "http_error"; status: number; message: string }
  | { kind: "malformed_response"; message: string }
  | { kind: "network_error"; message: string };

export type DiscoveryResult<T> = { ok: true; value: T } | { ok: false; error: DiscoveryError };

function isRateLimited(response: GithubFetchResponse, body: unknown): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  const message = typeof body === "object" && body !== null ? (body as Record<string, unknown>).message : undefined;
  return typeof message === "string" && /rate limit/i.test(message);
}

async function requestJson(fetchFn: GithubFetchFn, url: string, headers?: Record<string, string>): Promise<DiscoveryResult<unknown>> {
  let response: GithubFetchResponse;
  try {
    response = await fetchFn(url, headers ? { headers } : undefined);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { ok: false, error: { kind: "network_error", message } };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { ok: false, error: { kind: "malformed_response", message: `could not parse JSON: ${message}` } };
  }

  if (isRateLimited(response, body)) {
    const message = typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).message === "string"
      ? ((body as Record<string, unknown>).message as string)
      : "GitHub API rate limit exceeded.";
    return { ok: false, error: { kind: "rate_limited", message } };
  }

  if (!response.ok) {
    const message = typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).message === "string"
      ? ((body as Record<string, unknown>).message as string)
      : `GitHub API returned ${response.status}.`;
    return { ok: false, error: { kind: "http_error", status: response.status, message } };
  }

  return { ok: true, value: body };
}

/** GET /search/repositories?q=...&page=N — returns the raw items array, or a structured error. Never throws. */
export async function fetchSearchPage(
  fetchFn: GithubFetchFn,
  query: string,
  page: number,
  perPage: number,
  headers?: Record<string, string>,
): Promise<DiscoveryResult<RawGithubSearchItem[]>> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&sort=updated&order=desc`;
  const result = await requestJson(fetchFn, url, headers);
  if (!result.ok) return result;

  const body = result.value;
  const items = typeof body === "object" && body !== null ? (body as Record<string, unknown>).items : undefined;
  if (!Array.isArray(items)) {
    return { ok: false, error: { kind: "malformed_response", message: "search response has no `items` array" } };
  }
  return { ok: true, value: items as RawGithubSearchItem[] };
}

/** GET /repos/{owner}/{repo}/releases?per_page=1 — true only if at least one release exists with a real published_at. Never throws; a fetch failure here is reported as a DiscoveryError, never silently treated as "no release". */
export async function fetchLatestReleaseDate(
  fetchFn: GithubFetchFn,
  ownerRepo: string,
  headers?: Record<string, string>,
): Promise<DiscoveryResult<boolean>> {
  const url = `https://api.github.com/repos/${ownerRepo}/releases?per_page=1`;
  const result = await requestJson(fetchFn, url, headers);
  if (!result.ok) return result;

  const releases = result.value;
  if (!Array.isArray(releases)) {
    return { ok: false, error: { kind: "malformed_response", message: "releases response is not an array" } };
  }
  const hasDatedRelease = releases.some(
    (r) => typeof r === "object" && r !== null && typeof (r as Record<string, unknown>).published_at === "string",
  );
  return { ok: true, value: hasDatedRelease };
}

const APK_CONTENT_TYPE = "application/vnd.android.package-archive";

/** One asset attached to a GitHub Release. Only the fields the APK-enrichment importer actually needs. */
export type GithubReleaseAsset = {
  name: string;
  browserDownloadUrl: string;
  contentType: string | null;
  size: number;
};

/** null means the repository has no release at all — a normal, non-error outcome, never treated as a failure. */
export type GithubLatestRelease = { tagName: string; assets: GithubReleaseAsset[] } | null;

/**
 * An asset counts as an APK if GitHub recorded the correct content type, OR
 * (fallback, since some release pipelines upload with a generic
 * application/octet-stream content type) its filename ends in ".apk".
 * Deliberately narrow: an arbitrary ZIP or source-archive asset must never
 * be treated as an APK just because it sits in the same release.
 */
export function isApkAsset(asset: Pick<GithubReleaseAsset, "name" | "contentType">): boolean {
  if (asset.contentType === APK_CONTENT_TYPE) return true;
  return asset.name.toLowerCase().endsWith(".apk");
}

/** Filters a release's assets down to the ones that look like an APK. Order is preserved from the release response. */
export function findApkAssets(assets: GithubReleaseAsset[]): GithubReleaseAsset[] {
  return assets.filter(isApkAsset);
}

/**
 * GET /repos/{owner}/{repo}/releases/latest — the one call the GitHub APK
 * enrichment importer (lib/apk/github-release-import.ts) needs to discover
 * a real, first-party release APK. Deliberately a new, separate function
 * rather than a change to fetchLatestReleaseDate() above: that function's
 * contract (a boolean, used only for the discovery hard-filter) already has
 * a caller and a passing test suite, and callers that only need "does a
 * dated release exist" have no reason to pay for parsing an assets array
 * they'll never look at.
 *
 * A repository with no releases at all makes /releases/latest itself 404 —
 * that is reported as `{ ok: true, value: null }`, a normal "no release"
 * result, never a DiscoveryError. Every other non-2xx status, a malformed
 * body, or a network failure still goes through the same DiscoveryError
 * channel as every other function in this module.
 */
export async function fetchLatestReleaseAssets(
  fetchFn: GithubFetchFn,
  ownerRepo: string,
  headers?: Record<string, string>,
): Promise<DiscoveryResult<GithubLatestRelease>> {
  const url = `https://api.github.com/repos/${ownerRepo}/releases/latest`;
  const result = await requestJson(fetchFn, url, headers);
  if (!result.ok) {
    if (result.error.kind === "http_error" && result.error.status === 404) {
      return { ok: true, value: null };
    }
    return result;
  }

  const body = result.value;
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: { kind: "malformed_response", message: "release response is not an object" } };
  }
  const record = body as Record<string, unknown>;
  const rawAssets = record.assets;
  if (!Array.isArray(rawAssets)) {
    return { ok: false, error: { kind: "malformed_response", message: "release response has no `assets` array" } };
  }

  const assets: GithubReleaseAsset[] = rawAssets
    .map((raw): GithubReleaseAsset | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const r = raw as Record<string, unknown>;
      const name = str(r.name);
      const downloadUrl = str(r.browser_download_url);
      if (!name || !downloadUrl) return null;
      return { name, browserDownloadUrl: downloadUrl, contentType: str(r.content_type), size: num(r.size) };
    })
    .filter((a): a is GithubReleaseAsset => a !== null);

  return { ok: true, value: { tagName: str(record.tag_name) ?? "", assets } };
}

/** GET /repos/{owner}/{repo}/readme — base64-decoded to plain text, truncated. Kept only as raw text for a later, separate Play-URL-extraction step; never parsed here. */
export async function fetchReadmeExcerpt(
  fetchFn: GithubFetchFn,
  ownerRepo: string,
  headers?: Record<string, string>,
  maxChars = 4000,
): Promise<DiscoveryResult<string | null>> {
  const url = `https://api.github.com/repos/${ownerRepo}/readme`;
  const result = await requestJson(fetchFn, url, headers);
  if (!result.ok) {
    // A repo with no README returns 404 from GitHub — that's a normal,
    // expected absence, not a discovery-pipeline failure.
    if (result.error.kind === "http_error" && result.error.status === 404) return { ok: true, value: null };
    return result;
  }

  const body = result.value;
  const content = typeof body === "object" && body !== null ? (body as Record<string, unknown>).content : undefined;
  const encoding = typeof body === "object" && body !== null ? (body as Record<string, unknown>).encoding : undefined;
  if (typeof content !== "string" || encoding !== "base64") {
    return { ok: false, error: { kind: "malformed_response", message: "readme response missing base64 content" } };
  }

  try {
    const decoded = Buffer.from(content, "base64").toString("utf8");
    return { ok: true, value: decoded.slice(0, maxChars) };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { ok: false, error: { kind: "malformed_response", message: `could not decode README content: ${message}` } };
  }
}

/* ------------------------------------------------------------- orchestration */

export type DiscoverGithubCandidatesConfig = {
  fetchFn: GithubFetchFn;
  since: string;
  now: Date;
  maxResults: number;
  maxPages?: number;
  perPage?: number;
  keyword?: string;
  extraQualifiers?: string[];
  headers?: Record<string, string>;
  thresholds?: HardFilterThresholds;
  weights?: ScoringWeights;
};

export type DiscoverGithubCandidatesReport = {
  candidates: (GithubDiscoveryCandidate & { score: number })[];
  rejected: { source_ref: string; reasons: string[] }[];
  errors: DiscoveryError[];
  pagesFetched: number;
};

/**
 * The one orchestration entry point: paginates the Search API
 * sequentially (never in parallel — see the module doc comment), applies
 * the cheap filters before spending any extra request on a candidate,
 * fetches release/README data only for cheap-filter survivors, applies
 * the full hard-filter check, scores and deduplicates survivors, and
 * stops once `maxResults` real candidates have been collected or
 * `maxPages` is exhausted — whichever comes first, so this can never
 * become an unbounded crawl. Every error (rate limit, HTTP error,
 * malformed response, network failure) is collected in `errors` rather
 * than silently turning into an empty, successful-looking result.
 */
export async function discoverGithubCandidates(
  config: DiscoverGithubCandidatesConfig,
): Promise<DiscoverGithubCandidatesReport> {
  const perPage = config.perPage ?? 30;
  const maxPages = config.maxPages ?? 3;
  const thresholds = config.thresholds ?? DEFAULT_HARD_FILTER_THRESHOLDS;
  const weights = config.weights ?? DEFAULT_SCORING_WEIGHTS;
  const query = buildSearchQuery({ since: config.since, keyword: config.keyword, extraQualifiers: config.extraQualifiers });

  const rawCandidates: (GithubDiscoveryCandidate & { score: number })[] = [];
  const rejected: { source_ref: string; reasons: string[] }[] = [];
  const errors: DiscoveryError[] = [];
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages && rawCandidates.length < config.maxResults; page++) {
    const pageResult = await fetchSearchPage(config.fetchFn, query, page, perPage, config.headers);
    pagesFetched++;
    if (!pageResult.ok) {
      errors.push(pageResult.error);
      break;
    }
    const items = pageResult.value;
    if (items.length === 0) break;

    for (const item of items) {
      if (rawCandidates.length >= config.maxResults) break;

      const fullName = str(item.full_name);
      if (!fullName) continue;

      const partial = mapSearchItemToCandidate(item, { hasDatedRelease: false, readmeExcerpt: null });
      if (!partial) continue;

      if (!matchesDateWindow(partial, config.since)) {
        rejected.push({ source_ref: fullName, reasons: ["outside the requested date window"] });
        continue;
      }

      const cheap = passesCheapFilters(partial, thresholds);
      if (!cheap.ok) {
        rejected.push({ source_ref: fullName, reasons: cheap.reasons });
        continue;
      }

      // Only cheap-filter survivors ever cost the two extra requests below.
      const releaseResult = await fetchLatestReleaseDate(config.fetchFn, fullName, config.headers);
      if (!releaseResult.ok) {
        errors.push(releaseResult.error);
        continue;
      }
      const readmeResult = await fetchReadmeExcerpt(config.fetchFn, fullName, config.headers);
      if (!readmeResult.ok) {
        errors.push(readmeResult.error);
        continue;
      }

      const candidate = mapSearchItemToCandidate(item, {
        hasDatedRelease: releaseResult.value,
        readmeExcerpt: readmeResult.value,
      });
      if (!candidate) continue;

      const verdict = evaluateHardFilters(candidate, thresholds);
      if (!verdict.ok) {
        rejected.push({ source_ref: fullName, reasons: verdict.reasons });
        continue;
      }

      rawCandidates.push({ ...candidate, score: scoreCandidate(candidate, config.now, weights) });
    }
  }

  const candidates = deduplicateCandidates(rawCandidates).slice(0, config.maxResults);
  return { candidates, rejected, errors, pagesFetched };
}
