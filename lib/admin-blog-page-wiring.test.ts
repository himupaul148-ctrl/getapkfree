import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against app/admin/blog/page.tsx — Phase 1
 * Task 9's wiring of getAdminBlogOverview()/getAdminBlogPosts() into the
 * admin Blog page. Same import-time constraint documented throughout this
 * project for *.tsx files (JSX isn't transformed by plain `node --test`'s
 * type-stripping) and for anything importing lib/supabase/server.ts.
 */

const src = readFileSync(
  fileURLToPath(new URL("../app/admin/blog/page.tsx", import.meta.url)),
  "utf8",
);

group("the unbounded query is gone — replaced by the two Task 9 helpers", () => {
  test("imports getAdminBlogOverview and getAdminBlogPosts from lib/admin, not a raw supabase.from(\"blog_posts\") call in the page itself", () => {
    assert.match(
      src,
      /import \{\s*\n\s*getAdminBlogOverview,\s*\n\s*getAdminBlogPosts,\s*\n\s*type AdminBlogListParams,\s*\n\s*\} from "@\/lib\/admin";/,
    );
    assert.doesNotMatch(src, /supabase\s*\n?\s*\.from\("blog_posts"\)/);
  });

  test("the previous unused CATEGORY_LABELS/BlogSummary import from lib/blog is gone (page.tsx no longer builds BlogSummary[] itself)", () => {
    assert.doesNotMatch(src, /import \{ CATEGORY_LABELS, type BlogSummary \} from "@\/lib\/blog";/);
  });
});

group("the paginated list query only runs for the tab that actually shows it", () => {
  test("getAdminBlogPosts(params) is gated behind active === \"posts\"; the Overview/Write tabs never trigger it", () => {
    assert.match(
      src,
      /active === "posts" \? getAdminBlogPosts\(params\) : Promise\.resolve\(null\),/,
    );
  });

  test("getAdminBlogOverview() runs unconditionally — the header text above the tabs needs it regardless of which tab is active", () => {
    const overviewIndex = src.indexOf("getAdminBlogOverview(),");
    const ternaryIndex = src.indexOf('active === "posts" ? getAdminBlogPosts');
    assert.ok(overviewIndex !== -1 && ternaryIndex !== -1);
    assert.ok(overviewIndex < ternaryIndex, "getAdminBlogOverview() should be the unconditional first entry in the Promise.all");
  });

  test("both queries run in parallel via the same Promise.all as the existing apps fetch — no added waterfall", () => {
    assert.match(
      src,
      /const \[\{ stats, recent \}, listResult, appsRes\] = await Promise\.all\(\[/,
    );
  });
});

group("header and Overview tab read from `stats`/`recent`, never from a locally-computed `posts` array", () => {
  test("the header line uses stats.total/stats.published, not posts.length/published.length", () => {
    assert.match(
      src,
      /\{stats\.total\} post\{stats\.total === 1 \? "" : "s"\} — \{stats\.published\}\{" "\}\s*\n\s*published, \{stats\.total - stats\.published\} draft\./,
    );
    assert.doesNotMatch(src, /posts\.length/);
    assert.doesNotMatch(src, /published\.length/);
  });

  test("the four Overview stat tiles read from `stats`, not a client-computed reduce/sort over every post", () => {
    assert.match(src, /<Stat label="Total posts" value=\{String\(stats\.total\)\} \/>/);
    assert.match(src, /<Stat label="Published" value=\{String\(stats\.published\)\} \/>/);
    assert.match(src, /<Stat label="Total views" value=\{formatCount\(stats\.totalViews\)\} \/>/);
    assert.match(src, /value=\{stats\.mostViewed \? formatCount\(stats\.mostViewed\.view_count\) : "—"\}/);
    assert.doesNotMatch(src, /\.reduce\(/);
    assert.doesNotMatch(src, /\.sort\(\(a, b\) => b\.view_count - a\.view_count\)/);
  });

  test("Recent posts renders `recent` directly (already the correct 5 rows), not posts.slice(0, 5)", () => {
    assert.match(src, /\{recent\.map\(\(post\) => \(/);
    assert.doesNotMatch(src, /posts\.slice\(0, 5\)/);
  });

  test("the empty-state check uses stats.total === 0, the equivalent of the prior posts.length === 0", () => {
    assert.match(src, /\{stats\.total === 0 \? \(/);
  });
});

group("the list error banner is scoped to the list query, matching the page's existing inline-error pattern", () => {
  test("renders listResult?.error, not a thrown/unhandled error boundary", () => {
    assert.match(src, /\{listResult\?\.error && \(/);
  });
});

group("BlogPostsTable receives the full server-computed pagination/filter state as props", () => {
  test("passes posts/total/page/pageSize/totalPages/status/category/search/sort — not just `posts`", () => {
    assert.match(
      src,
      /<BlogPostsTable\s*\n\s*posts=\{listResult\.posts\}\s*\n\s*total=\{listResult\.total\}\s*\n\s*page=\{listResult\.page\}\s*\n\s*pageSize=\{listResult\.pageSize\}\s*\n\s*totalPages=\{listResult\.totalPages\}\s*\n\s*status=\{listResult\.status\}\s*\n\s*category=\{listResult\.category\}\s*\n\s*search=\{listResult\.search\}\s*\n\s*sort=\{listResult\.sort\}\s*\n\s*\/>/,
    );
  });

  test("only rendered when active === \"posts\" and listResult is present — never with a null listResult", () => {
    assert.match(src, /\{active === "posts" && listResult && \(/);
  });
});

group("searchParams now carry the full filter/pagination shape, reusing AdminBlogListParams rather than a duplicate type", () => {
  test("searchParams type intersects { tab?: string } with the canonical AdminBlogListParams from lib/admin", () => {
    assert.match(
      src,
      /searchParams: Promise<\{ tab\?: string \} & AdminBlogListParams>;/,
    );
  });
});

group("unrelated existing functionality is untouched", () => {
  test("the apps fetch for BlogEditor (write tab) is unchanged", () => {
    assert.match(
      src,
      /supabase\s*\n\s*\.from\("apps"\)\s*\n\s*\.select\("id, name, category"\)\s*\n\s*\.order\("name"\)\s*\n\s*\.returns<PickerApp\[\]>\(\),/,
    );
  });

  test("TABS/tab-nav links are unchanged — still plain ?tab= links, not carrying filter state between tabs", () => {
    assert.match(src, /href=\{`\/admin\/blog\?tab=\$\{t\.key\}`\}/);
  });

  test("export const dynamic = \"force-dynamic\" is preserved", () => {
    assert.match(src, /export const dynamic = "force-dynamic";/);
  });
});
