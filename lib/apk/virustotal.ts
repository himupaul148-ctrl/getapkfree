/**
 * Hash-only VirusTotal lookups — GET /files/{sha256}, never an upload.
 * Extracted from scripts/import-fdroid.mjs's own scanByHash so the bulk
 * F-Droid importer, the URL-import pipeline, and the admin verify route all
 * share the exact same interpretation of what VirusTotal actually said.
 *
 * A verdict only exists for a file VirusTotal has already scanned. Every
 * other outcome — not found, an exhausted budget, a rejected key, a rate
 * limit that never clears, a network error, no key configured, scanning
 * disabled — resolves to "pending". "pending" means no verdict was
 * obtained, never that the file is safe; nothing in this module is allowed
 * to infer "clean" from silence.
 */

export type ScanVerdict = "pending" | "clean" | "flagged";

const VT_FILES_URL = "https://www.virustotal.com/api/v3/files";

// VirusTotal free tier: 4 requests/minute, 240/hour, 500/day.
export const VT_RETRY_INTERVAL_MS = 15_500;
export const VT_DAILY_BUDGET = 480; // leave headroom under 500

/**
 * The minimal shape this module actually reads off a fetch response — not
 * the full Fetch API surface, so a test can hand back a plain object instead
 * of a real Response. The real global `fetch` already satisfies this.
 */
export type VirusTotalHttpResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<VirusTotalHttpResponse>;
export type SleepLike = (ms: number) => Promise<void>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init);
const defaultSleep: SleepLike = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

type VirusTotalFileResponseBody = {
  data?: {
    attributes?: {
      last_analysis_stats?: {
        malicious?: number;
        suspicious?: number;
      };
    };
  };
};

export type VirusTotalScannerOptions = {
  /** Server-only secret (VIRUSTOTAL_API_KEY). Falsy/missing -> every lookup resolves to "pending", nothing is ever called out. */
  apiKey: string | undefined;
  /** Mirrors import-fdroid.mjs's --skip-scan: never call out, everything stays pending. */
  skipScan?: boolean;
  /** Injection points for tests; production callers should never pass these. */
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
  dailyBudget?: number;
  retryIntervalMs?: number;
};

export type VirusTotalScanner = {
  /**
   * Looks up one SHA-256 hash. Resolves to "pending" whenever no verdict was
   * actually obtained — never infers "clean" from a miss, a rate limit, a
   * rejected key, or an error.
   */
  scanByHash(sha256: string | null | undefined): Promise<ScanVerdict>;
  /** Total VirusTotal requests actually sent on this scanner instance. */
  readonly callsUsed: number;
  /** True once this scanner has given up calling out (budget spent or key rejected) for the rest of its life. */
  readonly exhausted: boolean;
};

/**
 * Creates one scanner, scoped to its own call-count/exhaustion state — the
 * same lifetime scripts/import-fdroid.mjs's own module-level `vtCalls`/
 * `vtExhausted` variables had (reset every time the script runs). A caller
 * making many lookups in one run (the bulk importer) should create one
 * scanner and reuse it, so the budget and backoff are tracked across the
 * whole run; a caller checking a single hash (the admin verify route, the
 * URL-import pipeline) creates a fresh one each time, which is correct — the
 * daily budget was always per-process bookkeeping, never a persisted global.
 */
export function createVirusTotalScanner(
  options: VirusTotalScannerOptions,
): VirusTotalScanner {
  const {
    apiKey,
    skipScan = false,
    fetchImpl = defaultFetch,
    sleepImpl = defaultSleep,
    dailyBudget = VT_DAILY_BUDGET,
    retryIntervalMs = VT_RETRY_INTERVAL_MS,
  } = options;

  let calls = 0;
  let exhausted = false;

  async function scanByHash(sha256: string | null | undefined): Promise<ScanVerdict> {
    if (skipScan || exhausted || !sha256 || !apiKey) return "pending";
    if (calls >= dailyBudget) {
      exhausted = true;
      console.log("\n  VirusTotal daily budget reached — remaining lookups stay pending.\n");
      return "pending";
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        calls++;
        const res = await fetchImpl(`${VT_FILES_URL}/${sha256}`, {
          headers: { "x-apikey": apiKey },
        });

        if (res.status === 404) return "pending"; // VirusTotal has not seen it
        if (res.status === 429) {
          const backoff = retryIntervalMs * (attempt + 2);
          console.log(`    rate limited, waiting ${Math.round(backoff / 1000)}s…`);
          await sleepImpl(backoff);
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          exhausted = true;
          console.log("\n  VirusTotal rejected the API key — remaining lookups stay pending.\n");
          return "pending";
        }
        if (!res.ok) return "pending";

        const body = (await res.json()) as VirusTotalFileResponseBody;
        const stats = body?.data?.attributes?.last_analysis_stats;
        if (!stats) return "pending";
        return (stats.malicious ?? 0) > 0 || (stats.suspicious ?? 0) > 0
          ? "flagged"
          : "clean";
      } catch {
        await sleepImpl(retryIntervalMs);
      }
    }
    return "pending";
  }

  return {
    scanByHash,
    get callsUsed() {
      return calls;
    },
    get exhausted() {
      return exhausted;
    },
  };
}
