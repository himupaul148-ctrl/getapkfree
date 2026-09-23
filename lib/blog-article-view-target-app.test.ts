import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against components/blog/BlogArticleView.tsx,
 * app/blog/[slug]/page.tsx, and app/admin/blog/[postId]/preview/page.tsx —
 * Phase 5's public/preview rendering of the three-type blog system's
 * APP_RELATED target-app reference. Same JSX/next-cache import-time
 * constraints documented throughout this project for these exact files
 * (see lib/app-detail-related-articles.test.ts, lib/blog-page-wiring.test.ts).
 */

const viewSrc = readFileSync(
  fileURLToPath(new URL("../components/blog/BlogArticleView.tsx", import.meta.url)),
  "utf8",
);
const pageSrc = readFileSync(
  fileURLToPath(new URL("../app/blog/[slug]/page.tsx", import.meta.url)),
  "utf8",
);
const previewSrc = readFileSync(
  fileURLToPath(new URL("../app/admin/blog/[postId]/preview/page.tsx", import.meta.url)),
  "utf8",
);
// The three-distinct-layouts task extracted the header/body/target-app-card
// markup this file used to check inline in viewSrc into their own shared
// components — read those too, and check them where the markup actually
// lives now, rather than re-inlining the assertions' old assumptions.
const articleHeaderSrc = readFileSync(
  fileURLToPath(new URL("../components/blog/ArticleHeader.tsx", import.meta.url)),
  "utf8",
);
const markdownRendererSrc = readFileSync(
  fileURLToPath(new URL("../components/blog/MarkdownRenderer.tsx", import.meta.url)),
  "utf8",
);
const targetAppCardSrc = readFileSync(
  fileURLToPath(new URL("../components/blog/TargetAppCard.tsx", import.meta.url)),
  "utf8",
);

group("(1) article_type flows correctly to public rendering — data-flow wiring", () => {
  test("app/blog/[slug]/page.tsx conditionally fetches getTargetApp for a target_app_id present on either app_related or review_other — the P1 fix that made review_other's target app visible", () => {
    assert.match(
      pageSrc,
      /post\.target_app_id &&\s*\n\s*\(post\.article_type === "app_related" \|\| post\.article_type === "review_other"\)\s*\n\s*\? getTargetApp\(post\.target_app_id\)\s*\n\s*: Promise\.resolve\(null\),/,
    );
  });

  test("GENERAL is still excluded — the condition is an allowlist of the two types, not simply 'target_app_id is present'", () => {
    assert.doesNotMatch(pageSrc, /post\.target_app_id\s*\n\s*\? getTargetApp/);
    assert.doesNotMatch(pageSrc, /post\.article_type === "app_related" && post\.target_app_id\s*\n\s*\?/);
  });

  test("getTargetApp is fetched in the same Promise.all as the existing related-apps/adjacent-posts fetches — no added waterfall, no duplicate query", () => {
    assert.match(
      pageSrc,
      /const \[\{ apps, fallback \}, \{ previous, next \}, targetApp, relatedArticles\] = await Promise\.all\(\[/,
    );
  });

  test("getPostBySlug's call count is unchanged (2: one in generateMetadata, one in the page body, both pre-existing) — the new columns ride along on those same two fetches, not a third, separate query", () => {
    const calls = [...pageSrc.matchAll(/getPostBySlug\(/g)];
    assert.equal(calls.length, 2);
  });

  test("targetApp is passed through to BlogArticleView, alongside relatedArticles (the three-distinct-layouts task's own new fetch, added to the same Promise.all rather than a separate one)", () => {
    assert.match(
      pageSrc,
      /<BlogArticleView\s*\n\s*post=\{post\}\s*\n\s*apps=\{apps\}\s*\n\s*fallback=\{fallback\}\s*\n\s*previous=\{previous\}\s*\n\s*next=\{next\}\s*\n\s*targetApp=\{targetApp\}\s*\n\s*relatedArticles=\{relatedArticles\}\s*\n\s*\/>/,
    );
  });
});

group("(2) GENERAL is unchanged — no reference section, no other rendering change", () => {
  test("BlogArticleView's targetApp prop defaults to null, so a caller that never passes it (or passes null, the general case) renders nothing new", () => {
    assert.match(viewSrc, /targetApp = null,/);
  });

  test("the reference block is purely conditional on targetApp in every layout that can render one — no other condition (e.g. category, post.title) gates it", () => {
    // Both AppRelatedArticleLayout and ReviewOtherArticleLayout guard their
    // own TargetAppCard purely on `targetApp` — GeneralArticleLayout never
    // renders one at all (see article-layout-types.ts's own doc comment on
    // why it still accepts, but ignores, the prop).
    const appRelatedSrc = readFileSync(
      fileURLToPath(new URL("../components/blog/AppRelatedArticleLayout.tsx", import.meta.url)),
      "utf8",
    );
    const reviewOtherSrc = readFileSync(
      fileURLToPath(new URL("../components/blog/ReviewOtherArticleLayout.tsx", import.meta.url)),
      "utf8",
    );
    assert.match(appRelatedSrc, /\{targetApp && \(/);
    assert.match(reviewOtherSrc, /\{targetApp && \(/);
  });

  test("no unconditional change was made to the header, content div, share buttons, or prev/next nav — all still present, unchanged (header/body relocated into their own shared components by the three-distinct-layouts task, not altered)", () => {
    assert.match(articleHeaderSrc, /<h1 className="mt-4 text-3xl font-extrabold/);
    assert.match(markdownRendererSrc, /dangerouslySetInnerHTML=\{\{ __html: html \}\}/);
    assert.match(viewSrc, /<ShareButtons url=\{url\} title=\{post\.title\} \/>/);
    assert.match(viewSrc, /aria-label="More posts"/);
  });
});

group("(3)+(4) APP_RELATED/REVIEW_OTHER target-app reference: correct link, compact, reuses existing UI language", () => {
  // The compact card (originally inline in BlogArticleView) was extracted
  // into its own components/blog/TargetAppCard.tsx by the three-distinct-
  // layouts task, reused by both AppRelatedArticleLayout (which also gets a
  // second, "prominent" variant of the same component — see its own doc
  // comment) and ReviewOtherArticleLayout. These assertions check the
  // "compact" branch specifically, byte-identical to the original markup.
  const compactSection = targetAppCardSrc.slice(
    targetAppCardSrc.indexOf('return (\n    <Link'),
  );

  test("links directly to /app/{slug} via next/link's <Link>, the canonical app page URL", () => {
    assert.match(compactSection, /<Link\s*\n\s*href=\{`\/app\/\$\{app\.slug\}`\}/);
  });

  test("uses the existing AppIcon component, not a new/duplicate icon implementation", () => {
    assert.match(targetAppCardSrc, /import AppIcon from "@\/components\/AppIcon";/);
    assert.match(compactSection, /<AppIcon src=\{app\.icon_url\} name=\{app\.name\} size=\{40\} \/>/);
  });

  test("reuses the exact card styling the prev/next links already use (border-base-800, bg-base-900, hover:border-brand-500/50) — not a new visual pattern", () => {
    assert.match(compactSection, /rounded-xl border border-base-800 bg-base-900 p-4 transition-colors hover:border-brand-500\/50/);
  });

  test("does not add a second download CTA or duplicate any app-detail-page content (size/permissions/version history/download button)", () => {
    assert.doesNotMatch(compactSection, /DownloadButton/);
    assert.doesNotMatch(compactSection, /PermissionsList/);
    assert.doesNotMatch(compactSection, /VersionHistory/);
  });

  test("labeled 'About this app', not a generic or misleading label", () => {
    assert.match(compactSection, />About this app</);
  });
});

group("(5) missing/unresolved target app fails gracefully", () => {
  test("targetApp is typed nullable (TargetAppLink | null) and the section is skipped entirely when it's null — no broken layout, no error UI", () => {
    assert.match(viewSrc, /targetApp\?: TargetAppLink \| null;/);
  });

  test("the page never assumes targetApp is present just because article_type is app_related — the prop itself, not the post's article_type, gates rendering", () => {
    // BlogArticleView reads only `targetApp`, never `post.article_type`,
    // when deciding whether to render the section — so an app_related post
    // whose target app failed to resolve (getTargetApp returned null)
    // renders exactly like a general post, not a broken one.
    assert.doesNotMatch(viewSrc, /post\.article_type === "app_related" &&/);
  });
});

group("(6)+(7) REVIEW_OTHER: no fake Review schema, existing FAQ/ItemList/BlogPosting untouched", () => {
  test("no Review or AggregateRating JSON-LD was added anywhere", () => {
    assert.doesNotMatch(viewSrc, /"@type": "Review"/);
    assert.doesNotMatch(viewSrc, /AggregateRating/);
    assert.doesNotMatch(viewSrc, /rating/i);
  });

  test("no rating/score/pros/cons fields were invented", () => {
    assert.doesNotMatch(viewSrc, /\bscore\b/i);
    assert.doesNotMatch(viewSrc, /\bpros\b/i);
    assert.doesNotMatch(viewSrc, /\bcons\b/i);
  });

  test("review_other now legitimately appears in BlogArticleView — as the three-distinct-layouts task's own layout-selection routing (selectArticleLayout(post.article_type) picking ReviewOtherArticleLayout), never as a fake review label/badge/schema", () => {
    // The word itself is now expected (it's the layout switch), so this
    // checks the *reason* it appears rather than its mere absence: it's
    // only ever compared against `layoutType` for component selection, and
    // ReviewOtherArticleLayout.tsx itself (checked separately below and in
    // lib/blog-review-other-target-app.test.ts) still invents no rating,
    // score, pros/cons, or Review/AggregateRating schema.
    assert.match(viewSrc, /layoutType === "review_other"/);
    assert.doesNotMatch(viewSrc, /"@type": "Review"/);
    const reviewOtherSrc = readFileSync(
      fileURLToPath(new URL("../components/blog/ReviewOtherArticleLayout.tsx", import.meta.url)),
      "utf8",
    );
    // ReviewOtherArticleLayout's own doc comment legitimately *names* these
    // concepts in prose (explaining what it deliberately does NOT do) — what
    // matters is none of them appear as actual rendered JSX/schema, i.e.
    // never inside a `{...}` expression or a JSON-LD-style "@type" value.
    assert.doesNotMatch(reviewOtherSrc, /"@type": "Review"/);
    assert.doesNotMatch(reviewOtherSrc, /"@type": "AggregateRating"/);
    assert.doesNotMatch(reviewOtherSrc, /\{[^}]*\brating\b[^}]*\}/i);
    assert.doesNotMatch(reviewOtherSrc, /\{[^}]*\bscore\b[^}]*\}/i);
    assert.doesNotMatch(reviewOtherSrc, /\{[^}]*\bpros\b[^}]*\}/i);
    assert.doesNotMatch(reviewOtherSrc, /\{[^}]*\bcons\b[^}]*\}/i);
  });

  test("FaqJsonLd/ItemListJsonLd/BlogJsonLd are still rendered exactly as before — same content-driven guards, same props", () => {
    assert.match(viewSrc, /\{faqPairs\.length > 0 && <FaqJsonLd pairs=\{faqPairs\} \/>\}/);
    assert.match(viewSrc, /\{listicleItems\.length > 0 && <ItemListJsonLd items=\{listicleItems\} \/>\}/);
    assert.match(viewSrc, /<BlogJsonLd post=\{post\} \/>/);
    assert.match(viewSrc, /const faqPairs = extractFaqPairs\(post\.content\);/);
    assert.match(viewSrc, /const listicleItems = extractListicleItems\(post\.content\);/);
  });

  test("BreadcrumbJsonLd is still rendered with its existing item list, unchanged", () => {
    assert.match(viewSrc, /<BreadcrumbJsonLd/);
    assert.match(viewSrc, /\{ name: post\.title, url: absolute\(`\/blog\/\$\{post\.slug\}`\) \}/);
  });
});

group("(8) canonical/metadata preserved — generateMetadata untouched by this task", () => {
  test("title/description/canonical/openGraph/twitter construction in app/blog/[slug]/page.tsx is byte-identical to before", () => {
    assert.match(pageSrc, /title: \{ absolute: `\$\{post\.title\} — \$\{SITE_NAME\} Blog` \},/);
    assert.match(pageSrc, /alternates: \{\s*\n\s*canonical: url,/);
    assert.match(pageSrc, /openGraph: \{\s*\n\s*type: "article",/);
    assert.match(pageSrc, /twitter: \{\s*\n\s*card: post\.featured_image_url \? "summary_large_image" : "summary",/);
  });

  test("no app name was appended to the title, no keyword-stuffed description — title/description still derive only from post.title/post.description", () => {
    const metaBody = pageSrc.slice(
      pageSrc.indexOf("export async function generateMetadata"),
      pageSrc.indexOf("export default async function BlogPostPage"),
    );
    assert.doesNotMatch(metaBody, /targetApp/);
  });
});

group("(9) noindex/search behavior unaffected", () => {
  test("the existing 'Post not found' robots: { index: false } fallback is untouched — still the only robots field in this file, unrelated to article_type/targetApp", () => {
    const robotsOccurrences = [...pageSrc.matchAll(/robots:/g)];
    assert.equal(robotsOccurrences.length, 1, "expected exactly the one pre-existing robots field, unchanged");
    assert.match(pageSrc, /if \(!post\) return \{ title: "Post not found", robots: \{ index: false \} \};/);
  });
});

group("(10) existing blog posts still render — no unrelated structural change", () => {
  test("the featured-image block, RelatedApps sidebar, and ShareButtons are all still present, unchanged", () => {
    assert.match(viewSrc, /post\.featured_image_url &&/);
    assert.match(viewSrc, /<RelatedApps apps=\{apps\} fallback=\{fallback\} \/>/);
    assert.match(viewSrc, /<ShareButtons url=\{url\} title=\{post\.title\} \/>/);
  });
});

group("preview route mirrors the public route's target-app wiring", () => {
  test("app/admin/blog/[postId]/preview/page.tsx imports getTargetApp (and, since the three-distinct-layouts task, getRelatedArticles) and applies the identical conditional fetch (app_related or review_other with a target_app_id)", () => {
    assert.match(
      previewSrc,
      /import \{\s*\n\s*getAdjacentPosts,\s*\n\s*getRelatedApps,\s*\n\s*getRelatedArticles,\s*\n\s*getTargetApp,\s*\n\s*type BlogPost,\s*\n\s*\} from "@\/lib\/blog";/,
    );
    assert.match(
      previewSrc,
      /post\.target_app_id &&\s*\n\s*\(post\.article_type === "app_related" \|\| post\.article_type === "review_other"\)\s*\n\s*\? getTargetApp\(post\.target_app_id\)\s*\n\s*: Promise\.resolve\(null\),/,
    );
  });

  test("also fetches getRelatedArticles in the same Promise.all, so a draft's preview shows its Related Articles section exactly as it will once published", () => {
    assert.match(previewSrc, /getRelatedArticles\(post\),/);
  });

  test("passes targetApp and relatedArticles through to BlogArticleView alongside the existing `preview` flag", () => {
    assert.match(
      previewSrc,
      /targetApp=\{targetApp\}\s*\n\s*relatedArticles=\{relatedArticles\}\s*\n\s*preview\s*\n\s*\/>/,
    );
  });

  test("still reads through the admin RLS-aware server client (select(\"*\")), unchanged, so target_app_id is already available for a draft without any new query shape", () => {
    assert.match(previewSrc, /\.select\("\*"\)/);
  });
});
