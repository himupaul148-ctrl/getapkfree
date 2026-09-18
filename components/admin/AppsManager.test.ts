import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * AppsManager imports next/navigation, so it cannot be rendered under plain
 * `node --test` (no React Testing Library / jsdom is configured in this
 * project — see lib/catalogue-client-payload.test.ts and friends for the
 * same constraint on other "use client" files). These are static,
 * source-level assertions proving the display-serial-number column is wired
 * correctly: a "#" header as the first column, numbering derived from the
 * array index of the already filtered `rows` array (never persisted, never
 * a separate id), and every other column/colSpan left consistent.
 */
const src = readFileSync(
  fileURLToPath(new URL("./AppsManager.tsx", import.meta.url)),
  "utf8",
);

group("desktop table — # column", () => {
  test("'#' is the first header, before App", () => {
    const theadMatch = src.match(/<thead[\s\S]*?<\/thead>/);
    assert.ok(theadMatch, "thead not found");
    const thead = theadMatch![0];
    const hashIndex = thead.indexOf('<Th className="w-10">#</Th>');
    const appIndex = thead.indexOf("<Th>App</Th>");
    assert.ok(hashIndex !== -1, "# header not found");
    assert.ok(appIndex !== -1, "App header not found");
    assert.ok(hashIndex < appIndex, "# header must come before the App header");
  });

  test("rows.map exposes the array index, rendered as index + 1 in the first cell", () => {
    assert.match(src, /rows\.map\(\(app, index\) => \(/);
    assert.match(src, /text-xs tabular-nums text-fg-dim">\s*\{index \+ 1\}/);
  });

  test("the number cell precedes the App name cell in the row markup", () => {
    const rowMatch = src.match(/<tr>\s*<td className="px-4 py-3 text-xs tabular-nums text-fg-dim">[\s\S]*?<\/tr>/);
    assert.ok(rowMatch, "numbered row markup not found");
    const numberIdx = rowMatch![0].indexOf("{index + 1}");
    const appLinkIdx = rowMatch![0].indexOf('href={`/app/${app.slug}`}');
    assert.ok(numberIdx < appLinkIdx, "# cell must precede the App cell");
  });

  test("the version-list expansion row's colSpan was updated for the new column (7 -> 8)", () => {
    assert.doesNotMatch(src, /colSpan=\{7\}/, "stale colSpan={7} still present");
    assert.match(src, /colSpan=\{8\}/);
  });
});

group("mobile card list — # indicator", () => {
  test("rows.map exposes the array index on the mobile branch too", () => {
    assert.match(src, /rows\.map\(\(app, index\) => \(\s*<li/);
  });

  test("a compact, subtle number renders ahead of the app name on mobile", () => {
    const mobileMatch = src.match(/<ul className="space-y-3 md:hidden">[\s\S]*?<\/ul>/);
    assert.ok(mobileMatch, "mobile list not found");
    const mobile = mobileMatch![0];
    assert.match(mobile, /shrink-0 text-xs tabular-nums text-fg-dim">\s*\{index \+ 1\}/);
    // Subtle + compact: no large text size utility, no dedicated full-width row.
    assert.doesNotMatch(mobile, /\{index \+ 1\}[\s\S]{0,40}text-(lg|xl|2xl)/);
  });

  test("existing mobile fields (name, package, badges, actions) are all still present", () => {
    const mobileMatch = src.match(/<ul className="space-y-3 md:hidden">[\s\S]*?<\/ul>\s*<\/>/);
    assert.ok(mobileMatch, "mobile list not found");
    const mobile = mobileMatch![0];
    assert.match(mobile, /app\.packageName/);
    assert.match(mobile, /<SourceBadge/);
    assert.match(mobile, /<Actions/);
  });
});

group("no persistence, no schema/query changes", () => {
  test("numbering is computed inline from the array index — no new state, no storage call", () => {
    assert.doesNotMatch(src, /localStorage/);
    assert.doesNotMatch(src, /sessionStorage/);
    assert.doesNotMatch(src, /useState\(0\).*serial/i);
  });

  test("the filter/sort logic that produces `rows` is untouched (same filter predicate as before)", () => {
    assert.match(
      src,
      /if \(status === "unpublished" && app\.publishedCount > 0\) return false;/,
    );
    assert.match(
      src,
      /app\.name\.toLowerCase\(\)\.includes\(needle\)/,
    );
  });
});
