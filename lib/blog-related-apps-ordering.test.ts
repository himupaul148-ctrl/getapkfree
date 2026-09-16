import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions that getRelatedApps() (lib/blog.ts) is
 * actually wired to the ordering fix — the real behavioral proof that the
 * fix works lives in lib/related-apps-order.test.ts, which tests
 * orderAndLimitRelatedApps() directly. lib/blog.ts itself can't be
 * imported here — it imports `unstable_cache` from "next/cache", the same
 * resolution constraint documented throughout this project (see
 * lib/catalogue.test.ts, lib/blog-error-handling.test.ts).
 */

const src = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const match = src.match(
    new RegExp(`export async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("getRelatedApps — the ordering bug fix", () => {
  const body = bodyOf("getRelatedApps");

  test("imports orderAndLimitRelatedApps from lib/related-apps-order", () => {
    assert.match(
      src,
      /import\s*\{\s*orderAndLimitRelatedApps\s*\}\s*from\s*"@\/lib\/related-apps-order"/,
    );
  });

  test("the related-apps .in() query carries no .limit() before ordering runs", () => {
    const queryBlock = body.match(/const \{ data \} = await supabase[\s\S]*?\.in\("id", ids\)[\s\S]*?\.returns</);
    assert.ok(queryBlock, "the .in(\"id\", ids) query was not found");
    assert.doesNotMatch(
      queryBlock![0],
      /\.limit\(/,
      "a .limit() before ordering would let Postgres pick an arbitrary subset — this is exactly the bug being fixed",
    );
  });

  test("calls orderAndLimitRelatedApps(data, ids, limit) rather than a second, inline sort", () => {
    assert.match(body, /orderAndLimitRelatedApps\(data, ids, limit\)/);
    // No re-implementation of the sort/slice logic left inline.
    assert.doesNotMatch(body, /\.sort\(/);
    assert.doesNotMatch(body, /\.slice\(0, limit\)/);
  });

  test("the empty-related_app_ids fallback path is unchanged: still a single DB-side .limit(limit), ordered by download_count", () => {
    const fallbackStart = body.indexOf("const { data } = await supabase", body.indexOf("orderAndLimitRelatedApps"));
    const fallback = body.slice(fallbackStart);
    assert.match(fallback, /\.order\("download_count", \{ ascending: false \}\)/);
    assert.match(fallback, /\.limit\(limit\)/);
    assert.match(fallback, /fallback: true/);
  });

  test("return shape is unchanged: { apps, fallback }", () => {
    assert.match(body, /return \{ apps: ordered\.map\(toSummary\), fallback: false \};/);
    assert.match(body, /return \{ apps: \(data \?\? \[\]\)\.map\(toSummary\), fallback: true \};/);
  });

  test("the ids.length > 0 gate is unchanged — 0 related ids still fall straight through to the existing fallback", () => {
    assert.match(body, /if \(ids\.length > 0\) \{/);
  });
});
