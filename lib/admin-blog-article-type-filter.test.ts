import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the admin blog list's Article Type +
 * Target App management task: server-side article-type filtering in
 * lib/admin.ts's getAdminBlogPosts, and the Article Type/Target App columns
 * in components/admin/BlogPostsTable.tsx. Same import-time constraint as
 * every other test against these modules — lib/admin.ts constructs a real
 * cookie-bound Supabase client at module scope, and BlogPostsTable.tsx is a
 * Client Component; neither is importable under plain `node --test`.
 */

const adminSrc = readFileSync(fileURLToPath(new URL("./admin.ts", import.meta.url)), "utf8");
const tableSrc = readFileSync(
  fileURLToPath(new URL("../components/admin/BlogPostsTable.tsx", import.meta.url)),
  "utf8",
);
const pageSrc = readFileSync(
  fileURLToPath(new URL("../app/admin/blog/page.tsx", import.meta.url)),
  "utf8",
);

function bodyOf(src: string, fnName: string): string {
  const match = src.match(
    new RegExp(`(?:export )?(?:async )?function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`),
  );
  assert.ok(match, `${fnName} not found`);
  return match![0];
}

group("server-side article-type validation", () => {
  test("normaliseArticleType validates against the canonical isArticleType() from lib/blog-article-types, not a second copy of the list", () => {
    assert.match(
      adminSrc,
      /import \{ isArticleType, type ArticleType \} from "@\/lib\/blog-article-types";/,
    );
    const body = bodyOf(adminSrc, "normaliseArticleType");
    assert.match(body, /isArticleType\(raw\)/);
    assert.match(body, /: "all"/);
  });

  test("an invalid/missing articleType param degrades to \"all\" (no filter), never reaching .eq() unvalidated", () => {
    assert.doesNotMatch(adminSrc, /\.eq\("article_type", params\.articleType\)/);
    assert.match(adminSrc, /if \(articleType !== "all"\) query = query\.eq\("article_type", articleType\);/);
  });
});

group("getAdminBlogPosts selects article_type/target_app_id without widening to full content", () => {
  test("BLOG_LIST_COLUMNS includes article_type and target_app_id alongside the existing narrow column list", () => {
    assert.match(
      adminSrc,
      /"id, slug, title, description, featured_image_url, author, category, related_app_ids, published, view_count, created_at, updated_at, article_type, target_app_id"/,
    );
  });

  test("articleType is combined with status/category/search filters, not exclusive of them", () => {
    const body = bodyOf(adminSrc, "getAdminBlogPosts");
    assert.match(body, /if \(status === "published"\)/);
    assert.match(body, /if \(category\) query = query\.eq\("category", category\);/);
    assert.match(body, /if \(articleType !== "all"\)/);
    assert.match(body, /if \(search\) \{/);
  });

  test("articleType is returned in the result alongside the other resolved filters, for the URL/UI to read back", () => {
    const body = bodyOf(adminSrc, "getAdminBlogPosts");
    assert.match(body, /articleType,\s*\n\s*error: error\?\.message \?\? null,/);
  });
});

group("BlogPostsTable renders the Article Type and Target App columns using existing constants", () => {
  test("imports ARTICLE_TYPES/ARTICLE_TYPE_LABELS from lib/blog-article-types, not a duplicate definition", () => {
    assert.match(
      tableSrc,
      /import \{ ARTICLE_TYPES, ARTICLE_TYPE_LABELS \} from "@\/lib\/blog-article-types";/,
    );
  });

  test("table header includes Article Type and Target App columns", () => {
    assert.match(tableSrc, /<th className="px-4 py-3 font-medium">Article Type<\/th>/);
    assert.match(tableSrc, /<th className="px-4 py-3 font-medium">Target App<\/th>/);
  });

  test("Article Type filter select offers exactly All Types + the three canonical types, driven by ARTICLE_TYPES (no hard-coded duplicate list)", () => {
    assert.match(tableSrc, /<option value="all">All Types<\/option>/);
    assert.match(tableSrc, /\{ARTICLE_TYPES\.map\(\(t\) => \(/);
  });

  test("changing the article-type filter goes through go(), preserving tab/search/category/status/sort in the URL the same way every other filter already does", () => {
    assert.match(
      tableSrc,
      /go\(\{ articleType: e\.target\.value as AdminBlogArticleTypeFilter \}, "push"\)/,
    );
  });
});

group("Target App column resolves target_app_id via the already-fetched apps list — no N+1 query", () => {
  test("targetAppLabel never uses related_app_ids", () => {
    const body = bodyOf(tableSrc, "targetAppLabel");
    assert.doesNotMatch(body, /related_app_ids/);
  });

  test("General rows show the em-dash empty state regardless of target_app_id", () => {
    const body = bodyOf(tableSrc, "targetAppLabel");
    assert.match(body, /if \(post\.article_type === "general"\) return "—";/);
  });

  test("App Related / Review Other resolve via appNameById, falling back to \"Unknown app\" rather than crashing on an unresolved id", () => {
    const body = bodyOf(tableSrc, "targetAppLabel");
    assert.match(body, /appNameById\.get\(post\.target_app_id\) \?\? "Unknown app"/);
  });

  test("appNameById is built once via useMemo from the apps prop — not refetched or rebuilt per row", () => {
    assert.match(
      tableSrc,
      /const appNameById = useMemo\(\(\) => new Map\(apps\.map\(\(a\) => \[a\.id, a\.name\]\)\), \[apps\]\);/,
    );
  });

  test("apps prop is typed as the existing PickerApp[] shape, not a new duplicate type", () => {
    assert.match(tableSrc, /import type \{ PickerApp \} from "@\/components\/admin\/RelatedAppPicker";/);
    assert.match(tableSrc, /apps: PickerApp\[\];/);
  });
});

group("app/admin/blog/page.tsx wires articleType and the already-fetched apps list through, without a second apps query", () => {
  test("passes articleType={listResult.articleType} and apps={apps} to BlogPostsTable", () => {
    assert.match(pageSrc, /articleType=\{listResult\.articleType\}/);
    assert.match(pageSrc, /apps=\{apps\}/);
  });

  test("the apps query itself is unchanged — still one query, not gated on the posts tab, still id/name/category only", () => {
    assert.match(
      pageSrc,
      /supabase\s*\n\s*\.from\("apps"\)\s*\n\s*\.select\("id, name, category"\)\s*\n\s*\.order\("name"\)/,
    );
  });
});

group("existing admin blog list behavior is preserved", () => {
  test("search, category, status, sort, and pagination logic are all untouched", () => {
    assert.match(adminSrc, /function normaliseStatus/);
    assert.match(adminSrc, /function normaliseSort/);
    assert.match(adminSrc, /escapeIlikePattern/);
    assert.match(adminSrc, /ADMIN_BLOG_PAGE_SIZE = 20;/);
  });

  test("edit/preview/delete/publish/unpublish actions in BlogPostsTable are untouched", () => {
    assert.match(tableSrc, /href=\{`\/admin\/blog\/\$\{post\.id\}\/edit`\}/);
    assert.match(tableSrc, /href=\{buildPreviewHref\(post\.id\)\}/);
    assert.match(tableSrc, /void run\(selected, "publish"\)/);
    assert.match(tableSrc, /void run\(selected, "unpublish"\)/);
  });
});
