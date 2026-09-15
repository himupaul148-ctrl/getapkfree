import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * app/api/admin/blog/publish/route.ts — this project's plain `node --test`
 * runner can't import it directly, since it imports `next/server` (confirmed
 * unresolvable under plain node, the same class of constraint documented
 * throughout this project for `next/cache`). The behavioral part of this
 * fix — actual validation logic — lives in lib/blog-related-app-ids.ts and
 * is tested directly and behaviorally in lib/blog-related-app-ids.test.ts;
 * this file only proves the route is actually wired up to use it correctly.
 *
 * Covers the fix for the real production bug where 34 of 36 published
 * posts had an empty related_app_ids despite their frontmatter listing real
 * app UUIDs: the route never destructured the field from the request body,
 * so it was silently dropped before ever reaching blog_posts.
 */

const src = readFileSync(
  fileURLToPath(new URL("../../app/api/admin/blog/publish/route.ts", import.meta.url)),
  "utf8",
);

group("the route destructures related_app_ids from the request body", () => {
  test("related_app_ids is destructured alongside the other fields", () => {
    assert.match(
      src,
      /const \{ title, description, content, slug, category, published, related_app_ids \} = body;/,
    );
  });
});

group("the route uses the shared pure validator, never a second copy", () => {
  test("imports validateRelatedAppIds from lib/blog-related-app-ids", () => {
    assert.match(
      src,
      /import \{ validateRelatedAppIds \} from '@\/lib\/blog-related-app-ids';/,
    );
  });

  test("calls it on the destructured field and rejects with 400 on a format error", () => {
    assert.match(
      src,
      /const relatedAppIdsResult = validateRelatedAppIds\(related_app_ids\);/,
    );
    const block = src.match(
      /const relatedAppIdsResult[\s\S]*?if \(!relatedAppIdsResult\.valid\) \{[\s\S]*?status: 400[\s\S]*?\n {4}\}/,
    );
    assert.ok(block, "expected a 400 response when the validator rejects the input");
  });
});

group("the existence check is a single batched query, never one query per ID", () => {
  test("only one .from('apps') call exists in the whole file", () => {
    const fromAppsCalls = [...src.matchAll(/\.from\('apps'\)/g)];
    assert.equal(fromAppsCalls.length, 1, "expected exactly one .from('apps') call — batched, not per-ID");
  });

  test("uses .in('id', ...) against a de-duplicated id list, not a loop", () => {
    assert.match(src, /const uniqueIds = \[\.\.\.new Set\(relatedAppIdsResult\.ids\)\];/);
    assert.match(src, /\.select\('id'\)\s*\n\s*\.in\('id', uniqueIds\);/);
    assert.doesNotMatch(src, /for \([^)]*uniqueIds[^)]*\)/);
    assert.doesNotMatch(src, /uniqueIds\.map\(async/);
  });

  test("only runs the existence check when ids were actually provided and non-empty", () => {
    assert.match(
      src,
      /if \(relatedAppIdsResult\.provided && relatedAppIdsResult\.ids\.length > 0\) \{/,
    );
  });
});

group("a missing app ID rejects the whole request with 400, before any write", () => {
  test("compares the found-id set against every unique requested id", () => {
    assert.match(src, /const foundIds = new Set\(\(foundApps \?\? \[\]\)\.map\(\(app\) => app\.id\)\);/);
    assert.match(src, /const missingIds = uniqueIds\.filter\(\(id\) => !foundIds\.has\(id\)\);/);
  });

  test("returns 400 with the missing IDs when any are not found", () => {
    const block = src.match(/if \(missingIds\.length > 0\) \{[\s\S]*?status: 400[\s\S]*?\n {8}\}/);
    assert.ok(block, "expected a 400 response listing missingIds");
    assert.match(block![0], /missingIds/);
  });

  test("the existence check runs before the existing-post lookup and before any insert/update", () => {
    const existenceCheckIndex = src.indexOf("relatedAppIdsResult.provided && relatedAppIdsResult.ids.length > 0");
    const existingPostIndex = src.indexOf("Check if blog post already exists");
    const insertIndex = src.indexOf(".insert({");
    const updateIndex = src.indexOf(".update(updatePayload)");
    assert.ok(existenceCheckIndex > -1 && existingPostIndex > -1 && insertIndex > -1 && updateIndex > -1);
    assert.ok(existenceCheckIndex < existingPostIndex);
    assert.ok(existenceCheckIndex < insertIndex);
    assert.ok(existenceCheckIndex < updateIndex);
  });
});

group("INSERT always includes related_app_ids", () => {
  test("the insert payload includes related_app_ids: relatedAppIdsResult.ids", () => {
    const insertBlock = src.match(/\.insert\(\{[\s\S]*?\}\)\s*\n\s*\.select\(\);/);
    assert.ok(insertBlock, "insert call not found");
    assert.match(insertBlock![0], /related_app_ids: relatedAppIdsResult\.ids,/);
  });
});

group("UPDATE only includes related_app_ids when the request provided it", () => {
  test("updatePayload.related_app_ids is set conditionally on relatedAppIdsResult.provided", () => {
    assert.match(
      src,
      /if \(relatedAppIdsResult\.provided\) \{\s*\n\s*updatePayload\.related_app_ids = relatedAppIdsResult\.ids;\s*\n\s*\}/,
    );
  });

  test("mirrors the existing published !== undefined conditional-update pattern", () => {
    const updateBlock = src.match(/const updatePayload: Record<string, unknown> = \{[\s\S]*?\.update\(updatePayload\)/);
    assert.ok(updateBlock, "update block not found");
    assert.match(updateBlock![0], /if \(published !== undefined\) \{/);
    assert.match(updateBlock![0], /if \(relatedAppIdsResult\.provided\) \{/);
  });
});

group("app IDs are never reordered", () => {
  test("relatedAppIdsResult.ids (the validator's own order-preserved array) is written directly, never rebuilt from the existence-check query result", () => {
    assert.doesNotMatch(src, /related_app_ids:\s*foundApps/);
    assert.doesNotMatch(src, /related_app_ids:\s*\[\.\.\.foundIds\]/);
    assert.doesNotMatch(src, /related_app_ids:\s*uniqueIds/);
    // Both write sites use the validator's own array, in its original order
    // — the insert as an object-literal property, the update as an assignment.
    const writeSites = [...src.matchAll(/related_app_ids\s*[:=]\s*relatedAppIdsResult\.ids/g)];
    assert.equal(writeSites.length, 2, "expected both insert and update to write relatedAppIdsResult.ids directly");
  });
});

group("security — nothing about auth or credential handling changed", () => {
  test("still uses the service-role key from env, never a client-supplied credential", () => {
    assert.match(src, /process\.env\.BLOG_PUBLISH_SUPABASE_SERVICE_KEY/);
  });

  test("the bearer-token check still runs before any body parsing or DB access", () => {
    const tokenCheckIndex = src.indexOf("tokenMatches(match[1], publishToken)");
    const bodyParseIndex = src.indexOf("await request.json()");
    const relatedCheckIndex = src.indexOf("validateRelatedAppIds(related_app_ids)");
    assert.ok(tokenCheckIndex > -1 && bodyParseIndex > -1 && relatedCheckIndex > -1);
    assert.ok(tokenCheckIndex < bodyParseIndex);
    assert.ok(bodyParseIndex < relatedCheckIndex);
  });
});
