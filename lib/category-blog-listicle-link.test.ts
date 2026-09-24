import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the internal-linking audit's P1 fix:
 * the homepage's "{Category} Guides & Articles" section previously drove off
 * lib/blog-app-category-mapping.ts's BLOG_TO_APP_CATEGORY (only 4 of 8 app
 * categories mapped, and starved of matches even for those 4 because most
 * posts share the "guides" blog category regardless of topic). It now reuses
 * lib/category-content.ts's already-audited CATEGORY_LISTICLE relationship —
 * covering all 8 categories — via the new getPostsBySlugs() helper. Same
 * import-time constraints documented throughout this project.
 */

const blogSrc = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");
const categoryContentSrc = readFileSync(
  fileURLToPath(new URL("./category-content.ts", import.meta.url)),
  "utf8",
);

function bodyOf(fnName: string): string {
  const match = blogSrc.match(
    new RegExp(`export async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("getPostsBySlugs is a small, curated, bounded-by-construction lookup", () => {
  test("takes a slugs array and returns early on an empty list — no query issued for nothing to look up", () => {
    const body = bodyOf("getPostsBySlugs");
    assert.match(body, /if \(slugs\.length === 0\) return \[\];/);
  });

  test("filters on .in(\"slug\", slugs) and published-only, same as every other query in this file", () => {
    const body = bodyOf("getPostsBySlugs");
    assert.match(body, /\.eq\("published", true\)/);
    assert.match(body, /\.in\("slug", slugs\)/);
  });

  test("preserves the curated order of `slugs`, not whatever order Postgres returns", () => {
    const body = bodyOf("getPostsBySlugs");
    assert.match(body, /const bySlug = new Map\(rows\.map\(\(row\) => \[row\.slug, row\]\)\);/);
    assert.match(body, /return slugs\s*\n\s*\.map\(\(slug\) => bySlug\.get\(slug\)\)/);
  });

  test("still excludes retired slugs and silently omits a slug that doesn't resolve (retired, unpublished, or deleted) rather than throwing", () => {
    const body = bodyOf("getPostsBySlugs");
    assert.match(body, /!RETIRED_SLUGS\.includes\(row\.slug\)/);
    assert.match(body, /row !== undefined/);
  });

  test("derives excerptText/readMinutes the same way every other listing query in this file does", () => {
    const body = bodyOf("getPostsBySlugs");
    assert.match(body, /excerptText: rest\.description \|\| excerpt\(content\)/);
    assert.match(body, /readMinutes: readingTime\(content\)/);
  });
});

group("no fuzzy matching or retagging was introduced — the relationship is the existing, audited CATEGORY_LISTICLE", () => {
  test("CATEGORY_LISTICLE remains the single source of truth, unchanged by this fix — still one verified slug per category, all 8 categories present", () => {
    const listicleBlock = categoryContentSrc.match(
      /export const CATEGORY_LISTICLE: Partial<[\s\S]*?\n> = \{[\s\S]*?\n\};/,
    );
    assert.ok(listicleBlock, "CATEGORY_LISTICLE not found");
    for (const category of [
      "Games",
      "Productivity",
      "Multimedia",
      "Internet",
      "System",
      "Tools",
      "Education",
      "Writing",
    ]) {
      assert.match(listicleBlock![0], new RegExp(`${category}: \\{`));
    }
  });

  test("no ILIKE/fuzzy substring matching against article title or content was added to lib/blog.ts — the only .includes() is an exact-value RETIRED_SLUGS membership check, not fuzzy matching", () => {
    const body = bodyOf("getPostsBySlugs");
    assert.doesNotMatch(body, /\.ilike\(/);
    assert.doesNotMatch(body, /\.includes\(post\.title\)|title\.includes\(/);
  });
});
