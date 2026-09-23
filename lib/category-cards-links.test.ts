import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * components/catalogue/CategoryCards.tsx — Phase 1 Task 5's crawlable
 * category-link fix. This is a "use client" component whose JSX Node's
 * native TypeScript stripping cannot parse (it only strips types, it does
 * not transform JSX), the same reason app/app/[slug]/page.tsx and other
 * *.tsx files in this project are tested with static source assertions
 * rather than a real import (see lib/app-detail-unpublished-guard.test.ts).
 *
 * Before this fix, every category card was a <button onClick={...}> with no
 * href at all — invisible to a crawler and unusable without JavaScript. The
 * fix wraps the exact same visual card in a real next/link <Link> pointing
 * at the same canonical category URL components/SiteFooter.tsx already
 * links with (`/?category=<Name>#catalogue`), while a plain left-click still
 * runs the pre-existing instant client-side filter toggle instead of a full
 * navigation.
 */

const src = readFileSync(
  fileURLToPath(new URL("../components/catalogue/CategoryCards.tsx", import.meta.url)),
  "utf8",
);

group("(1)+(2) every displayed category has a real link to its canonical URL", () => {
  test("imports Link from next/link", () => {
    assert.match(src, /^import Link from "next\/link";$/m);
  });

  test("renders <Link href={...}> inside the CATEGORIES.map loop, not a <button>", () => {
    const mapBlock = src.slice(src.indexOf("CATEGORIES.map((name) =>"));
    assert.match(mapBlock, /<Link\s*\n\s*href=\{`\/\?category=\$\{encodeURIComponent\(name\)\}#catalogue`\}/);
  });

  test("the href matches the exact canonical construction components/SiteFooter.tsx already uses for the same categories", () => {
    // Both must build the identical URL shape from the identical source —
    // CATEGORIES values passed straight through encodeURIComponent — so
    // there is exactly one category-to-URL mapping in the codebase, not two.
    const footer = readFileSync(
      fileURLToPath(new URL("../components/SiteFooter.tsx", import.meta.url)),
      "utf8",
    );
    assert.match(footer, /href=\{`\/\?category=\$\{encodeURIComponent\(category\)\}#catalogue`\}/);
    assert.match(src, /href=\{`\/\?category=\$\{encodeURIComponent\(name\)\}#catalogue`\}/);
  });

  test("no <button> element remains for the category card", () => {
    assert.doesNotMatch(src, /<button/);
  });
});

group("(3) the cards do not depend solely on onClick/router navigation", () => {
  test("the Link element carries a real href, not just an onClick handler", () => {
    const mapBlock = src.slice(src.indexOf("CATEGORIES.map((name) =>"));
    const linkOpenTag = mapBlock.match(/<Link[\s\S]*?>/);
    assert.ok(linkOpenTag, "expected a <Link ...> opening tag");
    assert.match(linkOpenTag![0], /href=/);
  });

  test("no router.push or window.location navigation was introduced", () => {
    assert.doesNotMatch(src, /router\.push\(/);
    assert.doesNotMatch(src, /window\.location/);
  });

  test("no useRouter import was added — next/link is the only navigation mechanism", () => {
    assert.doesNotMatch(src, /useRouter/);
  });
});

group("(4) no invalid nested interactive elements", () => {
  test("nothing inside the Link's children is itself a <button> or a second <a>/<Link>", () => {
    const mapBlock = src.slice(src.indexOf("CATEGORIES.map((name) =>"));
    const linkStart = mapBlock.indexOf("<Link");
    const linkClose = mapBlock.indexOf("</Link>", linkStart);
    const children = mapBlock.slice(mapBlock.indexOf(">", linkStart) + 1, linkClose);
    assert.doesNotMatch(children, /<button/);
    assert.doesNotMatch(children, /<a[\s>]/);
    assert.doesNotMatch(children, /<Link/);
  });

  test("the icon svg remains aria-hidden, so the Link's accessible name comes from the visible category name text, not the icon", () => {
    assert.match(src, /aria-hidden="true"[\s\S]*?<path d=\{CATEGORY_ICON_PATHS/);
  });
});

group("(5) category ordering/data is preserved", () => {
  test("still maps over CATEGORIES from lib/types, in the same order, unchanged", () => {
    assert.match(src, /import \{ CATEGORIES \} from "@\/lib\/types";/);
    assert.match(src, /\{CATEGORIES\.map\(\(name\) => \{/);
  });

  test("category names, icon paths, and tints are read the same way as before (no second, hand-written category list)", () => {
    assert.match(src, /CATEGORY_ICON_PATHS\[name as Category\]/);
    assert.match(src, /CATEGORY_TINTS\[name as Category\]/);
  });
});

group("(6) existing homepage category-card behavior is intact", () => {
  test("a plain click still calls toggleCategory(name) via the existing choose() helper — the instant client-side filter is preserved, not replaced by a full navigation", () => {
    assert.match(src, /function choose\(name: string\) \{\s*\n\s*toggleCategory\(name\);/);
    assert.match(src, /choose\(name\);/);
  });

  test("the smooth-scroll to #catalogue is preserved", () => {
    assert.match(
      src,
      /document\s*\n\s*\.getElementById\("catalogue"\)\s*\n\s*\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\);/,
    );
  });

  test("the click handler lets modifier-key clicks (Cmd/Ctrl/Shift/Alt) and non-left clicks fall through to the real link instead of always intercepting", () => {
    const handler = src.match(/function handleClick\([\s\S]*?\n  \}/);
    assert.ok(handler, "expected a handleClick function");
    assert.match(handler![0], /event\.metaKey/);
    assert.match(handler![0], /event\.ctrlKey/);
    assert.match(handler![0], /event\.button !== 0/);
    assert.match(handler![0], /event\.preventDefault\(\);/);
  });

  test("aria-current replaces aria-pressed — the ARIA-correct state for a link representing the active selection, not a toggle button", () => {
    assert.doesNotMatch(src, /aria-pressed/);
    assert.match(src, /aria-current=\{isActive \? "true" : undefined\}/);
  });

  test("the active/inactive visual styling (border, background, text colors) is byte-for-byte unchanged", () => {
    assert.match(
      src,
      /isActive\s*\n\s*\? "border-brand-500 bg-brand-500\/10"\s*\n\s*: "border-base-800 bg-base-900 hover:border-brand-500\/50 hover:bg-base-850"/,
    );
  });

  test("the app-count and 'selected' text are still rendered exactly as before", () => {
    assert.match(src, /\{counts\[name\] \?\? 0\} app\{counts\[name\] === 1 \? "" : "s"\}/);
    assert.match(src, /• selected/);
  });
});
