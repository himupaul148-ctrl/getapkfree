import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";
import {
  alreadyKnownApps,
  computeAlreadyKnownIds,
  deltaPreloadUrl,
  mergeCatalogueDelta,
} from "./catalogue-delta.ts";
import type { AppSummary } from "./types.ts";

/**
 * PREVIEW EXPERIMENT — Variant B early-preload investigation. Not yet
 * committed. Real-data tests for the delta selection and merge functions
 * against the actual 272-app production-shaped fixture.
 */

const apps: AppSummary[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/catalogue-apps.json", import.meta.url)), "utf8"),
);

group("computeAlreadyKnownIds against the real 272-app fixture", () => {
  test("selects exactly 34 already-known ids", () => {
    assert.equal(computeAlreadyKnownIds(apps).length, 34);
  });

  test("every already-known id exists in the fixture", () => {
    const ids = new Set(apps.map((a) => a.id));
    assert.ok(computeAlreadyKnownIds(apps).every((id) => ids.has(id)));
  });

  test("ids are unique (the three source lists dedupe correctly)", () => {
    const ids = computeAlreadyKnownIds(apps);
    assert.equal(new Set(ids).size, ids.length);
  });
});

group("alreadyKnownApps / deltaPreloadUrl", () => {
  test("alreadyKnownApps returns exactly the 34 apps named by computeAlreadyKnownIds", () => {
    const ids = new Set(computeAlreadyKnownIds(apps));
    const known = alreadyKnownApps(apps);
    assert.equal(known.length, 34);
    assert.ok(known.every((a) => ids.has(a.id)));
  });

  test("deltaPreloadUrl embeds every already-known id as a comma-separated exclude param", () => {
    const url = deltaPreloadUrl(apps);
    assert.match(url, /^\/api\/catalogue-delta\?exclude=/);
    const idsInUrl = url.split("exclude=")[1].split(",");
    assert.deepEqual(idsInUrl.sort(), computeAlreadyKnownIds(apps).sort());
  });
});

group("dataset integrity: known + delta = full catalogue, zero overlap", () => {
  test("34 known + 238 delta = 272 total, with zero duplicates and zero missing", () => {
    const knownIds = new Set(computeAlreadyKnownIds(apps));
    const deltaApps = apps.filter((a) => !knownIds.has(a.id));
    assert.equal(knownIds.size, 34);
    assert.equal(deltaApps.length, 238);
    const union = new Set([...knownIds, ...deltaApps.map((a) => a.id)]);
    assert.equal(union.size, 272);
    // Excluded ids never appear in the delta response.
    assert.ok(deltaApps.every((a) => !knownIds.has(a.id)));
  });
});

group("mergeCatalogueDelta", () => {
  const known = alreadyKnownApps(apps);
  const knownIds = new Set(computeAlreadyKnownIds(apps));
  const deltaApps = apps.filter((a) => !knownIds.has(a.id));

  test("merging the real delta onto the real known subset reconstructs all 272 apps", () => {
    const merged = mergeCatalogueDelta(known, deltaApps);
    assert.equal(merged.length, 272);
    assert.equal(new Set(merged.map((a) => a.id)).size, 272);
  });

  test("merge is a no-op when the delta is empty", () => {
    const merged = mergeCatalogueDelta(known, []);
    assert.deepEqual(merged, known);
  });

  test("merge drops any delta app whose id is already present (no duplicate merge)", () => {
    const merged = mergeCatalogueDelta(known, [known[0], ...deltaApps.slice(0, 5)]);
    assert.equal(merged.length, known.length + 5);
    assert.equal(new Set(merged.map((a) => a.id)).size, merged.length);
  });

  test("retrying the same merge twice does not double-add (idempotent against the same delta)", () => {
    const once = mergeCatalogueDelta(known, deltaApps);
    const retried = mergeCatalogueDelta(once, deltaApps);
    assert.equal(retried.length, 272);
    assert.equal(new Set(retried.map((a) => a.id)).size, 272);
  });

  test("preserves current apps first, then appends new delta apps in their given order", () => {
    const merged = mergeCatalogueDelta(known, deltaApps.slice(0, 3));
    assert.deepEqual(
      merged.slice(0, known.length).map((a) => a.id),
      known.map((a) => a.id),
    );
    assert.deepEqual(
      merged.slice(known.length).map((a) => a.id),
      deltaApps.slice(0, 3).map((a) => a.id),
    );
  });
});
