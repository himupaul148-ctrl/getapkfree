import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against getTargetApp() and
 * getPostBySlug()'s new columns (lib/blog.ts) — Phase 5's public data-flow
 * layer for the three-type blog system: resolving an APP_RELATED post's
 * target_app_id to the small set of fields its "About this app" reference
 * needs. Same import-time constraint as every other lib/blog.ts test in
 * this project (next/cache, a real Supabase client at module scope).
 */

const src = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");

function bodyOf(fnName: string): string {
  const match = src.match(
    new RegExp(`export async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found in lib/blog.ts`);
  return match![0];
}

group("getPostBySlug now also selects article_type/target_app_id", () => {
  const body = bodyOf("getPostBySlug");

  test("the select includes article_type and target_app_id alongside the existing LIST_COLUMNS/content", () => {
    assert.match(body, /\.select\(`\$\{LIST_COLUMNS\}, content, article_type, target_app_id`\)/);
  });

  test("no other part of the query changed — still filters slug/published, still .maybeSingle()", () => {
    assert.match(body, /\.eq\("slug", slug\)/);
    assert.match(body, /\.eq\("published", true\)/);
    assert.match(body, /\.maybeSingle<BlogPost>\(\)/);
  });
});

group("getTargetApp exists and is exported", () => {
  test("takes a targetAppId and returns TargetAppLink | null", () => {
    assert.match(
      src,
      /export async function getTargetApp\(targetAppId: string\): Promise<TargetAppLink \| null>/,
    );
  });

  test("TargetAppLink carries the compact reference's fields (id, name, slug, icon_url) plus the three-distinct-layouts task's APP FACTS fields (category, developer_name, package_name, source_type, external_url, license, latest_version, min_android_version) — still never the full App record (no screenshots/permissions/full version history)", () => {
    assert.match(src, /export type TargetAppLink = \{\s*\n\s*id: string;\s*\n\s*name: string;\s*\n\s*slug: string;\s*\n\s*icon_url: string \| null;\s*\n\s*category: string \| null;\s*\n\s*developer_name: string \| null;\s*\n\s*package_name: string;\s*\n\s*source_type: SourceType;\s*\n\s*external_url: string \| null;\s*\n\s*license: string \| null;\s*\n\s*latest_version: string \| null;\s*\n\s*min_android_version: string \| null;\s*\n\s*\};/);
    assert.doesNotMatch(src.match(/export type TargetAppLink = \{[\s\S]*?\n\};/)![0], /screenshots|permissions|version_history/i);
  });
});

group("selects a narrow column set, bounded to a single row", () => {
  const body = bodyOf("getTargetApp");

  test("selects exactly the app-level facts fields plus a joined versions() for the latest version, from apps", () => {
    assert.match(
      body,
      /\.select\(\s*\n\s*"id, name, slug, icon_url, category, developer_name, package_name, source_type, external_url, license, versions\(version_name, version_code, min_android_version\)",\s*\n\s*\)/,
    );
  });

  test("filters by id and uses .maybeSingle() — a single-row lookup, not a list", () => {
    assert.match(body, /\.eq\("id", targetAppId\)/);
    assert.match(body, /\.maybeSingle<TargetAppRow>\(\)/);
  });

  test("issues exactly one .from(\"apps\") call", () => {
    const fromCalls = [...body.matchAll(/\.from\("apps"\)/g)];
    assert.equal(fromCalls.length, 1);
  });

  test("derives the latest version via the shared latestVersion() helper (picks by version_code), not a hand-rolled sort", () => {
    assert.match(body, /const latest = latestVersion\(data\.versions \?\? \[\]\);/);
    assert.match(src, /import \{ latestVersion \} from "@\/lib\/format";/);
  });
});

group("fails gracefully rather than throwing — a missing/deleted target app must never break the article", () => {
  const body = bodyOf("getTargetApp");

  test("does NOT use resolveQueryResult (the throw-on-error helper every other function in this file uses)", () => {
    assert.doesNotMatch(body, /resolveQueryResult/);
  });

  test("a genuine Supabase error is logged and resolves to null, not thrown", () => {
    assert.match(body, /if \(error\) \{\s*\n\s*console\.error\(`getTargetApp: Supabase query failed for app "\$\{targetAppId\}"`, error\);\s*\n\s*return null;\s*\n\s*\}/);
  });

  test("a genuinely missing app (deleted, or an id that never existed) also resolves to null via .maybeSingle()'s own null data, not a fabricated fallback app", () => {
    assert.match(body, /if \(!data\) return null;/);
    // No fallback-to-another-app logic like getRelatedApps() has for its
    // own, different "no related apps named" case.
    assert.doesNotMatch(body, /fallback/);
  });
});

group("uses the public, cookie-less client — no admin/service-role client", () => {
  test("reads through the same public `supabase` import as every other function in this file", () => {
    assert.match(src, /import \{ supabase \} from "@\/lib\/supabase\/public";/);
    assert.doesNotMatch(src, /service.?role/i);
  });
});
