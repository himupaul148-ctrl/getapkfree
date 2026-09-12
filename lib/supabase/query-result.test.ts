import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { resolveQueryResult } from "./query-result.ts";

/**
 * Unlike lib/catalogue.ts, this file has no next/cache or Supabase-client
 * import, so it loads fine under plain `node --test` and can be exercised
 * directly rather than only through static source-text assertions.
 */

const fakeError = {
  message: "connection reset",
  details: "",
  hint: "",
  code: "08006",
  name: "PostgrestError",
} as const;

group("resolveQueryResult — distinguishes 'no row found' from 'query failed'", () => {
  test("a successful populated result passes through unchanged", () => {
    const row = { id: "1", name: "Test App" };
    assert.equal(resolveQueryResult(row, null, "context"), row);
  });

  test("a successful no-row result (data null, no error) still returns null", () => {
    assert.equal(resolveQueryResult(null, null, "fetchAppBySlug: Supabase query failed for slug \"missing\""), null);
  });

  test("a successful empty-array result passes through unchanged", () => {
    const rows: unknown[] = [];
    assert.equal(resolveQueryResult(rows, null, "context"), rows);
  });

  test("a Supabase error is thrown rather than silently becoming the data value", () => {
    assert.throws(() => resolveQueryResult(null, fakeError, "boom"));
  });

  test("the thrown error carries the exact context message given, not a generic one", () => {
    assert.throws(
      () => resolveQueryResult(null, fakeError, 'fetchAppBySlug: Supabase query failed for slug "x"'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'fetchAppBySlug: Supabase query failed for slug "x"');
        return true;
      },
    );
  });

  test("the thrown error's cause is the original Supabase error, unmodified", () => {
    assert.throws(
      () => resolveQueryResult(null, fakeError, "boom"),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.cause, fakeError);
        return true;
      },
    );
  });

  test("an error takes precedence even when data is non-null (defence in depth)", () => {
    assert.throws(() => resolveQueryResult({ id: "1" }, fakeError, "boom"));
  });
});
