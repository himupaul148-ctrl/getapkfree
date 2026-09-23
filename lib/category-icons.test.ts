import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { CATEGORIES } from "./types.ts";
import { CATEGORY_ICON_PATHS, CATEGORY_TINTS } from "./category-icons.ts";

/**
 * The category-page hero (app/page.tsx) and the homepage's Popular
 * Categories grid (components/catalogue/CategoryCards.tsx) both read these
 * maps keyed by the current 8 categories — a missing entry would render an
 * empty icon tile for that category rather than failing loudly, so
 * completeness is worth asserting directly rather than only exercising it
 * through a rendered page.
 */

group("CATEGORY_ICON_PATHS", () => {
  test("every current category has an icon path", () => {
    for (const category of CATEGORIES) {
      assert.ok(
        category in CATEGORY_ICON_PATHS,
        `missing icon path for category: ${category}`,
      );
    }
  });

  test("every icon path is non-empty, valid-looking SVG path data", () => {
    for (const category of CATEGORIES) {
      const d = CATEGORY_ICON_PATHS[category];
      assert.equal(typeof d, "string");
      assert.ok(d.trim().length > 0, `empty icon path for: ${category}`);
      // Every path in this project's icon set starts with an SVG path command.
      assert.match(d, /^[MmLlHhVvCcSsQqTtAaZz]/, `not valid path data: ${category}`);
    }
  });

  test("no icon path exists for a category outside the current 8", () => {
    const keys = Object.keys(CATEGORY_ICON_PATHS);
    assert.equal(keys.length, CATEGORIES.length);
    for (const key of keys) {
      assert.ok(
        (CATEGORIES as readonly string[]).includes(key),
        `unexpected extra category key: ${key}`,
      );
    }
  });
});

group("CATEGORY_TINTS", () => {
  test("every current category has a tint with both bg and text classes", () => {
    for (const category of CATEGORIES) {
      const tint = CATEGORY_TINTS[category];
      assert.ok(tint, `missing tint for category: ${category}`);
      assert.ok(tint.bg.trim().length > 0, `empty bg class for: ${category}`);
      assert.ok(tint.text.trim().length > 0, `empty text class for: ${category}`);
    }
  });

  test("every category has a distinct tint (no two categories share the same colour)", () => {
    const bgClasses = CATEGORIES.map((c) => CATEGORY_TINTS[c].bg);
    assert.equal(new Set(bgClasses).size, CATEGORIES.length);
  });

  test("no tint exists for a category outside the current 8", () => {
    const keys = Object.keys(CATEGORY_TINTS);
    assert.equal(keys.length, CATEGORIES.length);
    for (const key of keys) {
      assert.ok(
        (CATEGORIES as readonly string[]).includes(key),
        `unexpected extra category key: ${key}`,
      );
    }
  });
});
