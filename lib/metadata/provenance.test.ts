import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  FIELD_LABELS,
  isManual,
  markManual,
  OVERRIDABLE_FIELDS,
  type OverridableField,
} from "./provenance.ts";

/**
 * P2-1: license is an app-level fact a human may reasonably want to correct
 * (F-Droid's own SPDX value can be wrong or absent), so it gets the same
 * override protection as description/category/etc. target_sdk is a purely
 * mechanical, per-build fact — like min_android_version, it is always
 * re-derived from the authoritative source and deliberately has no override
 * protection; it must never be added to this list.
 */

group("OVERRIDABLE_FIELDS — license", () => {
  test("license is a recognised overridable field", () => {
    assert.ok((OVERRIDABLE_FIELDS as readonly string[]).includes("license"));
  });

  test("license has a FIELD_LABELS entry, matching the pattern every other field follows", () => {
    assert.equal(FIELD_LABELS.license, "License");
  });

  test("isManual/markManual work for license exactly like any other overridable field", () => {
    assert.equal(isManual(["license"], "license"), true);
    assert.equal(isManual([], "license"), false);
    assert.equal(isManual(null, "license"), false);

    const marked = markManual(["name"], ["license" as OverridableField]);
    assert.deepEqual(new Set(marked), new Set(["name", "license"]));
  });
});

group("target_sdk — deliberately NOT overridable", () => {
  test("target_sdk is not in OVERRIDABLE_FIELDS", () => {
    assert.equal(
      (OVERRIDABLE_FIELDS as readonly string[]).includes("target_sdk"),
      false,
    );
  });

  test("target_sdk has no FIELD_LABELS entry", () => {
    assert.equal("target_sdk" in FIELD_LABELS, false);
  });
});

group("existing overridable fields are untouched", () => {
  test("every field present before P2-1 is still present, in the same order, plus license at the end", () => {
    assert.deepEqual(OVERRIDABLE_FIELDS, [
      "name",
      "description",
      "icon_url",
      "screenshots",
      "developer_name",
      "category",
      "rating",
      "rating_count",
      "version_name",
      "license",
    ]);
  });
});
