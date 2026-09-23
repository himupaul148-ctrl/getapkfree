import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * components/catalogue/CategoryAppList.tsx — this project's plain
 * `node --test` runner has no JSX transform, so the component can't be
 * imported directly (same constraint documented throughout, e.g.
 * lib/header-search-component.test.ts for HeaderSearch/SiteHeader).
 *
 * Covers the category-page redesign: the plain text-row list was replaced
 * with the same AppCard the interactive catalogue grid already uses, so
 * this asserts that swap happened and that the surrounding crawlable
 * pagination (real <Link href> per page, real ?category=X&page=N URLs) is
 * still intact — that's the part search engines depend on, and it must
 * survive the visual redesign unchanged.
 */

const src = readFileSync(
  fileURLToPath(new URL("../components/catalogue/CategoryAppList.tsx", import.meta.url)),
  "utf8",
);

group("CategoryAppList — redesigned to reuse AppCard", () => {
  test("imports and renders the shared AppCard component, not its own row markup", () => {
    assert.match(src, /import AppCard from "@\/components\/AppCard";/);
    assert.match(src, /<AppCard key=\{app\.id\} app=\{app\} \/>/);
  });

  test("no longer hand-rolls its own <a>/<Link> row per app", () => {
    // The only remaining Link usages should be the pagination controls below,
    // not one per app row.
    const appMapBlock = src.slice(src.indexOf("apps.map"), src.indexOf("{totalPages > 1"));
    assert.doesNotMatch(appMapBlock, /<Link/);
    assert.doesNotMatch(appMapBlock, /href=\{`\/app\//);
  });
});

group("CategoryAppList — crawlable pagination preserved", () => {
  test("still a plain server component (no \"use client\") — stays crawlable with zero JS", () => {
    assert.doesNotMatch(src, /^"use client";/m);
  });

  test("still builds real ?category=X&page=N URLs for every page, not a client-only pager", () => {
    assert.match(src, /const qs = new URLSearchParams\(\{ category \}\);/);
    assert.match(src, /qs\.set\("page", String\(target\)\)/);
  });

  test("PAGE_SIZE still matches CatalogueSection's own page size (24)", () => {
    assert.match(src, /export const PAGE_SIZE = 24;/);
  });
});
