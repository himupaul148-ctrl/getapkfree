import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the P1 fix: REVIEW_OTHER posts with a
 * target_app_id (e.g. a single-app review, per
 * supabase/migrations/20260923000000_blog_article_type.sql's own comment)
 * used to be invisible everywhere — every consumer of target_app_id hard-
 * gated on article_type === "app_related" only. This file walks through the
 * task's own A-G scenario list end to end, across the three files that
 * changed (lib/blog.ts's getPrimaryBlogPostsForApp, app/blog/[slug]/page.tsx,
 * app/admin/blog/[postId]/preview/page.tsx) plus the two that were
 * deliberately left untouched (components/blog/BlogArticleView.tsx,
 * app/app/[slug]/page.tsx's dedup logic).
 *
 * Same import-time constraints documented throughout this project: lib/blog.ts
 * imports `unstable_cache` from "next/cache" and constructs a real Supabase
 * client at module scope; the three .tsx files are JSX-bearing. None are
 * importable under plain `node --test`, so these are source-level regex
 * assertions against the exact same source these run in production — see
 * lib/blog-primary-app-lookup.test.ts and lib/blog-article-view-target-app.test.ts
 * for the two existing files whose own pinned assertions were updated
 * alongside this fix (their full suites re-run clean; see this task's own
 * final report for confirmation).
 */

const blogSrc = readFileSync(fileURLToPath(new URL("./blog.ts", import.meta.url)), "utf8");
const publicPageSrc = readFileSync(
  fileURLToPath(new URL("../app/blog/[slug]/page.tsx", import.meta.url)),
  "utf8",
);
const previewPageSrc = readFileSync(
  fileURLToPath(new URL("../app/admin/blog/[postId]/preview/page.tsx", import.meta.url)),
  "utf8",
);
const appDetailSrc = readFileSync(
  fileURLToPath(new URL("../app/app/[slug]/page.tsx", import.meta.url)),
  "utf8",
);
const viewSrc = readFileSync(
  fileURLToPath(new URL("../components/blog/BlogArticleView.tsx", import.meta.url)),
  "utf8",
);
const targetAppCardSrc = readFileSync(
  fileURLToPath(new URL("../components/blog/TargetAppCard.tsx", import.meta.url)),
  "utf8",
);

function bodyOf(src: string, fnName: string): string {
  const match = src.match(
    new RegExp(`export async function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found`);
  return match![0];
}

group("A. APP_RELATED + target app — target resolves, renders on both the article page and the app page", () => {
  test("app/blog/[slug]/page.tsx's gate is satisfied for article_type === \"app_related\" with a target_app_id (getTargetApp is called, not skipped)", () => {
    const gate = /post\.target_app_id &&\s*\n\s*\(post\.article_type === "app_related" \|\| post\.article_type === "review_other"\)\s*\n\s*\? getTargetApp\(post\.target_app_id\)\s*\n\s*: Promise\.resolve\(null\),/;
    assert.match(publicPageSrc, gate);
    // app_related is explicitly one of the two ORed branches.
    assert.match(publicPageSrc, /post\.article_type === "app_related"/);
  });

  test("getPrimaryBlogPostsForApp's allowlist explicitly includes app_related, so an app_related post targeting appId is still returned exactly as before this fix", () => {
    const body = bodyOf(blogSrc, "getPrimaryBlogPostsForApp");
    assert.match(body, /\.in\("article_type", \["app_related", "review_other"\]\)/);
  });
});

group("B. REVIEW_OTHER + target app — the P1 bug's fix: target resolves, renders on both the article page and the app page", () => {
  test("app/blog/[slug]/page.tsx's gate is satisfied for article_type === \"review_other\" with a target_app_id — this branch did not exist before the fix", () => {
    assert.match(publicPageSrc, /post\.article_type === "review_other"/);
  });

  test("app/admin/blog/[postId]/preview/page.tsx applies the identical gate, so a review_other draft's preview matches what the public page will show once published", () => {
    assert.match(previewPageSrc, /post\.article_type === "app_related" \|\| post\.article_type === "review_other"/);
  });

  test("getPrimaryBlogPostsForApp's allowlist includes review_other — a review_other post targeting appId now appears in the app page's primary section", () => {
    const body = bodyOf(blogSrc, "getPrimaryBlogPostsForApp");
    assert.match(body, /"review_other"/);
  });

  test("the query still filters on the exact appId via a real database .eq(), not a JS comparison — review_other posts targeting a *different* app are still excluded", () => {
    const body = bodyOf(blogSrc, "getPrimaryBlogPostsForApp");
    assert.match(body, /\.eq\("target_app_id", appId\)/);
  });
});

group("C. REVIEW_OTHER without a target app — no reference, no primary-section entry", () => {
  test("the article-page gate requires post.target_app_id to be truthy before calling getTargetApp — a review_other post with target_app_id === null takes the Promise.resolve(null) branch", () => {
    // The condition is `post.target_app_id && (...)`, so a falsy
    // target_app_id short-circuits before article_type is even considered.
    assert.match(publicPageSrc, /post\.target_app_id &&\s*\n\s*\(post\.article_type === "app_related" \|\| post\.article_type === "review_other"\)/);
  });

  test("getPrimaryBlogPostsForApp's target_app_id filter is a real database .eq(\"target_app_id\", appId) — a row with target_app_id = null can never match any appId, so it's never returned for any app's page", () => {
    const body = bodyOf(blogSrc, "getPrimaryBlogPostsForApp");
    assert.match(body, /\.eq\("target_app_id", appId\)/);
  });
});

group("D. GENERAL — unchanged; no target-app reference merely because the type exists", () => {
  test("the allowlist in getPrimaryBlogPostsForApp is exactly [\"app_related\", \"review_other\"] — general is not in it, even implicitly via negation", () => {
    const body = bodyOf(blogSrc, "getPrimaryBlogPostsForApp");
    assert.match(body, /\["app_related", "review_other"\]/);
    assert.doesNotMatch(body, /\.neq\("article_type", "general"\)/);
  });

  test("the article-page/preview gate is an explicit allowlist (===\"app_related\" || ===\"review_other\"), not \"!== general\" or \"target_app_id present\" alone — a general post can never satisfy it even if legacy data gave it a target_app_id", () => {
    for (const src of [publicPageSrc, previewPageSrc]) {
      assert.doesNotMatch(src, /post\.article_type !== "general"/);
      assert.doesNotMatch(src, /!== "general" && post\.target_app_id/);
    }
  });
});

group("E. Deduplication — a post in the primary section never also appears in the generic related-articles section", () => {
  test("app/app/[slug]/page.tsx's dedup-by-id logic is untouched by this fix — it operates on whatever primaryArticles/relatedArticlesRaw contain, independent of which article_types feed primaryArticles", () => {
    assert.match(
      appDetailSrc,
      /const primaryArticleIds = new Set\(primaryArticles\.map\(\(article\) => article\.id\)\);\s*\n\s*const articles = relatedArticlesRaw\.filter\(\(article\) => !primaryArticleIds\.has\(article\.id\)\);/,
    );
  });

  test("a review_other post that also names its own target app in related_app_ids is dropped from the generic section the same way an app_related one already was — the dedup is by id, not by article_type", () => {
    // The filter only ever inspects `.id` — nothing in it branches on
    // article_type, so broadening getPrimaryBlogPostsForApp's query in
    // lib/blog.ts automatically broadens what this dedup protects against,
    // with zero change needed here.
    const dedupBlock = appDetailSrc.slice(
      appDetailSrc.indexOf("const primaryArticleIds"),
      appDetailSrc.indexOf("const articles = relatedArticlesRaw") + 200,
    );
    assert.doesNotMatch(dedupBlock, /article_type/);
  });
});

group("F. Missing/unresolved target app — no crash, section omitted gracefully", () => {
  test("getTargetApp() still fails closed to null on a genuine Supabase error or a deleted/nonexistent app id — untouched by this fix (see lib/blog-target-app-lookup.test.ts for full coverage)", () => {
    const body = bodyOf(blogSrc, "getTargetApp");
    assert.doesNotMatch(body, /resolveQueryResult/);
    assert.match(body, /if \(error\) \{\s*\n\s*console\.error/);
    // The three-distinct-layouts task extended this function to also derive
    // APP FACTS from the row (see lib/blog-target-app-lookup.test.ts), so it
    // no longer returns the raw row verbatim — but a missing row still fails
    // closed to null before any of that derivation runs.
    assert.match(body, /if \(!data\) return null;/);
  });

  test("BlogArticleView's target-app <-> layout wiring still passes targetApp through purely conditionally — a null (failed lookup, deleted app, or the type not matching) simply renders without the target-app sections, no broken layout", () => {
    assert.match(viewSrc, /targetApp = null,/);
    // The card itself moved into its own component (TargetAppCard) as part
    // of the three-distinct-layouts task; BlogArticleView now only threads
    // the already-nullable `targetApp` value through to whichever layout
    // renders — each layout's own `{targetApp && (...)}` guard (see
    // AppRelatedArticleLayout.tsx/ReviewOtherArticleLayout.tsx) is what
    // actually skips the section when it's null.
    assert.doesNotMatch(viewSrc, /post\.article_type === "app_related" &&/);
  });

  test("a malformed/legacy target_app_id (e.g. not a real uuid) reaches getTargetApp's own .eq(\"id\", targetAppId).maybeSingle() unchanged — Postgres returns zero rows rather than throwing for a well-formed-but-nonexistent uuid, and getTargetApp already turns that into null, not a crash", () => {
    const body = bodyOf(blogSrc, "getTargetApp");
    assert.match(body, /\.eq\("id", targetAppId\)/);
    assert.match(body, /\.maybeSingle<TargetAppRow>\(\)/);
  });
});

group("G. Existing (Phase 4/5) behavior remains valid", () => {
  test("getBlogPostsForApp (the generic related_app_ids reverse lookup) is completely untouched by this fix — still its own separate, unchanged export", () => {
    assert.match(blogSrc, /export async function getBlogPostsForApp\(/);
    const body = bodyOf(blogSrc, "getBlogPostsForApp");
    assert.match(body, /\.contains\("related_app_ids", \[appId\]\)/);
  });

  test("getPostBySlug's select (article_type, target_app_id alongside LIST_COLUMNS/content) is unchanged — this fix only changed the gating condition that reads those columns, not how they're fetched", () => {
    const body = bodyOf(blogSrc, "getPostBySlug");
    assert.match(body, /\.select\(`\$\{LIST_COLUMNS\}, content, article_type, target_app_id`\)/);
  });

  test("app/app/[slug]/page.tsx's primary-section heading, guard, and Promise.all wiring are all unchanged — only the underlying query's WHERE clause changed, not this page's own code", () => {
    assert.match(appDetailSrc, /\{primaryArticles\.length > 0 && \(/);
    assert.match(appDetailSrc, /Guides &amp; Articles About This App/);
    assert.match(
      appDetailSrc,
      /const \[versions, related, primaryArticles, relatedArticlesRaw\] = await Promise\.all\(\[/,
    );
  });

  test("the \"About this app\" card markup (link, AppIcon, styling) is unchanged — relocated into components/blog/TargetAppCard.tsx by the three-distinct-layouts task, not altered", () => {
    assert.match(targetAppCardSrc, />About this app</);
    assert.match(targetAppCardSrc, /import AppIcon from "@\/components\/AppIcon";/);
  });

  test("no Review/AggregateRating JSON-LD or rating/pros/cons fields were introduced anywhere by this fix", () => {
    assert.doesNotMatch(viewSrc, /"@type": "Review"/);
    assert.doesNotMatch(viewSrc, /AggregateRating/);
    assert.doesNotMatch(blogSrc, /"@type": "Review"/);
  });
});
