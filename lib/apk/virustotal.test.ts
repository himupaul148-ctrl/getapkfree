import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  createVirusTotalScanner,
  type FetchLike,
  type VirusTotalHttpResponse,
} from "./virustotal.ts";

/**
 * Run with: npm test
 *
 * Covers the exact verdict/rate-limit contract carried over from
 * scripts/import-fdroid.mjs's own scanByHash: a verdict only exists for a
 * hash VirusTotal has already scanned; every other outcome — a miss, an
 * exhausted budget, a rejected key, a rate limit, a network error, no key,
 * scanning disabled — must resolve to "pending", never "clean".
 */

function jsonResponse(status: number, body: unknown): VirusTotalHttpResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function cleanStats(overrides: { malicious?: number; suspicious?: number } = {}) {
  return jsonResponse(200, {
    data: { attributes: { last_analysis_stats: { malicious: 0, suspicious: 0, ...overrides } } },
  });
}

function noSleep() {
  return async () => {};
}

group("createVirusTotalScanner — never infers clean from silence", () => {
  test("skipScan short-circuits to pending without calling fetch", async () => {
    let called = false;
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      skipScan: true,
      fetchImpl: (async () => {
        called = true;
        return cleanStats();
      }) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "pending");
    assert.equal(called, false);
  });

  test("a missing API key resolves to pending without throwing or calling fetch", async () => {
    let called = false;
    const scanner = createVirusTotalScanner({
      apiKey: undefined,
      fetchImpl: (async () => {
        called = true;
        return cleanStats();
      }) as FetchLike,
    });
    const result = await scanner.scanByHash("abc123");
    assert.equal(result, "pending");
    assert.equal(called, false);
  });

  test("an empty API key behaves the same as a missing one", async () => {
    let called = false;
    const scanner = createVirusTotalScanner({
      apiKey: "",
      fetchImpl: (async () => {
        called = true;
        return cleanStats();
      }) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "pending");
    assert.equal(called, false);
  });

  test("a null/undefined/empty hash resolves to pending without calling fetch", async () => {
    let calls = 0;
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      fetchImpl: (async () => {
        calls++;
        return cleanStats();
      }) as FetchLike,
    });
    assert.equal(await scanner.scanByHash(null), "pending");
    assert.equal(await scanner.scanByHash(undefined), "pending");
    assert.equal(await scanner.scanByHash(""), "pending");
    assert.equal(calls, 0);
  });

  test("a 404 (hash unknown to VirusTotal) resolves to pending", async () => {
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      fetchImpl: (async () => jsonResponse(404, {})) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "pending");
    assert.equal(scanner.callsUsed, 1);
  });

  test("zero malicious and zero suspicious resolves to clean", async () => {
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      fetchImpl: (async () => cleanStats()) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "clean");
  });

  test("any malicious detection resolves to flagged", async () => {
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      fetchImpl: (async () => cleanStats({ malicious: 1 })) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "flagged");
  });

  test("any suspicious detection resolves to flagged even with zero malicious", async () => {
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      fetchImpl: (async () => cleanStats({ suspicious: 1 })) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "flagged");
  });

  test("a 200 with no last_analysis_stats resolves to pending, not clean", async () => {
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      fetchImpl: (async () => jsonResponse(200, { data: { attributes: {} } })) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "pending");
  });

  test("a non-ok, non-special status resolves to pending", async () => {
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      fetchImpl: (async () => jsonResponse(500, {})) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "pending");
  });

  test("a rate limit that clears on retry eventually returns the real verdict", async () => {
    let calls = 0;
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      sleepImpl: noSleep(),
      fetchImpl: (async () => {
        calls++;
        return calls < 2 ? jsonResponse(429, {}) : cleanStats();
      }) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "clean");
    assert.equal(calls, 2);
  });

  test("a rate limit that never clears exhausts all 4 attempts and resolves to pending", async () => {
    let calls = 0;
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      sleepImpl: noSleep(),
      fetchImpl: (async () => {
        calls++;
        return jsonResponse(429, {});
      }) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "pending");
    assert.equal(calls, 4);
  });

  test("a rejected key (401) resolves to pending and marks the scanner exhausted", async () => {
    let calls = 0;
    const scanner = createVirusTotalScanner({
      apiKey: "bad-key",
      fetchImpl: (async () => {
        calls++;
        return jsonResponse(401, {});
      }) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "pending");
    assert.equal(scanner.exhausted, true);

    // A second lookup on the same scanner must not call out again — the key
    // is already known to be rejected.
    const result = await scanner.scanByHash("def456");
    assert.equal(result, "pending");
    assert.equal(calls, 1);
  });

  test("a rejected key (403) behaves the same as 401", async () => {
    const scanner = createVirusTotalScanner({
      apiKey: "bad-key",
      fetchImpl: (async () => jsonResponse(403, {})) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "pending");
    assert.equal(scanner.exhausted, true);
  });

  test("a network error retries then resolves to pending once attempts are exhausted", async () => {
    let calls = 0;
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      sleepImpl: noSleep(),
      fetchImpl: (async () => {
        calls++;
        throw new Error("ECONNRESET");
      }) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "pending");
    assert.equal(calls, 4);
  });

  test("a network error on the first attempt can still succeed on a later retry", async () => {
    let calls = 0;
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      sleepImpl: noSleep(),
      fetchImpl: (async () => {
        calls++;
        if (calls === 1) throw new Error("ECONNRESET");
        return cleanStats();
      }) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("abc123"), "clean");
  });

  test("the daily budget stops further calls once reached, staying pending", async () => {
    let calls = 0;
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      dailyBudget: 1,
      fetchImpl: (async () => {
        calls++;
        return cleanStats();
      }) as FetchLike,
    });
    assert.equal(await scanner.scanByHash("hash-1"), "clean");
    assert.equal(await scanner.scanByHash("hash-2"), "pending");
    assert.equal(calls, 1);
    assert.equal(scanner.exhausted, true);
  });

  test("callsUsed accurately counts every VirusTotal request actually sent", async () => {
    let calls = 0;
    const scanner = createVirusTotalScanner({
      apiKey: "key",
      sleepImpl: noSleep(),
      fetchImpl: (async () => {
        calls++;
        return calls < 3 ? jsonResponse(429, {}) : cleanStats();
      }) as FetchLike,
    });
    await scanner.scanByHash("abc123");
    assert.equal(scanner.callsUsed, calls);
    assert.equal(scanner.callsUsed, 3);
  });
});
