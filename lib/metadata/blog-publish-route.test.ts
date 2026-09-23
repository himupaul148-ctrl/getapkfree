import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * app/api/admin/blog/publish/route.ts — this project's plain `node --test`
 * runner can't import it directly, since it imports `next/server` (confirmed
 * unresolvable under plain node, the same class of constraint documented
 * throughout this project). The behavioral part of what this route does —
 * actual validation logic — lives in lib/blog-validation.ts (shape checks)
 * and lib/blog-related-app-ids.ts (related_app_ids format), and is tested
 * directly and behaviorally in lib/blog-validation.test.ts and
 * lib/blog-related-app-ids.test.ts; this file only proves the route is
 * actually wired up to use them correctly.
 *
 * History this file covers, in order:
 *  - the real production bug where 34 of 36 published posts had an empty
 *    related_app_ids despite their frontmatter listing real app UUIDs,
 *    because the route never destructured the field from the request body;
 *  - the featured_image_url publishing bug, the same class of mistake for a
 *    different field;
 *  - Phase 1 Task 3: both of the route's own inline shape checks (required
 *    fields, slug format, minimum content length) plus the related_app_ids
 *    format check were pulled out into lib/blog-validation.ts, a single
 *    shared, pure validator, so any other publishing path could eventually
 *    reuse the exact same rules. The route's existence checks (an app id
 *    actually exists, a slug is actually unique, a title doesn't actually
 *    collide) all still live here, unchanged, since they need a live
 *    Supabase query the shared validator deliberately never performs.
 */

const src = readFileSync(
  fileURLToPath(new URL("../../app/api/admin/blog/publish/route.ts", import.meta.url)),
  "utf8",
);

group("the route delegates shape validation to the shared validator", () => {
  test("imports validateBlogPost from lib/blog-validation", () => {
    assert.match(src, /import \{ validateBlogPost \} from '@\/lib\/blog-validation';/);
  });

  test("no longer imports validateRelatedAppIds directly — that call now lives inside the shared validator", () => {
    assert.doesNotMatch(src, /import \{ validateRelatedAppIds \}/);
  });

  test("calls validateBlogPost(body) and returns 400 with the validator's error on failure", () => {
    assert.match(src, /const validation = validateBlogPost\(body\);/);
    const block = src.match(
      /const validation = validateBlogPost\(body\);[\s\S]*?if \(!validation\.valid\) \{[\s\S]*?status: 400[\s\S]*?\n {4}\}/,
    );
    assert.ok(block, "expected a 400 response when the validator rejects the input");
  });

  test("the 400 response spreads the validator's `extra` fields alongside `error`, preserving the pre-existing flat error shape (e.g. `required`, `received`, `slug`)", () => {
    assert.match(
      src,
      /\{ error: validation\.error, \.\.\.\(validation\.extra \?\? \{\}\) \}/,
    );
  });

  test("destructures the validated fields from validation.data, not from the raw request body", () => {
    const block = src.match(/const \{[\s\S]*?\} = validation\.data;/);
    assert.ok(block, "expected a destructuring assignment from validation.data");
    for (const field of ["title", "description", "content", "slug", "category", "published"]) {
      assert.match(block![0], new RegExp(`\\b${field}\\b`));
    }
  });

  test("related_app_ids is destructured from validation.data, aliased back to relatedAppIdsResult", () => {
    assert.match(src, /relatedAppIds: relatedAppIdsResult,/);
  });

  test("featured_image_url is destructured from validation.data as featuredImageUrl", () => {
    assert.match(src, /\bfeaturedImageUrl,\n\s*articleType,\n\s*targetAppId,\n\s*\} = validation\.data;/);
  });

  test("the old raw single-line destructuring of the request body is gone — related_app_ids/featured_image_url are read only via validation.data now", () => {
    // The column names themselves legitimately still appear throughout the
    // file (insert/update payloads, error messages) — what must be gone is
    // the specific pattern of destructuring them as bare identifiers
    // straight off the parsed request body.
    assert.doesNotMatch(src, /const \{ title, description, content, slug, category, published, related_app_ids/);
    assert.doesNotMatch(src, /\bconst \{[^}]*\bfeatured_image_url\b[^}]*\} = body;/);
  });
});

group("the existence check is a single batched query, never one query per ID", () => {
  test("exactly two .from('apps') calls exist: the related_app_ids batch check and the separate target_app_id single-app check added by the three-type blog system — never one query per ID in either", () => {
    const fromAppsCalls = [...src.matchAll(/\.from\('apps'\)/g)];
    assert.equal(fromAppsCalls.length, 2, "expected exactly two .from('apps') calls — batched, not per-ID");
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

group("INSERT always includes related_app_ids and featured_image_url", () => {
  test("the insert payload includes related_app_ids: relatedAppIdsResult.ids", () => {
    const insertBlock = src.match(/\.insert\(\{[\s\S]*?\}\)\s*\n\s*\.select\(\);/);
    assert.ok(insertBlock, "insert call not found");
    assert.match(insertBlock![0], /related_app_ids: relatedAppIdsResult\.ids,/);
  });

  test("the insert payload writes featured_image_url: featuredImageUrl.value (already defaulted to null by the validator when absent)", () => {
    const insertBlock = src.match(/\.insert\(\{[\s\S]*?\}\)\s*\n\s*\.select\(\);/);
    assert.ok(insertBlock, "insert call not found");
    assert.match(insertBlock![0], /featured_image_url: featuredImageUrl\.value,/);
  });
});

group("UPDATE only includes related_app_ids / featured_image_url when the request provided them", () => {
  test("updatePayload.related_app_ids is set conditionally on relatedAppIdsResult.provided", () => {
    assert.match(
      src,
      /if \(relatedAppIdsResult\.provided\) \{\s*\n\s*updatePayload\.related_app_ids = relatedAppIdsResult\.ids;\s*\n\s*\}/,
    );
  });

  test("updatePayload.featured_image_url is set conditionally on featuredImageUrl.provided", () => {
    assert.match(
      src,
      /if \(featuredImageUrl\.provided\) \{\s*\n\s*updatePayload\.featured_image_url = featuredImageUrl\.value;\s*\n\s*\}/,
    );
  });

  test("mirrors the existing published !== undefined conditional-update pattern for all three fields", () => {
    const updateBlock = src.match(
      /const updatePayload: Record<string, unknown> = \{[\s\S]*?\.update\(updatePayload\)/,
    );
    assert.ok(updateBlock, "update block not found");
    assert.match(updateBlock![0], /if \(published !== undefined\) \{/);
    assert.match(updateBlock![0], /if \(relatedAppIdsResult\.provided\) \{/);
    assert.match(updateBlock![0], /if \(featuredImageUrl\.provided\) \{/);
  });

  test("the base updatePayload object never declares related_app_ids or featured_image_url unconditionally", () => {
    const baseObjectMatch = src.match(
      /const updatePayload: Record<string, unknown> = \{[\s\S]*?\n {6}\};/,
    );
    assert.ok(baseObjectMatch, "base updatePayload object literal not found");
    assert.doesNotMatch(baseObjectMatch![0], /related_app_ids/);
    assert.doesNotMatch(baseObjectMatch![0], /featured_image_url/);
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

group("the route destructures articleType/targetAppId from validation.data (three-type blog system)", () => {
  test("both are present in the destructuring assignment from validation.data", () => {
    const block = src.match(/const \{[\s\S]*?\} = validation\.data;/);
    assert.ok(block, "expected a destructuring assignment from validation.data");
    assert.match(block![0], /\barticleType\b/);
    assert.match(block![0], /\btargetAppId\b/);
  });
});

group("target_app_id existence check mirrors related_app_ids' own pattern", () => {
  test("only runs when a target_app_id was actually provided and non-null", () => {
    assert.match(src, /if \(targetAppId\.provided && targetAppId\.value !== null\) \{/);
  });

  test("uses .eq('id', targetAppId.value).maybeSingle() — a single-row lookup, not a batched .in() (there is only ever one target app)", () => {
    assert.match(src, /\.eq\('id', targetAppId\.value\)\s*\n\s*\.maybeSingle\(\);/);
  });

  test("returns 400 naming target_app_id when it does not resolve to a real app", () => {
    const block = src.match(/if \(!targetApp\) \{[\s\S]*?status: 400[\s\S]*?\n {6}\}/);
    assert.ok(block, "expected a 400 response when target_app_id does not exist");
    assert.match(block![0], /target_app_id does not reference an existing app/);
  });

  test("a genuine Supabase error during the existence check returns 500, not a false 400", () => {
    const block = src.match(/if \(targetAppError\) \{[\s\S]*?status: 500[\s\S]*?\n {8}\}/);
    assert.ok(block, "expected a 500 response on a genuine query failure");
  });

  test("runs before the existing-post lookup and before any insert/update, same ordering guarantee as related_app_ids", () => {
    const existenceCheckIndex = src.indexOf("targetAppId.provided && targetAppId.value !== null");
    const existingPostIndex = src.indexOf("Check if blog post already exists");
    const insertIndex = src.indexOf(".insert({");
    const updateIndex = src.indexOf(".update(updatePayload)");
    assert.ok(existenceCheckIndex > -1 && existingPostIndex > -1 && insertIndex > -1 && updateIndex > -1);
    assert.ok(existenceCheckIndex < existingPostIndex);
    assert.ok(existenceCheckIndex < insertIndex);
    assert.ok(existenceCheckIndex < updateIndex);
  });
});

group("INSERT always includes article_type and target_app_id (three-type blog system)", () => {
  test("the insert payload writes article_type: articleType.value and target_app_id: targetAppId.value", () => {
    const insertBlock = src.match(/\.insert\(\{[\s\S]*?\}\)\s*\n\s*\.select\(\);/);
    assert.ok(insertBlock, "insert call not found");
    assert.match(insertBlock![0], /article_type: articleType\.value,/);
    assert.match(insertBlock![0], /target_app_id: targetAppId\.value,/);
  });
});

group("UPDATE only includes article_type / target_app_id when the request provided them", () => {
  test("updatePayload.article_type is set conditionally on articleType.provided", () => {
    assert.match(
      src,
      /if \(articleType\.provided\) \{\s*\n\s*updatePayload\.article_type = articleType\.value;\s*\n\s*\}/,
    );
  });

  test("updatePayload.target_app_id is set conditionally on targetAppId.provided", () => {
    assert.match(
      src,
      /if \(targetAppId\.provided\) \{\s*\n\s*updatePayload\.target_app_id = targetAppId\.value;\s*\n\s*\}/,
    );
  });

  test("the base updatePayload object never declares article_type or target_app_id unconditionally", () => {
    const baseObjectMatch = src.match(
      /const updatePayload: Record<string, unknown> = \{[\s\S]*?\n {6}\};/,
    );
    assert.ok(baseObjectMatch, "base updatePayload object literal not found");
    assert.doesNotMatch(baseObjectMatch![0], /article_type/);
    assert.doesNotMatch(baseObjectMatch![0], /target_app_id/);
  });
});

group("security — nothing about auth or credential handling changed", () => {
  test("still uses the service-role key from env, never a client-supplied credential", () => {
    assert.match(src, /process\.env\.BLOG_PUBLISH_SUPABASE_SERVICE_KEY/);
  });

  test("the bearer-token check still runs before any body parsing or shape validation", () => {
    const tokenCheckIndex = src.indexOf("tokenMatches(match[1], publishToken)");
    const bodyParseIndex = src.indexOf("await request.json()");
    const validationCallIndex = src.indexOf("validateBlogPost(body)");
    assert.ok(tokenCheckIndex > -1 && bodyParseIndex > -1 && validationCallIndex > -1);
    assert.ok(tokenCheckIndex < bodyParseIndex);
    assert.ok(bodyParseIndex < validationCallIndex);
  });
});
