import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { validateRelatedAppIds } from "./blog-related-app-ids.ts";

/**
 * Behavioral tests for the pure related_app_ids validator — no next/cache,
 * no next/server, no Supabase, so unlike app/api/admin/blog/publish/route.ts
 * itself this module loads directly under plain `node --test`.
 */

const UUID_A = "561cc462-86f1-44bd-a834-fa202c764dbe";
const UUID_B = "f3bf1a8d-8b7c-4531-ba5c-1ffa61eb8db8";
const UUID_C = "baf4ffc9-4e80-4567-8645-c81b6490f72f";

group("validateRelatedAppIds — undefined (not provided)", () => {
  test("undefined is valid, provided:false, ids: []", () => {
    const result = validateRelatedAppIds(undefined);
    assert.deepEqual(result, { valid: true, provided: false, ids: [] });
  });
});

group("validateRelatedAppIds — empty array", () => {
  test("[] is valid, provided:true, ids: [] — distinct from undefined", () => {
    const result = validateRelatedAppIds([]);
    assert.deepEqual(result, { valid: true, provided: true, ids: [] });
  });
});

group("validateRelatedAppIds — a valid UUID array", () => {
  test("accepted, provided:true, ids match input exactly", () => {
    const result = validateRelatedAppIds([UUID_A, UUID_B, UUID_C]);
    assert.deepEqual(result, {
      valid: true,
      provided: true,
      ids: [UUID_A, UUID_B, UUID_C],
    });
  });

  test("a single valid UUID is accepted", () => {
    const result = validateRelatedAppIds([UUID_A]);
    assert.equal(result.valid, true);
  });

  test("uppercase-hex UUIDs are accepted (format only, not casing)", () => {
    const result = validateRelatedAppIds([UUID_A.toUpperCase()]);
    assert.equal(result.valid, true);
  });
});

group("validateRelatedAppIds — order and duplicates are preserved exactly", () => {
  test("order is preserved, not sorted", () => {
    const result = validateRelatedAppIds([UUID_C, UUID_A, UUID_B]);
    assert.equal(result.valid, true);
    if (result.valid) assert.deepEqual(result.ids, [UUID_C, UUID_A, UUID_B]);
  });

  test("duplicates are preserved, not deduplicated", () => {
    const result = validateRelatedAppIds([UUID_A, UUID_A, UUID_B]);
    assert.equal(result.valid, true);
    if (result.valid) assert.deepEqual(result.ids, [UUID_A, UUID_A, UUID_B]);
  });
});

group("validateRelatedAppIds — non-array input is rejected", () => {
  for (const bad of [null, "not-an-array", 42, true, { id: UUID_A }]) {
    test(`${JSON.stringify(bad)} is rejected`, () => {
      const result = validateRelatedAppIds(bad);
      assert.equal(result.valid, false);
      if (!result.valid) assert.match(result.error, /must be an array/);
    });
  }
});

group("validateRelatedAppIds — a non-string element is rejected", () => {
  for (const bad of [123, null, true, { id: UUID_A }, [UUID_A]]) {
    test(`[${JSON.stringify(bad)}] is rejected`, () => {
      const result = validateRelatedAppIds([bad]);
      assert.equal(result.valid, false);
      if (!result.valid) assert.match(result.error, /must be a string/);
    });
  }

  test("the error names the offending index", () => {
    const result = validateRelatedAppIds([UUID_A, 42]);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.error, /related_app_ids\[1\]/);
  });
});

group("validateRelatedAppIds — a malformed UUID is rejected", () => {
  for (const bad of [
    "",
    "not-a-uuid",
    "561cc462-86f1-44bd-a834", // truncated
    "561cc462-86f1-44bd-a834-fa202c764dbeXX", // trailing garbage
    " 561cc462-86f1-44bd-a834-fa202c764dbe", // leading whitespace
    "561cc462_86f1_44bd_a834_fa202c764dbe", // wrong separator
  ]) {
    test(`"${bad}" is rejected`, () => {
      const result = validateRelatedAppIds([bad]);
      assert.equal(result.valid, false);
      if (!result.valid) assert.match(result.error, /not a valid UUID/);
    });
  }

  test("one bad UUID among good ones still rejects the whole array", () => {
    const result = validateRelatedAppIds([UUID_A, "bad-id", UUID_B]);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.error, /related_app_ids\[1\]/);
  });
});
