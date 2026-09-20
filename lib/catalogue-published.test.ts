import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { hasPublishedVersion } from "./catalogue-published.ts";
import type { AppSummary } from "./types.ts";

/**
 * Behavioral tests for the published-version guard shared by
 * getRelatedApps() and (conceptually) getCatalogue()'s own fetchCatalogue()
 * filter. Fixtures are shaped exactly like the real AppSummary rows
 * toSummary() produces — a published app has a real latestVersion string
 * (from its newest published build's version_name); an app with no
 * published version has latestVersion: null, which is what toSummary()
 * computes for both "never published yet" and "unpublished for a
 * content-policy violation" (e.g. kinemaster-premium-apk, capcut-premium
 * after the Step 3 catalogue cleanup) — RLS already strips their versions
 * array down to empty before toSummary() ever runs.
 */

const PUBLISHED_APP: AppSummary = {
  id: "37bc6103-83d3-47b6-a1e0-2445157d7597",
  name: "Obtainium",
  slug: "obtainium",
  packageName: "dev.imranr.obtainium",
  category: "Tools",
  description: "Get Android app updates directly from their sources.",
  iconUrl: "https://f-droid.org/repo/icons-640/dev.imranr.obtainium.png",
  developer: "ImranR98",
  downloadCount: 12,
  createdAt: "2026-08-06T00:00:00Z",
  latestVersion: "1.6.15",
  fileSize: 12_345_678,
  minAndroid: "8.0",
  lastUpdated: "2026-09-01T00:00:00Z",
  scannedAt: "2026-09-01T00:00:00Z",
  scanStatus: "clean",
  rating: 4.5,
  ratingCount: 10,
  sourceType: "fdroid",
  externalUrl: null,
  hostedLocally: true,
};

const UNPUBLISHED_APP: AppSummary = {
  ...PUBLISHED_APP,
  id: "516a6239-97ff-4dbe-8a29-167ccc020570",
  name: "kinemaster Premium  apk",
  slug: "kinemaster-premium-apk",
  sourceType: "external",
  externalUrl: "https://kinemasterplus.com/",
  hostedLocally: false,
  // toSummary() derives this from an empty versions[] array — exactly what
  // an anon read of `versions` returns once its only row is unpublished.
  latestVersion: null,
  fileSize: null,
  minAndroid: null,
  lastUpdated: null,
  scannedAt: null,
  scanStatus: null,
};

group("hasPublishedVersion", () => {
  test("an app with a published version (latestVersion set) is included", () => {
    assert.equal(hasPublishedVersion(PUBLISHED_APP), true);
  });

  test("an app with no published version (latestVersion null) is excluded", () => {
    assert.equal(hasPublishedVersion(UNPUBLISHED_APP), false);
  });

  test("an app that has never had a build published (also latestVersion null) is excluded the same way", () => {
    // Same signal, different real-world cause — a brand-new import awaiting
    // its first scan looks identical to an unpublished app from here, and
    // must be excluded from related-apps/popular-slugs just the same.
    assert.equal(hasPublishedVersion({ latestVersion: null }), false);
  });
});
