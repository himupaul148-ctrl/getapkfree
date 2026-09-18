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
 * numbered from the array index of the already filtered+sorted `rows`
 * array, with every other column and the bulk-select/delete logic
 * untouched.
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

  test("rows.map exposes the array index, rendered as index + 1 in the first cell", () => {
    assert.match(src, /rows\.map\(\(post, index\) => \(/);
    assert.match(src, /text-xs tabular-nums text-fg-dim">\s*\{index \+ 1\}/);
  });

  test("the number cell precedes the per-row select checkbox cell", () => {
    const rowMatch = src.match(
      /<tr key=\{post\.id\}>\s*<td className="px-4 py-3 text-xs tabular-nums text-fg-dim">[\s\S]*?<\/tr>/,
    );
    assert.ok(rowMatch, "numbered row markup not found");
    const numberIdx = rowMatch![0].indexOf("{index + 1}");
    const checkboxIdx = rowMatch![0].indexOf(`aria-label={\`Select \${post.title}\`}`);
    assert.ok(numberIdx < checkboxIdx, "# cell must precede the select checkbox cell");
  });

  test("the # column is narrow (compact on mobile — this table has no separate card layout, only horizontal scroll)", () => {
    assert.match(src, /<th className="w-10 px-4 py-3 font-medium">#<\/th>/);
  });
});

group("no persistence, no schema/query/action changes", () => {
  test("numbering is computed inline from the array index — no new state, no storage call", () => {
    assert.doesNotMatch(src, /localStorage/);
    assert.doesNotMatch(src, /sessionStorage/);
  });

  test("existing filter/sort logic producing `rows` is untouched", () => {
    assert.match(src, /if \(needle && !post\.title\.toLowerCase\(\)\.includes\(needle\)\) return false;/);
    assert.match(src, /if \(sort === "title"\) sorted\.sort/);
    assert.match(src, /else if \(sort === "views"\)/);
  });

  test("bulk actions (publish/unpublish/delete) and per-row actions (Edit/Preview/Delete) are all still present", () => {
    assert.match(src, /onClick=\{\(\) => void run\(selected, "publish"\)\}/);
    assert.match(src, /onClick=\{\(\) => void run\(selected, "unpublish"\)\}/);
    assert.match(src, /onClick=\{\(\) => setConfirmDelete\(selected\)\}/);
    assert.match(src, /href=\{`\/admin\/blog\/\$\{post\.id\}\/edit`\}/);
    assert.match(src, /href=\{`\/blog\/\$\{post\.slug\}`\}/);
    assert.match(src, /onClick=\{\(\) => setConfirmDelete\(\[post\.id\]\)\}/);
  });
});
