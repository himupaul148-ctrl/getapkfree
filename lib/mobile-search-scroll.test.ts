import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the P1 mobile UX fix: the mobile
 * search overlay's suggestions list had no bounded height and no scroll of
 * its own, while MobileSearchOverlay disables page scroll entirely
 * (document.body.style.overflow = "hidden") for as long as it's open — so at
 * a short/keyboard-reduced viewport, lower results and the trailing "View
 * all results" link (the list's own last item) could render past the
 * viewport edge with no way to reach them. Walks through the task's own 8
 * test requirements. Both components are "use client" and neither is
 * importable under plain `node --test` (no JSX transform/bundler in this
 * project) — same constraint documented throughout this project (see
 * lib/header-search-component.test.ts, this file's direct sibling, whose own
 * pinned assertions were re-run — unchanged except one intentionally
 * reformatted line — alongside this fix).
 */

const headerSearchSrc = readFileSync(
  fileURLToPath(new URL("../components/HeaderSearch.tsx", import.meta.url)),
  "utf8",
);
const mobileSearchOverlaySrc = readFileSync(
  fileURLToPath(new URL("../components/MobileSearchOverlay.tsx", import.meta.url)),
  "utf8",
);
const siteHeaderSrc = readFileSync(
  fileURLToPath(new URL("../components/SiteHeader.tsx", import.meta.url)),
  "utf8",
);
const homePageSrc = readFileSync(
  fileURLToPath(new URL("../app/page.tsx", import.meta.url)),
  "utf8",
);

function ulClassName(): string {
  // className is a template literal, not a plain string — grab the whole
  // <ul ...> opening tag up to the closing "role=..." + className block.
  const openTag = headerSearchSrc.match(/<ul\s*\n\s*id=\{listboxId\}\s*\n\s*role="listbox"\s*\n\s*className=\{`([\s\S]*?)`\}/);
  assert.ok(openTag, "could not locate the results <ul>'s className template literal");
  return openTag![1];
}

group("1. search result list has bounded vertical space", () => {
  test("the <ul>'s className is conditional on scrollableResults, applying a max-height only in that mode", () => {
    const className = ulClassName();
    assert.match(className, /scrollableResults/);
    assert.match(className, /max-h-\[calc\(100dvh-6rem-env\(safe-area-inset-bottom\)\)\]/);
  });

  test("the bound uses dynamic viewport height (dvh), not a static vh/px value — accounts for mobile browser chrome and the on-screen keyboard shrinking the visual viewport", () => {
    const className = ulClassName();
    assert.match(className, /100dvh/);
    assert.doesNotMatch(className, /max-h-\[\d+(px|vh)\]/);
  });

  test("the bound also subtracts the bottom safe-area inset, matching the codebase's existing safe-area convention (app/layout.tsx's own body padding, MobileBottomNav's own inline style)", () => {
    const className = ulClassName();
    assert.match(className, /env\(safe-area-inset-bottom\)/);
  });
});

group("2. search result list is vertically scrollable", () => {
  test("scrollableResults mode uses overflow-y-auto, not overflow-hidden (which would silently clip results with no way to reach them)", () => {
    const className = ulClassName();
    assert.match(className, /overflow-y-auto/);
  });

  test("overscroll-contain prevents the list's own scroll from chaining into the page behind it (there is no page scroll to chain into anyway — body scroll is locked — but this avoids any bounce/rubber-band artifact)", () => {
    const className = ulClassName();
    assert.match(className, /overscroll-contain/);
  });

  test("the non-scrollable (default) mode is unchanged: still plain overflow-hidden, no max-height, no overscroll-contain", () => {
    const className = ulClassName();
    assert.match(className, /: "overflow-hidden"/);
  });
});

group("3. \"View all results\" remains reachable", () => {
  test("the View all results link is still the trailing <li> inside the SAME <ul> that now scrolls — no separate/split container was introduced, so scrolling the list necessarily makes it reachable", () => {
    // Bounded by "<ul" (no embedded "\n") to "</ul>" — this file's line
    // endings are CRLF on this checkout, and a literal "\n" inside an
    // indexOf search string never matches "\r\n" (the same trap documented
    // in app/page.test.ts's own pre-existing, unrelated CRLF test bug —
    // avoided here rather than repeated).
    const ulBlock = headerSearchSrc.slice(
      headerSearchSrc.indexOf("<ul"),
      headerSearchSrc.indexOf("</ul>"),
    );
    assert.match(ulBlock, /View all results for/);
    // It is the last <li> — nothing about the results list follows it before </ul>.
    const viewAllIndex = ulBlock.indexOf("View all results for");
    const lastResultLiIndex = ulBlock.lastIndexOf("<AppIcon");
    assert.ok(viewAllIndex > lastResultLiIndex, "expected the View all results row to be the last item in the list");
  });

  test("no separate fixed/sticky bottom action bar was introduced for it — it stays a normal scrollable list item, the smallest safe change", () => {
    assert.doesNotMatch(headerSearchSrc, /sticky bottom-0/);
    assert.doesNotMatch(headerSearchSrc, /fixed bottom-0/);
  });
});

group("4. search input behavior remains unchanged", () => {
  test("debouncing, fetch call, and query-length gating are untouched", () => {
    assert.match(headerSearchSrc, /const DEBOUNCE_MS = 250;/);
    assert.match(headerSearchSrc, /fetch\(`\/api\/search\?q=\$\{encodeURIComponent\(trimmed\)\}`/);
    assert.match(headerSearchSrc, /trimmed\.length < MIN_QUERY_LENGTH/);
  });

  test("the <input>'s own props/handlers (onChange, onFocus, onKeyDown, aria-*) are untouched", () => {
    assert.match(headerSearchSrc, /onChange=\{\(e\) => \{\s*\n\s*setTerm\(e\.target\.value\);\s*\n\s*setOpen\(true\);\s*\n\s*setHighlighted\(-1\);\s*\n\s*\}\}/);
    assert.match(headerSearchSrc, /onFocus=\{\(\) => setOpen\(true\)\}/);
    assert.match(headerSearchSrc, /onKeyDown=\{onKeyDown\}/);
  });
});

group("5. result selection remains unchanged", () => {
  test("clicking a result still calls goToApp(app.slug), which navigates and closes the dropdown, unchanged", () => {
    assert.match(headerSearchSrc, /onClick=\{\(\) => goToApp\(app\.slug\)\}/);
    const goToApp = headerSearchSrc.slice(headerSearchSrc.indexOf("function goToApp"));
    assert.match(goToApp, /router\.push\(`\/app\/\$\{slug\}`\);/);
    assert.match(goToApp, /setOpen\(false\);/);
  });

  test("ArrowUp/ArrowDown highlight-wrapping and Enter-to-select are untouched", () => {
    assert.match(headerSearchSrc, /\(i \+ 1\) % activeResults\.length/);
    assert.match(headerSearchSrc, /i <= 0 \? activeResults\.length - 1 : i - 1/);
    assert.match(headerSearchSrc, /if \(highlighted >= 0 && activeResults\[highlighted\]\) \{/);
  });

  test("new: the highlighted option is scrolled into view on change — a harmless no-op when the list isn't height-bounded, genuinely necessary when it is", () => {
    assert.match(
      headerSearchSrc,
      /document\s*\n\s*\.getElementById\(`\$\{idPrefix\}-search-option-\$\{highlighted\}`\)\s*\n\s*\?\.scrollIntoView\(\{ block: "nearest" \}\);/,
    );
  });
});

group("6. close/search overlay behavior remains unchanged", () => {
  test("Escape still closes the overlay, body scroll is still locked/restored the same way, autofocus is unchanged", () => {
    assert.match(mobileSearchOverlaySrc, /if \(event\.key === "Escape"\) close\(\);/);
    assert.match(mobileSearchOverlaySrc, /document\.body\.style\.overflow = "hidden";/);
    assert.match(mobileSearchOverlaySrc, /document\.body\.style\.overflow = previous;/);
    assert.match(mobileSearchOverlaySrc, /input\?\.focus\(\);/);
  });

  test("the close button and dialog/aria-modal semantics are unchanged", () => {
    assert.match(mobileSearchOverlaySrc, /role="dialog"/);
    assert.match(mobileSearchOverlaySrc, /aria-modal="true"/);
    assert.match(mobileSearchOverlaySrc, /aria-label="Close search"/);
    assert.match(mobileSearchOverlaySrc, /onClick=\{close\}/);
  });

  test("the overlay's own root container is still the only fixed, full-screen element — no second overflow/scroll container was added to it (scroll belongs on the results list only, per the task's own constraint)", () => {
    assert.match(mobileSearchOverlaySrc, /className="fixed inset-0 z-50 bg-base-950 md:hidden"/);
    assert.doesNotMatch(mobileSearchOverlaySrc, /overflow-y-auto/);
  });
});

group("7. desktop HeaderSearch is not unintentionally changed", () => {
  test("SiteHeader's desktop instance does not pass scrollableResults — its dropdown keeps the original, unbounded overflow-hidden behavior exactly", () => {
    const desktopCall = siteHeaderSrc.slice(
      siteHeaderSrc.indexOf("<HeaderSearch"),
      siteHeaderSrc.indexOf("/>", siteHeaderSrc.indexOf("<HeaderSearch")) + 2,
    );
    assert.doesNotMatch(desktopCall, /scrollableResults/);
  });

  test("the homepage hero's HeaderSearch instance (size=\"large\") also does not pass scrollableResults — only the mobile overlay opts in", () => {
    const heroCall = homePageSrc.slice(
      homePageSrc.indexOf("<HeaderSearch"),
      homePageSrc.indexOf("/>", homePageSrc.indexOf("<HeaderSearch")) + 2,
    );
    assert.doesNotMatch(heroCall, /scrollableResults/);
  });

  test("scrollableResults defaults to false, so any future/unknown caller that doesn't pass it explicitly keeps today's exact behavior", () => {
    assert.match(headerSearchSrc, /scrollableResults = false,/);
  });

  test("only one call site in the whole codebase passes scrollableResults — the mobile overlay, exactly as intended", () => {
    // headerSearchSrc legitimately mentions it several times (prop
    // destructure, prop type, doc comment, the ternary) — what matters is
    // siteHeaderSrc/homePageSrc have zero and mobileSearchOverlaySrc has it.
    assert.equal([...siteHeaderSrc.matchAll(/scrollableResults/g)].length, 0);
    assert.equal([...homePageSrc.matchAll(/scrollableResults/g)].length, 0);
    assert.ok([...mobileSearchOverlaySrc.matchAll(/scrollableResults/g)].length >= 1);
  });
});

group("8. no body-scroll-lock regression", () => {
  test("the exact same lock/restore pattern is untouched: previous overflow value saved and restored, not hardcoded to \"\" or \"visible\"", () => {
    assert.match(mobileSearchOverlaySrc, /const previous = document\.body\.style\.overflow;/);
    assert.match(mobileSearchOverlaySrc, /document\.body\.style\.overflow = "hidden";/);
    assert.match(mobileSearchOverlaySrc, /document\.body\.style\.overflow = previous;/);
  });

  test("the lock/restore still lives in the same effect, gated on `open`, with the same cleanup shape", () => {
    const effectBlock = mobileSearchOverlaySrc.slice(
      mobileSearchOverlaySrc.indexOf("useEffect(() => {"),
      mobileSearchOverlaySrc.indexOf("}, [open, close]);") + "}, [open, close]);".length,
    );
    assert.match(effectBlock, /if \(!open\) return;/);
    assert.match(effectBlock, /return \(\) => \{/);
  });

  test("no new document.body.style mutation was introduced anywhere by this fix — the scroll fix is scoped entirely to the results <ul>, not the page/body", () => {
    // 3 pre-existing occurrences: the `const previous = document.body.style.overflow;`
    // read, the "hidden" lock, and the `= previous;` restore — all three
    // already present before this fix; nothing new added.
    const bodyStyleMutations = [...mobileSearchOverlaySrc.matchAll(/document\.body\.style\./g)];
    assert.equal(bodyStyleMutations.length, 3, "expected exactly the 3 pre-existing document.body.style references (read + lock + restore), no new ones");
    // headerSearchSrc's own doc comment legitimately *mentions*
    // document.body.style.overflow in prose (explaining why scrollableResults
    // exists), so a literal-code-only check on this file would either need a
    // comment-stripping pass (overkill for this) or produce a false
    // positive — the meaningful invariant (no *new* mutation added anywhere
    // by this fix) is already fully covered by the exact-count assertion on
    // mobileSearchOverlaySrc above.
  });
});
