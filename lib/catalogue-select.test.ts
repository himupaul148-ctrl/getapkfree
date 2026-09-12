import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * P3-3: getAppBySlug (lib/catalogue.ts) and getRelatedApps (lib/blog.ts)
 * used to select("*") from the `apps` table. Neither module can be imported
 * here to check its exported constants directly — lib/catalogue.ts imports
 * `unstable_cache` from "next/cache", which plain `node --test` (no bundler,
 * no path-alias resolution) cannot resolve, confirmed while building P3-2's
 * tests. So these are static, source-level assertions: read each file's own
 * text and check the query-building code it actually contains — the same
 * technique this project already relies on wherever a server-only module
 * can't be exercised directly under node:test.
 */

const catalogueSrc = readFileSync(
  fileURLToPath(new URL("./catalogue.ts", import.meta.url)),
  "utf8",
);
const blogSrc = readFileSync(
  fileURLToPath(new URL("./blog.ts", import.meta.url)),
  "utf8",
);

// Every column lib/types.ts's App type declares — the full set getAppBySlug
// must still provide, since app/app/[slug]/page.tsx, AppJsonLd
// (lib/app-json-ld.ts) and the SEO helpers it calls all type their input as
// App. Traced field-by-field against every one of those call sites.
const APP_TYPE_FIELDS = [
  "id",
  "name",
  "slug",
  "package_name",
  "category",
  "description",
  "icon_url",
  "developer_name",
  "created_at",
  "download_count",
  "screenshots",
  "rating",
  "rating_count",
  "source_type",
  "external_url",
  "hosted_locally",
  "license",
];

group("lib/catalogue.ts — getAppBySlug no longer selects everything", () => {
  test('fetchAppBySlug (the apps-table query) no longer contains select("*")', () => {
    const fn = catalogueSrc.match(/async function fetchAppBySlug[\s\S]*?\n}/);
    assert.ok(fn, "fetchAppBySlug not found in lib/catalogue.ts");
    assert.doesNotMatch(fn![0], /\.select\(\s*"\*"\s*\)/);
  });

  test("fetchPublishedVersions (out of scope for P3-3 — a different table, a different task) is untouched", () => {
    // Confirms this change didn't accidentally widen scope to the versions
    // table query, which P3-2 already covers for memoization and which no
    // audit finding asked this task to touch.
    assert.match(
      catalogueSrc,
      /async function fetchPublishedVersions[\s\S]*?\.select\("\*"\)/,
    );
  });

  test("APP_DETAIL_SELECT names every field the App type declares, and nothing else", () => {
    const match = catalogueSrc.match(/const APP_DETAIL_SELECT =\s*\n?\s*"([^"]+)"/);
    assert.ok(match, "APP_DETAIL_SELECT constant not found in lib/catalogue.ts");
    const columns = match![1].split(",").map((c) => c.trim());

    for (const field of APP_TYPE_FIELDS) {
      assert.ok(columns.includes(field), `APP_DETAIL_SELECT is missing "${field}"`);
    }
    assert.equal(
      columns.length,
      APP_TYPE_FIELDS.length,
      "APP_DETAIL_SELECT has columns beyond the App type's declared fields (e.g. manual_fields)",
    );
  });

  test("fetchAppBySlug's query uses APP_DETAIL_SELECT", () => {
    assert.match(
      catalogueSrc,
      /async function fetchAppBySlug[\s\S]*?\.select\(APP_DETAIL_SELECT\)/,
    );
  });

  test("APP_SUMMARY_SELECT stays exported for lib/blog.ts to reuse", () => {
    assert.match(catalogueSrc, /export const APP_SUMMARY_SELECT =/);
  });

  test("getCatalogue and getRelatedApps (catalogue.ts) still select via APP_SUMMARY_SELECT — unrelated query behavior unchanged", () => {
    const occurrences = catalogueSrc.match(/\.select\(APP_SUMMARY_SELECT\)/g) ?? [];
    assert.equal(occurrences.length, 2, "expected fetchCatalogue and getRelatedApps to both use APP_SUMMARY_SELECT");
  });
});

group("lib/blog.ts — getRelatedApps no longer selects everything", () => {
  test('no select("*") remains anywhere in the file', () => {
    assert.doesNotMatch(blogSrc, /\.select\(\s*"\*"\s*\)/);
  });

  test("no local APP_SELECT constant remains — the shared catalogue list is reused instead", () => {
    assert.doesNotMatch(blogSrc, /const APP_SELECT =/);
  });

  test("both of getRelatedApps's queries (named-ids path and most-downloaded fallback) select via the imported APP_SUMMARY_SELECT", () => {
    const occurrences = blogSrc.match(/\.select\(APP_SUMMARY_SELECT\)/g) ?? [];
    assert.equal(occurrences.length, 2);
  });

  test("imports APP_SUMMARY_SELECT from lib/catalogue.ts rather than redefining it", () => {
    assert.match(
      blogSrc,
      /import\s*\{[^}]*APP_SUMMARY_SELECT[^}]*\}\s*from\s*"@\/lib\/catalogue"/,
    );
  });

  test("the versions(...) embed on APP_SUMMARY_SELECT is unchanged — same columns as before", () => {
    // Pinned here too (not just in catalogue.ts's own test) since
    // lib/blog.ts's getRelatedApps depends on this embed shape for the
    // toSummary() call it shares with lib/catalogue.ts.
    assert.match(
      catalogueSrc,
      /versions\(version_name, version_code, file_size, min_android_version, uploaded_at, scanned_at, scan_status\)/,
    );
  });
});
