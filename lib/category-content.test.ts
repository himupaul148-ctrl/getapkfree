import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { CATEGORIES } from "./types.ts";
import {
  categoryIntro,
  categoryListicle,
  CATEGORY_INTRO,
  CATEGORY_LISTICLE,
  isCategory,
} from "./category-content.ts";

/**
 * Covers the P0-2 GEO finding: category browse views had one hardcoded intro
 * paragraph shared across all 8 categories and no reverse link to the 5
 * "best open-source X" listicles whose content was verified (during the
 * audit) to actually match that category's apps.
 */

const VERIFIED_LISTICLE_CATEGORIES = [
  "Games",
  "Productivity",
  "Multimedia",
  "Internet",
  "System",
] as const;

const NO_LISTICLE_CATEGORIES = ["Tools", "Education", "Writing"] as const;

group("CATEGORY_INTRO", () => {
  test("every current category has an intro", () => {
    for (const category of CATEGORIES) {
      assert.ok(
        category in CATEGORY_INTRO,
        `missing intro for category: ${category}`,
      );
    }
  });

  test("every intro is non-empty, trimmed prose", () => {
    for (const category of CATEGORIES) {
      const intro = CATEGORY_INTRO[category];
      assert.equal(typeof intro, "string");
      assert.ok(intro.trim().length > 0, `empty intro for: ${category}`);
      assert.equal(intro, intro.trim(), `untrimmed intro for: ${category}`);
    }
  });

  test("there is no intro for a category that does not exist", () => {
    const keys = Object.keys(CATEGORY_INTRO);
    assert.equal(keys.length, CATEGORIES.length);
    for (const key of keys) {
      assert.ok(
        (CATEGORIES as readonly string[]).includes(key),
        `unexpected extra category key: ${key}`,
      );
    }
  });
});

group("CATEGORY_LISTICLE", () => {
  test("only the 5 verified categories have a listicle mapping", () => {
    const keys = Object.keys(CATEGORY_LISTICLE).sort();
    assert.deepEqual(keys, [...VERIFIED_LISTICLE_CATEGORIES].sort());
  });

  test("Tools, Education, and Writing have no listicle mapping", () => {
    for (const category of NO_LISTICLE_CATEGORIES) {
      assert.equal(
        CATEGORY_LISTICLE[category],
        undefined,
        `${category} should not have a listicle mapping yet`,
      );
    }
  });

  test("each mapped listicle slug matches the verified slug exactly", () => {
    const expectedSlugs: Record<
      (typeof VERIFIED_LISTICLE_CATEGORIES)[number],
      string
    > = {
      Games: "best-open-source-games-android",
      Productivity: "best-open-source-productivity-apps-android",
      Multimedia: "best-open-source-multimedia-apps-android",
      Internet: "best-open-source-internet-networking-apps-android",
      System: "best-open-source-privacy-security-apps-android",
    };

    for (const category of VERIFIED_LISTICLE_CATEGORIES) {
      assert.equal(CATEGORY_LISTICLE[category]?.slug, expectedSlugs[category]);
    }
  });

  test("every mapping has non-empty anchor text", () => {
    for (const category of VERIFIED_LISTICLE_CATEGORIES) {
      const anchorText = CATEGORY_LISTICLE[category]?.anchorText;
      assert.equal(typeof anchorText, "string");
      assert.ok((anchorText ?? "").trim().length > 0);
    }
  });

  test("the System mapping's anchor text names privacy/security, not the literal word 'System'", () => {
    const anchorText = CATEGORY_LISTICLE.System?.anchorText ?? "";
    assert.match(anchorText, /privacy|security/i);
  });

  test("no mapping exists for a category outside the current 8", () => {
    for (const key of Object.keys(CATEGORY_LISTICLE)) {
      assert.ok(
        (CATEGORIES as readonly string[]).includes(key),
        `listicle mapping for unknown category: ${key}`,
      );
    }
  });
});

group("isCategory / categoryIntro / categoryListicle (the safe accessors app/page.tsx uses)", () => {
  test("an empty string (no category filter) is not a category", () => {
    assert.equal(isCategory(""), false);
    assert.equal(categoryIntro(""), null);
    assert.equal(categoryListicle(""), null);
  });

  test("an unrecognised value is not a category", () => {
    assert.equal(isCategory("Not A Real Category"), false);
    assert.equal(categoryIntro("Not A Real Category"), null);
  });

  test("every real category resolves to its exact intro string", () => {
    for (const category of CATEGORIES) {
      assert.equal(isCategory(category), true);
      assert.equal(categoryIntro(category), CATEGORY_INTRO[category]);
    }
  });

  test("categoryListicle matches CATEGORY_LISTICLE exactly, including the absence for Tools/Education/Writing", () => {
    for (const category of CATEGORIES) {
      assert.deepEqual(categoryListicle(category), CATEGORY_LISTICLE[category] ?? null);
    }
  });
});
