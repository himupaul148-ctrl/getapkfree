import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the admin partial-update validation
 * audit's one confirmed finding: components/admin/BlogEditor.tsx writes
 * directly to blog_posts via the browser Supabase client — a completely
 * separate path from app/api/admin/blog/publish/route.ts's
 * validateBlogPost(), which is used only by the git/CI-driven publish
 * pipeline. BlogEditor's own client-side validate()/onArticleTypeChange
 * already prevent the invalid combination in the normal flow, and the
 * database's blog_posts_article_type_target_app_check CHECK constraint is
 * the real, unbypassable, server-side authority — but until this fix, if
 * that constraint were ever actually hit, its raw Postgres error text would
 * have reached the admin's error banner verbatim, unlike the existing
 * friendly mapping for blog_posts_slug_key. Same import-time constraint as
 * every other Client Component test here.
 */

const src = readFileSync(
  fileURLToPath(new URL("../components/admin/BlogEditor.tsx", import.meta.url)),
  "utf8",
);

group("client-side invariant enforcement (first line of defense, not authoritative)", () => {
  test("validate() rejects app_related with no target app before any save is attempted", () => {
    assert.match(
      src,
      /if \(articleType === "app_related" && !targetAppId\) \{\s*\n\s*return "Choose which app this article is about\.";/,
    );
  });

  test("switching to General proactively clears targetAppId in local form state — the invariant is enforced at the point of change, not only at save time", () => {
    assert.match(
      src,
      /function onArticleTypeChange\(next: ArticleType\) \{\s*\n\s*setArticleType\(next\);\s*\n\s*if \(next === "general"\) setTargetAppId\(null\);/,
    );
  });

  test("both articleType and targetAppId are always sent together (touched: true) on every save — this form can never send one without the other, unlike the tri-state git-publish path", () => {
    assert.match(src, /articleType: \{ touched: true, value: articleType \}/);
    assert.match(src, /targetAppId: \{ touched: true, value: targetAppId \}/);
  });
});

group("the database's CHECK constraint — the real, unbypassable server-side authority — now gets a friendly error message too", () => {
  test("a blog_posts_article_type_target_app_check violation maps to the same plain-English message validate() shows, not the raw Postgres constraint name", () => {
    assert.match(
      src,
      /message\.includes\("blog_posts_article_type_target_app_check"\)\s*\n\s*\? "Choose which app this article is about\."/,
    );
  });

  test("the pre-existing blog_posts_slug_key mapping is untouched", () => {
    assert.match(
      src,
      /message\.includes\("blog_posts_slug_key"\)\s*\n\s*\? `The slug “\$\{effectiveSlug\}” is already taken\.`/,
    );
  });

  test("any other error still falls through to its own message, unmodified — no swallowing of genuine unexpected failures", () => {
    assert.match(src, /:\s*message,\s*\n\s*\);/);
  });
});
