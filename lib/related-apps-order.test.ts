import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { orderAndLimitRelatedApps } from "./related-apps-order.ts";

/**
 * Behavioral tests for the Related Apps sidebar ordering fix. Reproduces
 * the real bug: getRelatedApps() (lib/blog.ts) used to call `.limit(n)` on
 * an `.in("id", ids)` Supabase query — which has no ORDER BY — so for a
 * related_app_ids list longer than the sidebar's limit, an arbitrary `n`
 * rows could come back, not necessarily the first `n` in article order.
 * Surfaced for real by the related_app_ids backfill: every "Best
 * Open-Source X" post's sidebar showed a random 6 of its 10 linked apps
 * instead of the first 6.
 *
 * Row shape here is deliberately minimal ({ id }) — orderAndLimitRelatedApps
 * is generic over any object with an id, exactly what it needs to do its
 * job without depending on the real AppWithVersions shape.
 */

function row(id: string) {
  return { id };
}

group("orderAndLimitRelatedApps — 1 to 6 ids, all within the limit", () => {
  test("a single id is returned as-is", () => {
    const result = orderAndLimitRelatedApps([row("a")], ["a"], 6);
    assert.deepEqual(result.map((r) => r.id), ["a"]);
  });

  test("six ids, database already in order, all six returned in that exact order", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const result = orderAndLimitRelatedApps(ids.map(row), ids, 6);
    assert.deepEqual(result.map((r) => r.id), ids);
  });
});

group("orderAndLimitRelatedApps — the bug this fixes: LIMIT must never run before ordering", () => {
  test("10 ids -> exactly the FIRST 6 in article order, regardless of how the database returned them", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    // Simulates an arbitrary Postgres return order for an `.in()` query with
    // no ORDER BY — reversed here, but the point is it's some order that
    // does NOT match `ids`.
    const arbitraryDbOrder = [...ids].reverse().map(row);

    const result = orderAndLimitRelatedApps(arbitraryDbOrder, ids, 6);

    assert.deepEqual(result.map((r) => r.id), ["a", "b", "c", "d", "e", "f"]);
  });

  test("a shuffled database return still produces the correct first-6-in-article-order result", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    // Another arbitrary order, distinct from both `ids` and its reverse.
    const shuffled = ["g", "c", "j", "a", "e", "b", "i", "d", "h", "f"].map(row);

    const result = orderAndLimitRelatedApps(shuffled, ids, 6);

    assert.deepEqual(result.map((r) => r.id), ["a", "b", "c", "d", "e", "f"]);
  });

  test("proves LIMIT is not applied before ordering: if it were, a reversed 10-row input capped at the database level would surface j,i,h,g,f,e — not a,b,c,d,e,f", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const arbitraryDbOrder = [...ids].reverse().map(row);

    const result = orderAndLimitRelatedApps(arbitraryDbOrder, ids, 6).map((r) => r.id);

    assert.notDeepEqual(result, ["j", "i", "h", "g", "f", "e"]);
    assert.deepEqual(result, ["a", "b", "c", "d", "e", "f"]);
  });
});

group("orderAndLimitRelatedApps — missing/deleted app ids", () => {
  test("an id with no matching row is skipped; surviving apps keep their relative order", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    // "c" and "e" were deleted — no row for them comes back from the database.
    const rows = ["f", "a", "d", "b"].map(row); // also arbitrary db order
    const result = orderAndLimitRelatedApps(rows, ids, 6);
    assert.deepEqual(result.map((r) => r.id), ["a", "b", "d", "f"]);
  });

  test("missing ids among a >6 list still yield the correct in-order survivors, capped at limit", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    // "b" and "d" are missing; 6 rows survive, should return all 6 in order.
    const rows = ["h", "e", "a", "g", "c", "f"].map(row);
    const result = orderAndLimitRelatedApps(rows, ids, 6);
    assert.deepEqual(result.map((r) => r.id), ["a", "c", "e", "f", "g", "h"]);
  });
});

group("orderAndLimitRelatedApps — duplicate ids preserve existing behavior", () => {
  test("a duplicate id in the ids list is not expanded into two rows — the single matching row is kept once", () => {
    const ids = ["a", "b", "a", "c"];
    const rows = [row("a"), row("b"), row("c")]; // .in() never returns "a" twice
    const result = orderAndLimitRelatedApps(rows, ids, 6);
    assert.equal(result.length, 3);
    assert.deepEqual(new Set(result.map((r) => r.id)), new Set(["a", "b", "c"]));
  });

  test("a duplicate id sorts by its LAST occurrence in ids — unchanged from the pre-fix behavior", () => {
    // "a" appears at index 0 and index 2; a plain Map(ids.map(...)) resolves
    // to the later entry, so "a" sorts as if it were at position 2, after "b".
    const ids = ["a", "b", "a"];
    const rows = [row("b"), row("a")];
    const result = orderAndLimitRelatedApps(rows, ids, 6);
    assert.deepEqual(result.map((r) => r.id), ["b", "a"]);
  });
});

group("orderAndLimitRelatedApps — limit is still respected", () => {
  test("fewer rows than limit returns all of them", () => {
    const ids = ["a", "b", "c"];
    const result = orderAndLimitRelatedApps(ids.map(row), ids, 6);
    assert.equal(result.length, 3);
  });

  test("more rows than limit returns exactly `limit`, never more", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);
    const result = orderAndLimitRelatedApps(ids.map(row), ids, 6);
    assert.equal(result.length, 6);
  });

  test("a custom limit other than 6 is honored", () => {
    const ids = ["a", "b", "c", "d"];
    const result = orderAndLimitRelatedApps(ids.map(row), ids, 2);
    assert.deepEqual(result.map((r) => r.id), ["a", "b"]);
  });
});
