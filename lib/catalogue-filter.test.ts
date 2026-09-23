import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";
import { androidLevel } from "./format.ts";
import { filterAndSortCatalogue, matchesQuery } from "./catalogue-filter.ts";
import { ANDROID_LEVELS, CATEGORIES, SOURCE_FILTERS } from "./types.ts";
import type { AppSummary } from "./types.ts";

/**
 * PREVIEW EXPERIMENT — Variant B early-preload investigation. Not yet
 * committed.
 *
 * Focused parity suite against the real 272-app production-shaped dataset
 * (lib/__fixtures__/catalogue-apps.json, captured from production) —
 * exercising CatalogueSection's actual search/filter/sort algorithm
 * (lib/catalogue-filter.ts, imported by CatalogueSection.tsx directly, not a
 * parallel copy) to confirm the delta-loading rework didn't change behavior.
 * Loading gate / retry / merge correctness are covered in
 * lib/catalogue-delta.test.ts (the pure merge function) and by static source
 * checks below (the state machine itself needs a DOM to exercise for real —
 * this project has no jsdom/RTL configured, the same constraint documented
 * throughout, e.g. app/page.test.ts).
 */

const apps: AppSummary[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/catalogue-apps.json", import.meta.url)), "utf8"),
);

const NO_FILTER = { search: "", category: "", android: "", source: "all" as const, sort: "trending" as const };

group("fixture sanity", () => {
  test("the fixture has exactly 272 apps", () => {
    assert.equal(apps.length, 272);
  });

  test("every app has a unique id", () => {
    assert.equal(new Set(apps.map((a) => a.id)).size, 272);
  });
});

group("search", () => {
  test("matches by name (case-insensitive)", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, search: "MAGE" });
    assert.ok(results.length > 0);
    assert.ok(results.every((a) => matchesQuery(a, "mage")));
  });

  test("matches by description keyword", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, search: "password" });
    assert.ok(results.length > 0);
    assert.ok(
      results.every(
        (a) =>
          a.name.toLowerCase().includes("password") ||
          a.description?.toLowerCase().includes("password"),
      ),
    );
  });

  test("matches by package name", () => {
    const target = apps[0];
    const fragment = target.packageName!.split(".").pop()!;
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, search: fragment });
    assert.ok(results.some((a) => a.id === target.id));
  });

  test("matches by developer name", () => {
    const withDeveloper = apps.find((a) => a.developer);
    assert.ok(withDeveloper, "fixture must contain at least one app with a developer");
    const results = filterAndSortCatalogue(apps, {
      ...NO_FILTER,
      search: withDeveloper!.developer!,
    });
    assert.ok(results.some((a) => a.id === withDeveloper!.id));
  });

  test("matches by category name used as a free-text query", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, search: "games" });
    assert.ok(results.every((a) => matchesQuery(a, "games")));
  });

  test("no match returns an empty array, not an error", () => {
    const results = filterAndSortCatalogue(apps, {
      ...NO_FILTER,
      search: "zzz_no_such_app_zzz",
    });
    assert.deepEqual(results, []);
  });

  test("whitespace-only search behaves like no search", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, search: "   " });
    assert.equal(results.length, 272);
  });
});

group("category filter — all 8 categories", () => {
  for (const category of CATEGORIES) {
    test(`category="${category}" returns only apps in that category`, () => {
      const results = filterAndSortCatalogue(apps, { ...NO_FILTER, category });
      const expectedCount = apps.filter((a) => a.category === category).length;
      assert.ok(expectedCount > 0, `fixture must contain apps in "${category}"`);
      assert.equal(results.length, expectedCount);
      assert.ok(results.every((a) => a.category === category));
    });
  }

  test("an unknown category returns an empty array", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, category: "NotACategory" });
    assert.deepEqual(results, []);
  });
});

group("source filter", () => {
  for (const source of SOURCE_FILTERS) {
    test(`source="${source}"`, () => {
      const results = filterAndSortCatalogue(apps, { ...NO_FILTER, source });
      if (source === "all") {
        assert.equal(results.length, 272);
      } else {
        const expectedCount = apps.filter((a) => a.sourceType === source).length;
        assert.ok(expectedCount > 0, `fixture must contain "${source}" apps`);
        assert.equal(results.length, expectedCount);
        assert.ok(results.every((a) => a.sourceType === source));
      }
    });
  }
});

group("android filter — all 5 levels", () => {
  for (const level of ANDROID_LEVELS) {
    test(`android="${level}" excludes apps requiring a higher version`, () => {
      const deviceLevel = androidLevel(level);
      const results = filterAndSortCatalogue(apps, { ...NO_FILTER, android: level });
      assert.ok(results.length > 0);
      assert.ok(results.every((a) => androidLevel(a.minAndroid) <= deviceLevel));
      // Every excluded app must actually require more than the device offers.
      const excluded = apps.filter((a) => !results.some((r) => r.id === a.id));
      assert.ok(excluded.every((a) => androidLevel(a.minAndroid) > deviceLevel));
    });
  }
});

group("sort modes — all 5", () => {
  test("sort=downloads orders by downloadCount descending", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, sort: "downloads" });
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].downloadCount >= results[i].downloadCount);
    }
  });

  test("sort=newest orders by createdAt descending", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, sort: "newest" });
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].createdAt >= results[i].createdAt);
    }
  });

  test("sort=rating orders by rating then ratingCount descending", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, sort: "rating" });
    for (let i = 1; i < results.length; i++) {
      const a = results[i - 1];
      const b = results[i];
      const ra = a.rating ?? 0;
      const rb = b.rating ?? 0;
      assert.ok(ra > rb || (ra === rb && a.ratingCount >= b.ratingCount));
    }
  });

  test("sort=updated orders by lastUpdated descending", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, sort: "updated" });
    for (let i = 1; i < results.length; i++) {
      assert.ok((results[i - 1].lastUpdated ?? "") >= (results[i].lastUpdated ?? ""));
    }
  });

  test("sort=trending (default) orders by trendingScore descending", () => {
    const results = filterAndSortCatalogue(apps, { ...NO_FILTER, sort: "trending" });
    assert.equal(results.length, 272);
    // trendingScore itself is exercised by lib/format's own tests; here we
    // only confirm the default branch actually runs (distinct from raw
    // downloadCount order, proving it isn't silently falling through to
    // "downloads").
    const downloadsOrder = filterAndSortCatalogue(apps, { ...NO_FILTER, sort: "downloads" });
    assert.notDeepEqual(
      results.map((a) => a.id),
      downloadsOrder.map((a) => a.id),
    );
  });
});

group("combined filters", () => {
  test("category + source", () => {
    const results = filterAndSortCatalogue(apps, {
      ...NO_FILTER,
      category: "Games",
      source: "fdroid",
    });
    assert.ok(results.every((a) => a.category === "Games" && a.sourceType === "fdroid"));
  });

  test("category + android", () => {
    const deviceLevel = androidLevel("9.0");
    const results = filterAndSortCatalogue(apps, {
      ...NO_FILTER,
      category: "Tools",
      android: "9.0",
    });
    assert.ok(
      results.every((a) => a.category === "Tools" && androidLevel(a.minAndroid) <= deviceLevel),
    );
  });

  test("search + category", () => {
    const results = filterAndSortCatalogue(apps, {
      ...NO_FILTER,
      search: "manager",
      category: "System",
    });
    assert.ok(results.every((a) => a.category === "System" && matchesQuery(a, "manager")));
  });

  test("source + sort", () => {
    const results = filterAndSortCatalogue(apps, {
      ...NO_FILTER,
      source: "external",
      sort: "downloads",
    });
    assert.ok(results.every((a) => a.sourceType === "external"));
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].downloadCount >= results[i].downloadCount);
    }
  });

  test("category + source + android all together", () => {
    const deviceLevel = androidLevel("11.0");
    const results = filterAndSortCatalogue(apps, {
      ...NO_FILTER,
      category: "Internet",
      source: "fdroid",
      android: "11.0",
    });
    assert.ok(
      results.every(
        (a) =>
          a.category === "Internet" &&
          a.sourceType === "fdroid" &&
          androidLevel(a.minAndroid) <= deviceLevel,
      ),
    );
  });
});

group("no filters", () => {
  test("returns all 272 apps, unfiltered", () => {
    const results = filterAndSortCatalogue(apps, NO_FILTER);
    assert.equal(results.length, 272);
    assert.equal(new Set(results.map((a) => a.id)).size, 272);
  });
});

group("app/layout.tsx and CatalogueSection.tsx source — loading gate / retry shape", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../components/catalogue/CatalogueSection.tsx", import.meta.url)),
    "utf8",
  );

  test("declares the four-state delta loading gate", () => {
    assert.match(src, /"idle" \| "loading" \| "ready" \| "error"/);
  });

  test("retry re-arms loading state before re-fetching", () => {
    const fetchDeltaMatch = src.match(/const fetchDelta = useCallback\(\(\) => \{([\s\S]*?)\}, \[runDeltaFetch\]\);/);
    assert.ok(fetchDeltaMatch, "fetchDelta callback not found");
    assert.match(fetchDeltaMatch![1], /setDeltaState\("loading"\)/);
    assert.match(fetchDeltaMatch![1], /runDeltaFetch\(\)/);
  });

  test("uses the shared mergeCatalogueDelta function rather than an inline copy", () => {
    assert.match(src, /import \{ mergeCatalogueDelta \} from "@\/lib\/catalogue-delta";/);
    assert.match(src, /setAllApps\(\(current\) => mergeCatalogueDelta\(current, deltaApps\)\);/);
  });

  test("catalogue-ready performance mark fires only after a successful merge", () => {
    const thenBlock = src.match(/\.then\(\(\{ apps: deltaApps \}\) => \{([\s\S]*?)\}\)\s*\.catch/);
    assert.ok(thenBlock, "success handler not found");
    assert.match(thenBlock![1], /performance\.mark\("catalogue-ready"\)/);
  });
});
