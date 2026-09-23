import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { CATEGORIES } from "./types.ts";
import type { Category } from "./category-content.ts";
import { BLOG_CATEGORIES, type BlogCategory } from "./blog-categories.ts";
import {
  BLOG_TO_APP_CATEGORY,
  getAppCategoryForBlogCategory,
  getBlogCategoryForAppCategory,
} from "./blog-app-category-mapping.ts";

/**
 * Phase 1 Task 6: the single, explicit blog-category -> app-category
 * relationship. Pure, dependency-free module (both its own imports are
 * type-only, so it has zero runtime imports at all) — real behavioral tests
 * run directly under `node --test`, the same convention
 * lib/category-content.test.ts already established for the equivalent
 * CATEGORY_LISTICLE partial-mapping shape.
 */

group("the four intentional mappings", () => {
  test("privacy -> System", () => {
    assert.equal(getAppCategoryForBlogCategory("privacy"), "System");
  });

  test("productivity -> Productivity", () => {
    assert.equal(getAppCategoryForBlogCategory("productivity"), "Productivity");
  });

  test("gaming -> Games", () => {
    assert.equal(getAppCategoryForBlogCategory("gaming"), "Games");
  });

  test("tools -> Tools", () => {
    assert.equal(getAppCategoryForBlogCategory("tools"), "Tools");
  });
});

group("intentionally unmapped blog categories", () => {
  test("guides -> undefined", () => {
    assert.equal(getAppCategoryForBlogCategory("guides"), undefined);
  });

  test("news -> undefined", () => {
    assert.equal(getAppCategoryForBlogCategory("news"), undefined);
  });

  test("guides and news are absent as keys entirely, not present with an undefined/null value", () => {
    // Distinguishes "the key genuinely isn't there" from "it's there but
    // empty" — the mapping must never grow a placeholder entry for these.
    assert.equal("guides" in BLOG_TO_APP_CATEGORY, false);
    assert.equal("news" in BLOG_TO_APP_CATEGORY, false);
  });
});

group("no mapping was invented for an unsupported pair", () => {
  test("no key exists in BLOG_TO_APP_CATEGORY beyond the four intentional ones", () => {
    assert.deepEqual(
      Object.keys(BLOG_TO_APP_CATEGORY).sort(),
      ["gaming", "privacy", "productivity", "tools"].sort(),
    );
  });

  test("multimedia/internet/education/writing app categories never appear as a mapped value (no blog category was forced onto them)", () => {
    const mappedValues = Object.values(BLOG_TO_APP_CATEGORY);
    for (const unsupported of ["Multimedia", "Internet", "Education", "Writing"]) {
      assert.equal(mappedValues.includes(unsupported as never), false);
    }
  });
});

group("(7) invalid category input is not silently treated as a valid mapping", () => {
  test("a string that is not a real BlogCategory resolves to undefined, never one of the four real app categories by accident", () => {
    // Simulates a caller that bypassed static typing (e.g. an unchecked
    // string from a URL or a stale client) — rejecting this value is the
    // existing category-validation system's job (BLOG_CATEGORIES.includes(),
    // lib/blog.ts's normaliseBlogCategory()), not this function's; what this
    // proves is that failing to reject it first can't accidentally produce a
    // real-looking mapping instead of a clear "nothing here".
    const notARealBlogCategory = "sports" as BlogCategory;
    assert.equal(getAppCategoryForBlogCategory(notARealBlogCategory), undefined);
  });

  test("an empty string is not silently mapped to anything", () => {
    assert.equal(getAppCategoryForBlogCategory("" as BlogCategory), undefined);
  });
});

group("(8) the mapping contains no unsupported app categories", () => {
  test("every mapped value is a real, current app category from lib/types.ts", () => {
    for (const value of Object.values(BLOG_TO_APP_CATEGORY)) {
      assert.ok(
        (CATEGORIES as readonly string[]).includes(value as string),
        `mapped value "${value}" is not one of the current app categories`,
      );
    }
  });

  test("every mapped key is a real, current blog category from lib/blog-categories.ts", () => {
    for (const key of Object.keys(BLOG_TO_APP_CATEGORY)) {
      assert.ok(
        (BLOG_CATEGORIES as readonly string[]).includes(key),
        `mapped key "${key}" is not one of the current blog categories`,
      );
    }
  });
});

group("(9) the helper reads from the single exported mapping — not a second, hand-written lookup", () => {
  test("getAppCategoryForBlogCategory(key) equals BLOG_TO_APP_CATEGORY[key] for every mapped key", () => {
    for (const key of Object.keys(BLOG_TO_APP_CATEGORY) as BlogCategory[]) {
      assert.equal(getAppCategoryForBlogCategory(key), BLOG_TO_APP_CATEGORY[key]);
    }
  });

  test("every BLOG_CATEGORIES member resolves through the helper without throwing, mapped or not", () => {
    for (const category of BLOG_CATEGORIES) {
      assert.doesNotThrow(() => getAppCategoryForBlogCategory(category));
    }
  });
});

/**
 * Phase 1 Task 7: the reverse direction (an app category page looking up its
 * blog category), derived from BLOG_TO_APP_CATEGORY rather than a second,
 * hand-written table — see getBlogCategoryForAppCategory's own doc comment.
 */

group("the reverse direction — the four intentional mappings", () => {
  test("System -> privacy", () => {
    assert.equal(getBlogCategoryForAppCategory("System"), "privacy");
  });

  test("Productivity -> productivity", () => {
    assert.equal(getBlogCategoryForAppCategory("Productivity"), "productivity");
  });

  test("Games -> gaming", () => {
    assert.equal(getBlogCategoryForAppCategory("Games"), "gaming");
  });

  test("Tools -> tools", () => {
    assert.equal(getBlogCategoryForAppCategory("Tools"), "tools");
  });
});

group("the reverse direction — unmapped app categories", () => {
  test("Multimedia -> undefined", () => {
    assert.equal(getBlogCategoryForAppCategory("Multimedia"), undefined);
  });

  test("Internet -> undefined", () => {
    assert.equal(getBlogCategoryForAppCategory("Internet"), undefined);
  });

  test("Education -> undefined", () => {
    assert.equal(getBlogCategoryForAppCategory("Education"), undefined);
  });

  test("Writing -> undefined", () => {
    assert.equal(getBlogCategoryForAppCategory("Writing"), undefined);
  });

  test("no reverse mapping was invented for any of the four unmapped app categories", () => {
    for (const category of ["Multimedia", "Internet", "Education", "Writing"] as Category[]) {
      assert.equal(getBlogCategoryForAppCategory(category), undefined);
    }
  });
});

group("the reverse helper derives from BLOG_TO_APP_CATEGORY — no second hardcoded table", () => {
  test("every forward mapping round-trips through the reverse helper", () => {
    for (const [blogCategory, appCategory] of Object.entries(BLOG_TO_APP_CATEGORY) as [
      BlogCategory,
      Category,
    ][]) {
      assert.equal(getBlogCategoryForAppCategory(appCategory), blogCategory);
    }
  });

  test("every current app category resolves through the helper without throwing, mapped or not", () => {
    for (const category of CATEGORIES) {
      assert.doesNotThrow(() => getBlogCategoryForAppCategory(category));
    }
  });

  test("exactly 4 of the 8 app categories have a reverse mapping — matching BLOG_TO_APP_CATEGORY's own size", () => {
    const mapped = CATEGORIES.filter(
      (category) => getBlogCategoryForAppCategory(category) !== undefined,
    );
    assert.equal(mapped.length, Object.keys(BLOG_TO_APP_CATEGORY).length);
  });
});
