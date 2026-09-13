import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  buildSearchQuery,
  deduplicateCandidates,
  discoverGithubCandidates,
  evaluateHardFilters,
  fetchLatestReleaseDate,
  fetchReadmeExcerpt,
  fetchSearchPage,
  mapSearchItemToCandidate,
  matchesDateWindow,
  passesCheapFilters,
  scoreCandidate,
  DEFAULT_HARD_FILTER_THRESHOLDS,
  type GithubDiscoveryCandidate,
  type GithubFetchFn,
  type GithubFetchResponse,
  type RawGithubSearchItem,
} from "./github-discovery.ts";

/**
 * Run with: npm test — a fake, fixture-driven GithubFetchFn throughout,
 * never a real network call. Mirrors lib/metadata/play-watchlist-runner.test.ts's
 * own injected-fetch pattern.
 */

function jsonResponse(status: number, body: unknown): GithubFetchResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

/** Routes by URL substring to a fixed response — the simplest possible fake for a fixture-based test. */
function fakeFetch(routes: { match: string; response: GithubFetchResponse }[]): GithubFetchFn {
  return async (url: string) => {
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`no fixture route for ${url}`);
    return route.response;
  };
}

function throwingFetch(message: string): GithubFetchFn {
  return async () => {
    throw new Error(message);
  };
}

function searchItem(overrides: Partial<RawGithubSearchItem> = {}): RawGithubSearchItem {
  return {
    full_name: "someone/cool-android-app",
    html_url: "https://github.com/someone/cool-android-app",
    description: "A cool Android app for tracking things.",
    homepage: null,
    stargazers_count: 42,
    watchers_count: 10,
    license: { spdx_id: "MIT" },
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    default_branch: "main",
    topics: ["android", "kotlin"],
    fork: false,
    archived: false,
    is_template: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<GithubDiscoveryCandidate> = {}): GithubDiscoveryCandidate {
  return {
    source: "github",
    source_ref: "someone/cool-android-app",
    candidate_name: "someone/cool-android-app",
    repository_url: "https://github.com/someone/cool-android-app",
    homepage_url: null,
    description: "A cool Android app for tracking things.",
    stars: 42,
    watchers: 10,
    license_spdx: "MIT",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    default_branch: "main",
    has_dated_release: true,
    readme_excerpt: "This app helps you track things. Get it on Google Play: https://play.google.com/store/apps/details?id=com.someone.cool",
    topics: ["android", "kotlin"],
    is_fork: false,
    is_archived: false,
    is_template: false,
    ...overrides,
  };
}

/* --------------------------------------------------------------- mapping */

group("mapSearchItemToCandidate", () => {
  test("maps a valid item into a candidate with the required fields", () => {
    const c = mapSearchItemToCandidate(searchItem(), { hasDatedRelease: true, readmeExcerpt: "hello" });
    assert.ok(c);
    assert.equal(c!.source, "github");
    assert.equal(c!.source_ref, "someone/cool-android-app");
    assert.equal(c!.repository_url, "https://github.com/someone/cool-android-app");
    assert.equal(c!.license_spdx, "MIT");
    assert.equal(c!.has_dated_release, true);
    assert.equal(c!.readme_excerpt, "hello");
    assert.deepEqual(c!.topics, ["android", "kotlin"]);
  });

  test("returns null when full_name or html_url is missing", () => {
    assert.equal(mapSearchItemToCandidate({ html_url: "x" }, { hasDatedRelease: false, readmeExcerpt: null }), null);
    assert.equal(mapSearchItemToCandidate({ full_name: "a/b" }, { hasDatedRelease: false, readmeExcerpt: null }), null);
  });

  test("missing license/homepage/description map to null, not throwing", () => {
    const c = mapSearchItemToCandidate(
      searchItem({ license: null, homepage: undefined, description: undefined }),
      { hasDatedRelease: false, readmeExcerpt: null },
    );
    assert.equal(c!.license_spdx, null);
    assert.equal(c!.homepage_url, null);
    assert.equal(c!.description, null);
  });

  test("README/homepage mapping: homepage_url is carried through verbatim when present", () => {
    const c = mapSearchItemToCandidate(searchItem({ homepage: "https://play.google.com/store/apps/details?id=com.x" }), {
      hasDatedRelease: false,
      readmeExcerpt: null,
    });
    assert.equal(c!.homepage_url, "https://play.google.com/store/apps/details?id=com.x");
  });
});

/* ------------------------------------------------------------ date window */

group("matchesDateWindow", () => {
  test("true when created_at is on/after the boundary", () => {
    assert.equal(matchesDateWindow({ created_at: "2026-09-05T00:00:00Z", updated_at: "2020-01-01T00:00:00Z" }, "2026-09-01"), true);
  });

  test("true when updated_at is on/after the boundary, even if created_at is older", () => {
    assert.equal(matchesDateWindow({ created_at: "2020-01-01T00:00:00Z", updated_at: "2026-09-05T00:00:00Z" }, "2026-09-01"), true);
  });

  test("false when both dates are before the boundary", () => {
    assert.equal(matchesDateWindow({ created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-02T00:00:00Z" }, "2026-09-01"), false);
  });

  test("this module never hardcodes 'today' — the boundary is always the caller's own value", () => {
    // buildSearchQuery embeds exactly the `since` it was given, nothing derived internally.
    assert.match(buildSearchQuery({ since: "2026-01-01" }), /pushed:>=2026-01-01/);
    assert.match(buildSearchQuery({ since: "1999-12-31" }), /pushed:>=1999-12-31/);
  });
});

/* ------------------------------------------------------------- dedup */

group("deduplicateCandidates", () => {
  test("keeps the first occurrence of each source+source_ref pair", () => {
    const items = [
      { source: "github", source_ref: "a/b", n: 1 },
      { source: "github", source_ref: "a/b", n: 2 },
      { source: "github", source_ref: "c/d", n: 3 },
    ];
    const result = deduplicateCandidates(items);
    assert.deepEqual(result.map((r) => r.n), [1, 3]);
  });

  test("an empty list deduplicates to an empty list", () => {
    assert.deepEqual(deduplicateCandidates([]), []);
  });
});

/* -------------------------------------------------------------- filters */

group("passesCheapFilters / evaluateHardFilters — valid candidate", () => {
  test("a well-formed Android app candidate passes every hard filter", () => {
    const verdict = evaluateHardFilters(candidate());
    assert.deepEqual(verdict, { ok: true });
  });
});

group("evaluateHardFilters — non-Android repository", () => {
  test("rejected when nothing suggests Android", () => {
    const c = candidate({ description: "A CLI tool for managing dotfiles.", topics: ["cli", "dotfiles"], candidate_name: "someone/dotfiles-manager" });
    const verdict = evaluateHardFilters(c);
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.ok(verdict.reasons.some((r) => r.includes("not plausibly an Android project")));
  });
});

group("evaluateHardFilters — missing license", () => {
  test("rejected when there is no real license", () => {
    const verdict = evaluateHardFilters(candidate({ license_spdx: null }));
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.ok(verdict.reasons.some((r) => r.includes("no real license")));
  });
});

group("evaluateHardFilters — no release", () => {
  test("rejected when there is no dated release and stars are below the strong-evidence bar", () => {
    const verdict = evaluateHardFilters(candidate({ has_dated_release: false, stars: 10 }));
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.ok(verdict.reasons.some((r) => r.includes("no dated release")));
  });

  test("passes anyway when stars clear the strong-evidence bar, even with no dated release", () => {
    const verdict = evaluateHardFilters(candidate({ has_dated_release: false, stars: 500 }));
    assert.equal(verdict.ok, true);
  });
});

group("evaluateHardFilters — low stars", () => {
  test("rejected when both stars and watchers are below threshold", () => {
    const verdict = evaluateHardFilters(candidate({ stars: 1, watchers: 0 }));
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.ok(verdict.reasons.some((r) => r.includes("star/watch signal too low")));
  });

  test("a strong watcher count alone is enough to pass the star/watch check", () => {
    const verdict = passesCheapFilters(candidate({ stars: 1, watchers: 50 }));
    assert.equal(verdict.ok, true);
  });
});

group("evaluateHardFilters — obvious library/framework", () => {
  for (const name of ["android-networking-library", "kotlin-mvvm-template", "sample-compose-app", "awesome-android"]) {
    test(`rejected: ${name} looks like a library/template/sample, not an app`, () => {
      const verdict = evaluateHardFilters(candidate({ candidate_name: `someone/${name}`, description: null, topics: [] }));
      assert.equal(verdict.ok, false);
      if (!verdict.ok) assert.ok(verdict.reasons.some((r) => r.includes("library/framework/SDK/template/sample/tutorial")));
    });
  }
});

group("evaluateHardFilters — fork/archived/template repos are rejected", () => {
  test("a fork is rejected", () => {
    const verdict = evaluateHardFilters(candidate({ is_fork: true }));
    assert.equal(verdict.ok, false);
  });
  test("an archived repo is rejected", () => {
    const verdict = evaluateHardFilters(candidate({ is_archived: true }));
    assert.equal(verdict.ok, false);
  });
  test("a template repo is rejected", () => {
    const verdict = evaluateHardFilters(candidate({ is_template: true }));
    assert.equal(verdict.ok, false);
  });
});

group("evaluateHardFilters — not enough metadata for later Play URL extraction", () => {
  test("rejected when homepage, description, and readme are all empty", () => {
    const verdict = evaluateHardFilters(candidate({ homepage_url: null, description: null, readme_excerpt: null }));
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.ok(verdict.reasons.some((r) => r.includes("no homepage, description, or README text")));
  });

  test("a homepage alone is enough", () => {
    const verdict = evaluateHardFilters(candidate({ homepage_url: "https://example.com", description: null, readme_excerpt: null }));
    assert.equal(verdict.ok, true);
  });
});

group("evaluateHardFilters — collects every failing reason, not just the first", () => {
  test("a candidate failing multiple checks reports all of them", () => {
    const verdict = evaluateHardFilters(
      candidate({ license_spdx: null, stars: 0, watchers: 0, has_dated_release: false, description: null, homepage_url: null, readme_excerpt: null }),
    );
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.ok(verdict.reasons.length >= 3);
  });
});

/* --------------------------------------------------------------- scoring */

group("scoreCandidate", () => {
  const now = new Date("2026-09-13T00:00:00Z");

  test("more stars increases the score", () => {
    const low = scoreCandidate(candidate({ stars: 1 }), now);
    const high = scoreCandidate(candidate({ stars: 10000 }), now);
    assert.ok(high > low);
  });

  test("a more recently updated candidate scores higher than a stale one", () => {
    const fresh = scoreCandidate(candidate({ updated_at: "2026-09-12T00:00:00Z" }), now);
    const stale = scoreCandidate(candidate({ updated_at: "2020-01-01T00:00:00Z" }), now);
    assert.ok(fresh > stale);
  });

  test("readme/homepage/release presence each add to the score", () => {
    const bare = scoreCandidate(candidate({ readme_excerpt: null, homepage_url: null, has_dated_release: false, stars: 500 }), now);
    const full = scoreCandidate(candidate({ readme_excerpt: "text", homepage_url: "https://x.com", has_dated_release: true, stars: 500 }), now);
    assert.ok(full > bare);
  });

  test("score is deterministic for the same inputs and the same `now`", () => {
    const a = scoreCandidate(candidate(), now);
    const b = scoreCandidate(candidate(), now);
    assert.equal(a, b);
  });
});

group("score never overrides a hard rejection", () => {
  test("a candidate that scores highly on every axis is still rejected if it fails a hard filter", () => {
    const now = new Date("2026-09-13T00:00:00Z");
    const highScoringButDisqualified = candidate({
      stars: 100000,
      watchers: 5000,
      updated_at: now.toISOString(),
      readme_excerpt: "great readme",
      homepage_url: "https://example.com",
      has_dated_release: true,
      license_spdx: null, // the one disqualifier
    });
    const score = scoreCandidate(highScoringButDisqualified, now);
    const verdict = evaluateHardFilters(highScoringButDisqualified);
    assert.ok(score > 50, "expected a high advisory score");
    assert.equal(verdict.ok, false, "a high score must not rescue a hard-filter failure");
  });
});

/* ---------------------------------------------------------- HTTP: search */

group("fetchSearchPage", () => {
  test("returns the raw items array on success", async () => {
    const fetchFn = fakeFetch([{ match: "/search/repositories", response: jsonResponse(200, { items: [searchItem()] }) }]);
    const result = await fetchSearchPage(fetchFn, "android", 1, 30);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.length, 1);
  });

  test("malformed response: missing `items` array is a structured error, not an empty success", async () => {
    const fetchFn = fakeFetch([{ match: "/search/repositories", response: jsonResponse(200, { total_count: 0 }) }]);
    const result = await fetchSearchPage(fetchFn, "android", 1, 30);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "malformed_response");
  });

  test("HTTP 403 rate-limit body is reported as rate_limited, not http_error", async () => {
    const fetchFn = fakeFetch([
      { match: "/search/repositories", response: jsonResponse(403, { message: "API rate limit exceeded for user." }) },
    ]);
    const result = await fetchSearchPage(fetchFn, "android", 1, 30);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "rate_limited");
  });

  test("HTTP 429 is always rate_limited regardless of body", async () => {
    const fetchFn = fakeFetch([{ match: "/search/repositories", response: jsonResponse(429, {}) }]);
    const result = await fetchSearchPage(fetchFn, "android", 1, 30);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "rate_limited");
  });

  test("a plain HTTP error (e.g. 500) is reported as http_error", async () => {
    const fetchFn = fakeFetch([{ match: "/search/repositories", response: jsonResponse(500, { message: "Internal error." }) }]);
    const result = await fetchSearchPage(fetchFn, "android", 1, 30);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, "http_error");
      assert.equal(result.error.status, 500);
    }
  });

  test("a network failure (fetch rejects) is reported as network_error", async () => {
    const result = await fetchSearchPage(throwingFetch("getaddrinfo ENOTFOUND"), "android", 1, 30);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "network_error");
  });

  test("a response whose .json() throws is reported as malformed_response, not swallowed", async () => {
    const fetchFn: GithubFetchFn = async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error("unexpected token");
      },
    });
    const result = await fetchSearchPage(fetchFn, "android", 1, 30);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "malformed_response");
  });
});

/* ------------------------------------------------------- HTTP: releases */

group("fetchLatestReleaseDate", () => {
  test("true when at least one release has a published_at", async () => {
    const fetchFn = fakeFetch([{ match: "/releases", response: jsonResponse(200, [{ published_at: "2026-01-01T00:00:00Z" }]) }]);
    const result = await fetchLatestReleaseDate(fetchFn, "a/b");
    assert.deepEqual(result, { ok: true, value: true });
  });

  test("false when the releases array is empty", async () => {
    const fetchFn = fakeFetch([{ match: "/releases", response: jsonResponse(200, []) }]);
    const result = await fetchLatestReleaseDate(fetchFn, "a/b");
    assert.deepEqual(result, { ok: true, value: false });
  });

  test("malformed (non-array) response is a structured error", async () => {
    const fetchFn = fakeFetch([{ match: "/releases", response: jsonResponse(200, { not: "an array" }) }]);
    const result = await fetchLatestReleaseDate(fetchFn, "a/b");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "malformed_response");
  });
});

/* --------------------------------------------------------- HTTP: readme */

group("fetchReadmeExcerpt", () => {
  test("decodes base64 content to plain text", async () => {
    const text = "# My App\nGet it on Google Play: https://play.google.com/store/apps/details?id=com.x";
    const fetchFn = fakeFetch([
      { match: "/readme", response: jsonResponse(200, { content: Buffer.from(text, "utf8").toString("base64"), encoding: "base64" }) },
    ]);
    const result = await fetchReadmeExcerpt(fetchFn, "a/b");
    assert.deepEqual(result, { ok: true, value: text });
  });

  test("a missing README (404) is a normal null, not an error", async () => {
    const fetchFn = fakeFetch([{ match: "/readme", response: jsonResponse(404, { message: "Not Found" }) }]);
    const result = await fetchReadmeExcerpt(fetchFn, "a/b");
    assert.deepEqual(result, { ok: true, value: null });
  });

  test("truncates to maxChars", async () => {
    const longText = "x".repeat(10_000);
    const fetchFn = fakeFetch([
      { match: "/readme", response: jsonResponse(200, { content: Buffer.from(longText, "utf8").toString("base64"), encoding: "base64" }) },
    ]);
    const result = await fetchReadmeExcerpt(fetchFn, "a/b", undefined, 100);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value?.length, 100);
  });

  test("malformed (missing content/encoding) is a structured error", async () => {
    const fetchFn = fakeFetch([{ match: "/readme", response: jsonResponse(200, { encoding: "base64" }) }]);
    const result = await fetchReadmeExcerpt(fetchFn, "a/b");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "malformed_response");
  });
});

/* ------------------------------------------------------- orchestration */

group("discoverGithubCandidates — end to end with fixtures", () => {
  function routesFor(items: RawGithubSearchItem[], releasesByRepo: Record<string, boolean> = {}, readmeByRepo: Record<string, string> = {}) {
    const routes: { match: string; response: GithubFetchResponse }[] = [
      { match: "/search/repositories", response: jsonResponse(200, { items }) },
    ];
    for (const item of items) {
      const repo = item.full_name as string;
      const hasRelease = releasesByRepo[repo] ?? true;
      routes.push({
        match: `/repos/${repo}/releases`,
        response: jsonResponse(200, hasRelease ? [{ published_at: "2026-01-01T00:00:00Z" }] : []),
      });
      const readme = readmeByRepo[repo] ?? "Get it on Google Play: https://play.google.com/store/apps/details?id=com.example";
      routes.push({
        match: `/repos/${repo}/readme`,
        response: jsonResponse(200, { content: Buffer.from(readme, "utf8").toString("base64"), encoding: "base64" }),
      });
    }
    return routes;
  }

  test("a valid candidate survives end to end, with a score attached", async () => {
    const items = [searchItem()];
    const fetchFn = fakeFetch(routesFor(items));
    const report = await discoverGithubCandidates({
      fetchFn,
      since: "2026-09-01",
      now: new Date("2026-09-13T00:00:00Z"),
      maxResults: 5,
    });
    assert.equal(report.candidates.length, 1);
    assert.equal(report.candidates[0].source_ref, "someone/cool-android-app");
    assert.equal(typeof report.candidates[0].score, "number");
    assert.equal(report.errors.length, 0);
  });

  test("a non-Android repo is rejected and never costs a release/readme request", async () => {
    const nonAndroid = searchItem({ full_name: "someone/dotfiles", html_url: "https://github.com/someone/dotfiles", description: "dotfiles manager", topics: ["cli"] });
    let releaseRequested = false;
    const fetchFn: GithubFetchFn = async (url) => {
      if (url.includes("/search/repositories")) return jsonResponse(200, { items: [nonAndroid] });
      if (url.includes("/releases")) {
        releaseRequested = true;
        return jsonResponse(200, []);
      }
      return jsonResponse(200, { content: "", encoding: "base64" });
    };
    const report = await discoverGithubCandidates({ fetchFn, since: "2026-09-01", now: new Date("2026-09-13T00:00:00Z"), maxResults: 5, maxPages: 1 });
    assert.equal(report.candidates.length, 0);
    assert.equal(report.rejected.length, 1);
    assert.equal(releaseRequested, false, "a cheap-filter failure must never trigger the extra release request");
  });

  test("deduplicates across pages", async () => {
    const item = searchItem();
    let call = 0;
    const fetchFn: GithubFetchFn = async (url) => {
      if (url.includes("/search/repositories")) {
        call++;
        // The same item appears on both "pages" — a real-world overlap case.
        return jsonResponse(200, { items: call <= 2 ? [item] : [] });
      }
      if (url.includes("/releases")) return jsonResponse(200, [{ published_at: "2026-01-01T00:00:00Z" }]);
      return jsonResponse(200, { content: Buffer.from("Google Play: https://play.google.com/x").toString("base64"), encoding: "base64" });
    };
    const report = await discoverGithubCandidates({
      fetchFn,
      since: "2026-09-01",
      now: new Date("2026-09-13T00:00:00Z"),
      maxResults: 5,
      maxPages: 3,
    });
    assert.equal(report.candidates.length, 1, "the same repo found on two pages must appear only once");
  });

  test("respects maxResults even when more candidates are available", async () => {
    const items = [
      searchItem({ full_name: "a/one", html_url: "https://github.com/a/one" }),
      searchItem({ full_name: "a/two", html_url: "https://github.com/a/two" }),
      searchItem({ full_name: "a/three", html_url: "https://github.com/a/three" }),
    ];
    const fetchFn = fakeFetch(routesFor(items));
    const report = await discoverGithubCandidates({ fetchFn, since: "2026-09-01", now: new Date("2026-09-13T00:00:00Z"), maxResults: 2 });
    assert.equal(report.candidates.length, 2);
  });

  test("respects maxPages — stops paginating even if maxResults hasn't been reached", async () => {
    let pagesRequested = 0;
    const fetchFn: GithubFetchFn = async (url) => {
      if (url.includes("/search/repositories")) {
        pagesRequested++;
        // Always return a non-Android item so nothing ever passes and the
        // loop is forced to paginate all the way to maxPages.
        return jsonResponse(200, { items: [searchItem({ full_name: `x/${pagesRequested}`, html_url: `https://github.com/x/${pagesRequested}`, topics: [], description: "not android at all" })] });
      }
      return jsonResponse(200, []);
    };
    const report = await discoverGithubCandidates({ fetchFn, since: "2026-09-01", now: new Date("2026-09-13T00:00:00Z"), maxResults: 50, maxPages: 2 });
    assert.equal(report.pagesFetched, 2);
  });

  test("date filtering: an item outside the since window is rejected even if the search API returned it", async () => {
    const oldItem = searchItem({ created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-02T00:00:00Z" });
    const fetchFn = fakeFetch(routesFor([oldItem]));
    const report = await discoverGithubCandidates({ fetchFn, since: "2026-09-01", now: new Date("2026-09-13T00:00:00Z"), maxResults: 5 });
    assert.equal(report.candidates.length, 0);
    assert.ok(report.rejected.some((r) => r.reasons.includes("outside the requested date window")));
  });

  test("a rate-limit error from the search endpoint is collected in errors, not silently empty", async () => {
    const fetchFn = fakeFetch([{ match: "/search/repositories", response: jsonResponse(403, { message: "API rate limit exceeded" }) }]);
    const report = await discoverGithubCandidates({ fetchFn, since: "2026-09-01", now: new Date("2026-09-13T00:00:00Z"), maxResults: 5 });
    assert.equal(report.candidates.length, 0);
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].kind, "rate_limited");
  });

  test("a network failure while fetching a release surfaces as a collected error, and the candidate is skipped, not silently accepted", async () => {
    const items = [searchItem()];
    const fetchFn: GithubFetchFn = async (url) => {
      if (url.includes("/search/repositories")) return jsonResponse(200, { items });
      if (url.includes("/releases")) throw new Error("network down");
      return jsonResponse(200, { content: "", encoding: "base64" });
    };
    const report = await discoverGithubCandidates({ fetchFn, since: "2026-09-01", now: new Date("2026-09-13T00:00:00Z"), maxResults: 5, maxPages: 1 });
    assert.equal(report.candidates.length, 0);
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].kind, "network_error");
  });

  test("never calls anything other than the injected fetch function — no global fetch, no Supabase, no Play request", async () => {
    let calls = 0;
    const fetchFn: GithubFetchFn = async (url) => {
      calls++;
      assert.ok(url.startsWith("https://api.github.com/"), "every request must go to api.github.com, never play.google.com or anywhere else");
      if (url.includes("/search/repositories")) return jsonResponse(200, { items: [searchItem()] });
      if (url.includes("/releases")) return jsonResponse(200, [{ published_at: "2026-01-01T00:00:00Z" }]);
      return jsonResponse(200, { content: "", encoding: "base64" });
    };
    await discoverGithubCandidates({ fetchFn, since: "2026-09-01", now: new Date("2026-09-13T00:00:00Z"), maxResults: 5 });
    assert.ok(calls > 0);
  });
});

group("thresholds are configurable, not hardcoded", () => {
  test("a custom, more permissive threshold changes the outcome for the same candidate", () => {
    const lowStars = candidate({ stars: 2, watchers: 0 });
    assert.equal(evaluateHardFilters(lowStars, DEFAULT_HARD_FILTER_THRESHOLDS).ok, false);
    assert.equal(evaluateHardFilters(lowStars, { minStars: 1, minWatchers: 0, strongEvidenceStars: 50 }).ok, true);
  });
});
