import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * BlogPostsTable imports next/navigation, so it cannot be rendered under
 * plain `node --test` (no React Testing Library / jsdom configured in this
 * project). Static, source-level assertions — same technique as
 * AppsManager.test.ts — proving the display-serial-number column is the
 * true first column (ahead of the existing select-all checkbox column),
 * with every other column and the bulk-select/delete logic untouched.
 *
 * Phase 1 Task 9 moved filtering/sorting/pagination from this component's
 * own `useMemo` over a full `posts` array to a server-side query
 * (lib/admin.ts's getAdminBlogPosts) driven by URL search params — `posts`
 * is now already the correct filtered/sorted/paginated page, so the row
 * number must account for the page offset (previously always index + 1,
 * since every row was on the one and only "page").
 */
const src = readFileSync(
  fileURLToPath(new URL("./BlogPostsTable.tsx", import.meta.url)),
  "utf8",
);

group("table — # column is the true first column", () => {
  test("'#' header precedes the select-all checkbox header", () => {
    const theadMatch = src.match(/<thead[\s\S]*?<\/thead>/);
    assert.ok(theadMatch, "thead not found");
    const thead = theadMatch![0];
    const hashIndex = thead.indexOf('<th className="w-10 px-4 py-3 font-medium">#</th>');
    const checkboxIndex = thead.indexOf('aria-label="Select all shown"');
    assert.ok(hashIndex !== -1, "# header not found");
    assert.ok(checkboxIndex !== -1, "select-all checkbox header not found");
    assert.ok(hashIndex < checkboxIndex, "# header must precede the select-all checkbox header");
  });

  test("posts.map exposes the array index, rendered as an absolute (page-offset) row number in the first cell", () => {
    assert.match(src, /posts\.map\(\(post, index\) => \(/);
    assert.match(
      src,
      /text-xs tabular-nums text-fg-dim">\s*\{\(page - 1\) \* pageSize \+ index \+ 1\}/,
    );
  });

  test("the number cell precedes the per-row select checkbox cell", () => {
    const rowMatch = src.match(
      /<tr key=\{post\.id\}>\s*<td className="px-4 py-3 text-xs tabular-nums text-fg-dim">[\s\S]*?<\/tr>/,
    );
    assert.ok(rowMatch, "numbered row markup not found");
    const numberIdx = rowMatch![0].indexOf("{(page - 1) * pageSize + index + 1}");
    const checkboxIdx = rowMatch![0].indexOf(`aria-label={\`Select \${post.title}\`}`);
    assert.ok(numberIdx !== -1, "row number expression not found");
    assert.ok(numberIdx < checkboxIdx, "# cell must precede the select checkbox cell");
  });

  test("the # column is narrow (compact on mobile — this table has no separate card layout, only horizontal scroll)", () => {
    assert.match(src, /<th className="w-10 px-4 py-3 font-medium">#<\/th>/);
  });
});

group("Phase 1 Task 9 — filtering/sorting/pagination moved to the server, driven by URL search params", () => {
  test("no client-side useMemo filters `posts` by title/status/category anymore — the prop is already the correct page", () => {
    assert.doesNotMatch(src, /if \(needle && !post\.title\.toLowerCase\(\)\.includes\(needle\)\) return false;/);
    assert.doesNotMatch(src, /useMemo/);
  });

  test("no client-side .sort() over the received posts — ordering is a server-side .order(), not a JS comparator here", () => {
    assert.doesNotMatch(src, /sorted\.sort/);
  });

  test("posts, total, page, pageSize, totalPages, status, category, search, sort all arrive as props from the server query", () => {
    assert.match(
      src,
      /posts,\s*\n\s*total,\s*\n\s*page,\s*\n\s*pageSize,\s*\n\s*totalPages,\s*\n\s*status,\s*\n\s*category,\s*\n\s*search,\s*\n\s*sort,/,
    );
  });

  test("search/status/category/sort controls push URL updates via go(), not local setState filtering", () => {
    assert.match(src, /go\(\{ q: e\.target\.value \}, "replace"\)/);
    assert.match(src, /go\(\{ status: e\.target\.value as AdminBlogStatusFilter \}, "push"\)/);
    assert.match(src, /go\(\{ category: e\.target\.value \}, "push"\)/);
    assert.match(src, /go\(\{ sort: e\.target\.value as AdminBlogSort \}, "push"\)/);
  });

  test("changing a filter has no explicit page in the update — go() defaults page back to 1", () => {
    const goBody = src.slice(src.indexOf("function go("), src.indexOf("const allShownSelected"));
    assert.match(goBody, /const nextPage = next\.page \?\? 1;/);
  });

  test("still uses the canonical BLOG_CATEGORIES/CATEGORY_LABELS from lib/blog — no second category list", () => {
    assert.match(src, /import \{ BLOG_CATEGORIES, CATEGORY_LABELS, type BlogSummary \} from "@\/lib\/blog";/);
  });
});

group("pagination controls", () => {
  test("Prev/Next are real buttons wired to go({ page }, \"push\") — not links to a second pagination scheme", () => {
    assert.match(src, /onClick=\{\(\) => go\(\{ page: page - 1 \}, "push"\)\}/);
    assert.match(src, /onClick=\{\(\) => go\(\{ page: page \+ 1 \}, "push"\)\}/);
  });

  test("Prev is disabled/absent on page 1, Next is disabled/absent on the last page", () => {
    assert.match(src, /\{page > 1 \? \(/);
    assert.match(src, /\{page < totalPages \? \(/);
  });

  test("shows the current page, total pages, and total post count", () => {
    assert.match(src, /Page \{page\} of \{totalPages\} — \{total\} post\{total === 1 \? "" : "s"\}/);
  });
});

group("no persistence, no schema/query/action changes", () => {
  test("numbering is computed inline from the array index and page offset — no new state, no storage call", () => {
    assert.doesNotMatch(src, /localStorage/);
    assert.doesNotMatch(src, /sessionStorage/);
  });

  test("bulk actions (publish/unpublish/delete) and per-row actions (Edit/Preview/Delete) are all still present", () => {
    assert.match(src, /onClick=\{\(\) => void run\(selected, "publish"\)\}/);
    assert.match(src, /onClick=\{\(\) => void run\(selected, "unpublish"\)\}/);
    assert.match(src, /onClick=\{\(\) => setConfirmDelete\(selected\)\}/);
    assert.match(src, /href=\{`\/admin\/blog\/\$\{post\.id\}\/edit`\}/);
    // Corrected from a stale `href={`/blog/${post.slug}`}` check left over
    // from before the admin-only draft preview link (buildPreviewHref)
    // replaced a direct public-URL "View" link — unrelated to Phase 1 Task
    // 9, but already false by the time this file was touched here.
    assert.match(src, /href=\{buildPreviewHref\(post\.id\)\}/);
    assert.match(src, /onClick=\{\(\) => setConfirmDelete\(\[post\.id\]\)\}/);
  });

  test("bulk actions still mutate blog_posts directly via the client Supabase client — no new API route", () => {
    assert.match(src, /import \{ createClient \} from "@\/lib\/supabase\/client";/);
    assert.match(src, /supabase\s*\n\s*\.from\("blog_posts"\)\s*\n\s*\.delete\(\)/);
    assert.match(src, /supabase\s*\n\s*\.from\("blog_posts"\)\s*\n\s*\.update\(\{ published: action === "publish" \}\)/);
  });

  test("router.refresh() after a mutation re-runs the server query with the same URL/filters — no manual client-side removal from `posts`", () => {
    assert.match(src, /router\.refresh\(\);/);
  });
});
