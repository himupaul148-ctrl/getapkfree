import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  searchApps,
  validateSearchQuery,
  MIN_QUERY_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  type SearchClient,
} from "./search.ts";

/**
 * Run with: npm test — a minimal fake SearchClient (just `.rpc()`)
 * throughout, never a real network call or database connection. The
 * actual ranking/similarity/published-version-filtering SQL logic lives in
 * public.search_apps() (see the migration and its own static test,
 * lib/search-migration.test.ts) — this file only tests searchApps()'s own
 * behavior: trimming, empty-query short-circuiting, field mapping, and
 * error propagation.
 */

function fakeClient(
  handler: (name: string, params: Record<string, unknown>) => { data: unknown; error: { message: string } | null },
): SearchClient {
  return {
    rpc: (async (name: string, params?: Record<string, unknown>) => handler(name, params ?? {})) as SearchClient["rpc"],
  };
}

const SAMPLE_ROW = { id: "app-1", name: "WhatsApp", slug: "whatsapp", icon_url: "https://example.com/icon.png", category: "Internet" };

group("searchApps — empty query", () => {
  test("an empty string returns an empty array without calling the database at all", async () => {
    let called = false;
    const client = fakeClient(() => {
      called = true;
      return { data: [], error: null };
    });
    const result = await searchApps("", client);
    assert.deepEqual(result, []);
    assert.equal(called, false);
  });

  test("a whitespace-only string also short-circuits to an empty array", async () => {
    let called = false;
    const client = fakeClient(() => {
      called = true;
      return { data: [], error: null };
    });
    const result = await searchApps("   ", client);
    assert.deepEqual(result, []);
    assert.equal(called, false);
  });
});

group("searchApps — trims and calls the RPC correctly", () => {
  test("trims surrounding whitespace before calling the RPC", async () => {
    let receivedParams: Record<string, unknown> | null = null;
    const client = fakeClient((name, params) => {
      receivedParams = params;
      return { data: [], error: null };
    });
    await searchApps("  photo  ", client);
    assert.equal((receivedParams as unknown as { query: string }).query, "photo");
  });

  test("calls the search_apps RPC by name, with max_results set to MAX_RESULTS", async () => {
    let calledName: string | null = null;
    let receivedParams: Record<string, unknown> | null = null;
    const client = fakeClient((name, params) => {
      calledName = name;
      receivedParams = params;
      return { data: [], error: null };
    });
    await searchApps("what", client);
    assert.equal(calledName, "search_apps");
    assert.equal((receivedParams as unknown as { max_results: number }).max_results, MAX_RESULTS);
  });
});

group("searchApps — field mapping", () => {
  test("maps snake_case DB columns to the minimal camelCase dropdown shape", async () => {
    const client = fakeClient(() => ({ data: [SAMPLE_ROW], error: null }));
    const result = await searchApps("what", client);
    assert.deepEqual(result, [
      { id: "app-1", name: "WhatsApp", slug: "whatsapp", iconUrl: "https://example.com/icon.png", category: "Internet" },
    ]);
  });

  test("a null icon_url/category maps through as null, not undefined or a placeholder", async () => {
    const client = fakeClient(() => ({
      data: [{ id: "app-2", name: "Some App", slug: "some-app", icon_url: null, category: null }],
      error: null,
    }));
    const result = await searchApps("some", client);
    assert.equal(result[0].iconUrl, null);
    assert.equal(result[0].category, null);
  });

  test("a null data value (no rows) maps to an empty array, not a thrown error", async () => {
    const client = fakeClient(() => ({ data: null, error: null }));
    const result = await searchApps("nomatch", client);
    assert.deepEqual(result, []);
  });

  test("never returns more fields than the minimal shape — no description, downloadCount, or other full-record fields", async () => {
    const client = fakeClient(() => ({ data: [SAMPLE_ROW], error: null }));
    const result = await searchApps("what", client);
    assert.deepEqual(Object.keys(result[0]).sort(), ["category", "iconUrl", "id", "name", "slug"]);
  });
});

group("searchApps — error handling", () => {
  test("a Supabase/RPC error is thrown, not silently swallowed into an empty result", async () => {
    const client = fakeClient(() => ({ data: null, error: { message: "function search_apps does not exist" } }));
    await assert.rejects(() => searchApps("what", client));
  });
});

group("validateSearchQuery", () => {
  test("an empty string is 'empty'", () => {
    assert.deepEqual(validateSearchQuery(""), { kind: "empty" });
  });

  test("a whitespace-only string is 'empty'", () => {
    assert.deepEqual(validateSearchQuery("   "), { kind: "empty" });
  });

  test("a normal query is 'ok', trimmed", () => {
    assert.deepEqual(validateSearchQuery("  photo  "), { kind: "ok", value: "photo" });
  });

  test("a query over MAX_QUERY_LENGTH is 'too_long'", () => {
    assert.deepEqual(validateSearchQuery("a".repeat(MAX_QUERY_LENGTH + 1)), { kind: "too_long" });
  });

  test("a query exactly at MAX_QUERY_LENGTH is still 'ok'", () => {
    const exact = "a".repeat(MAX_QUERY_LENGTH);
    assert.deepEqual(validateSearchQuery(exact), { kind: "ok", value: exact });
  });

  test("a single-character query is still 'ok' — the 2-character minimum is a client-side UX gate, not a server-side rejection", () => {
    assert.deepEqual(validateSearchQuery("a"), { kind: "ok", value: "a" });
  });
});

group("shared constants", () => {
  test("MIN_QUERY_LENGTH and MAX_QUERY_LENGTH are sane, exported values the header component and API route both read", () => {
    assert.equal(MIN_QUERY_LENGTH, 2);
    assert.equal(MAX_QUERY_LENGTH, 100);
    assert.equal(MAX_RESULTS, 6);
  });
});
