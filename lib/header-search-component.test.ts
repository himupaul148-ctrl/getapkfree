import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against components/HeaderSearch.tsx and
 * components/SiteHeader.tsx — both are "use client" components, and this
 * project's plain `node --test` runner has no JSX transform and no
 * bundler, so neither can be imported directly (the same constraint
 * documented in lib/screenshot-gallery.test.ts and
 * lib/metadata/play-proposals-review-component.test.ts for their own
 * components). These assertions read the components' literal text; the
 * pure logic they delegate to (query validation, the search call itself)
 * is exercised directly and behaviorally in lib/search.test.ts.
 */

const headerSearchSrc = readFileSync(
  fileURLToPath(new URL("../components/HeaderSearch.tsx", import.meta.url)),
  "utf8",
);
const siteHeaderSrc = readFileSync(
  fileURLToPath(new URL("../components/SiteHeader.tsx", import.meta.url)),
  "utf8",
);
const mobileSearchOverlaySrc = readFileSync(
  fileURLToPath(new URL("../components/MobileSearchOverlay.tsx", import.meta.url)),
  "utf8",
);

group("HeaderSearch — debouncing and stale-request protection", () => {
  test("debounces requests by exactly 250ms", () => {
    assert.match(headerSearchSrc, /const DEBOUNCE_MS = 250;/);
    assert.match(headerSearchSrc, /}, DEBOUNCE_MS\);/);
  });

  test("uses AbortController and aborts the previous request/timer on every new keystroke", () => {
    assert.match(headerSearchSrc, /new AbortController\(\)/);
    assert.match(headerSearchSrc, /signal: controller\.signal/);
    assert.match(headerSearchSrc, /clearTimeout\(timer\);\s*\n\s*controller\.abort\(\);/);
  });

  test("ignores an aborted request's own error rather than clearing results with a race-losing response", () => {
    assert.match(headerSearchSrc, /if \(\(caught as Error\)\.name !== "AbortError"\) setResults\(\[\]\);/);
  });
});

group("HeaderSearch — minimum query length", () => {
  test("gates on MIN_QUERY_LENGTH imported from lib/search — never a second, hardcoded threshold", () => {
    assert.match(headerSearchSrc, /import \{ MIN_QUERY_LENGTH, type AppSearchResult \} from "@\/lib\/search";/);
    assert.match(headerSearchSrc, /trimmed\.length < MIN_QUERY_LENGTH/);
  });
});

group("HeaderSearch — the actual fetch call", () => {
  test("calls /api/search with the query URL-encoded", () => {
    assert.match(headerSearchSrc, /fetch\(`\/api\/search\?q=\$\{encodeURIComponent\(trimmed\)\}`/);
  });

  test("shows a loading state while the request is in flight", () => {
    assert.match(headerSearchSrc, /setLoading\(true\)/);
    assert.match(headerSearchSrc, /Searching…/);
  });
});

group("HeaderSearch — keyboard navigation", () => {
  test("handles ArrowDown, ArrowUp, and Escape", () => {
    assert.match(headerSearchSrc, /event\.key === "ArrowDown"/);
    assert.match(headerSearchSrc, /event\.key === "ArrowUp"/);
    assert.match(headerSearchSrc, /event\.key === "Escape"/);
  });

  test("Enter on the highlighted suggestion navigates to that app; otherwise falls through to view-all", () => {
    assert.match(headerSearchSrc, /if \(highlighted >= 0 && activeResults\[highlighted\]\) \{/);
    assert.match(headerSearchSrc, /goToApp\(activeResults\[highlighted\]\.slug\);/);
  });

  test("Enter is handled explicitly in onKeyDown, not left to the browser's implicit form-submission default action alone", () => {
    const onKeyDown = headerSearchSrc.slice(headerSearchSrc.indexOf("function onKeyDown"));
    assert.match(onKeyDown, /event\.key === "Enter"/);
    assert.match(onKeyDown, /selectHighlightedOrViewAll\(\);/);
  });

  test("highlighted index wraps around in both directions", () => {
    assert.match(headerSearchSrc, /\(i \+ 1\) % activeResults\.length/);
    assert.match(headerSearchSrc, /i <= 0 \? activeResults\.length - 1 : i - 1/);
  });
});

group("HeaderSearch — selection and navigation", () => {
  test("clicking a suggestion navigates to /app/<slug> — the project's existing app URL convention, not /apps/<slug>", () => {
    assert.match(headerSearchSrc, /router\.push\(`\/app\/\$\{slug\}`\);/);
  });

  test("clicking a suggestion also closes the dropdown", () => {
    const goToApp = headerSearchSrc.slice(headerSearchSrc.indexOf("function goToApp"));
    assert.match(goToApp, /setOpen\(false\);/);
  });
});

group("HeaderSearch — view all results", () => {
  test("view-all href matches the existing full-catalogue search convention exactly: /?search=<q>#catalogue", () => {
    assert.match(headerSearchSrc, /`\/\?search=\$\{encodeURIComponent\(q\)\}#catalogue`/);
    assert.match(headerSearchSrc, /"\/#catalogue"/);
  });

  test("a 'View all results' link is rendered once the minimum query length is met", () => {
    assert.match(headerSearchSrc, /View all results for/);
    assert.match(headerSearchSrc, /term\.trim\(\)\.length >= MIN_QUERY_LENGTH/);
  });

  test("does not introduce a new search-results page — no new route file referenced", () => {
    assert.doesNotMatch(headerSearchSrc, /\/search-results/);
    assert.doesNotMatch(headerSearchSrc, /\/results\?/);
  });
});

group("HeaderSearch — accessibility and outside-click", () => {
  test("uses combobox/listbox roles with aria-expanded/aria-controls/aria-activedescendant", () => {
    assert.match(headerSearchSrc, /role="combobox"/);
    assert.match(headerSearchSrc, /aria-expanded=\{showDropdown\}/);
    assert.match(headerSearchSrc, /aria-controls=\{listboxId\}/);
    assert.match(headerSearchSrc, /aria-activedescendant=/);
    assert.match(headerSearchSrc, /role="listbox"/);
    assert.match(headerSearchSrc, /role="option"/);
  });

  test("closes the dropdown on an outside pointer-down, mirroring CatalogueSection's own pattern", () => {
    assert.match(headerSearchSrc, /document\.addEventListener\("mousedown", onPointerDown\)/);
    assert.match(headerSearchSrc, /containerRef\.current\?\.contains\(event\.target as Node\)/);
  });
});

group("HeaderSearch — no unsafe credentials", () => {
  test("never references the service-role key or constructs a Supabase client directly", () => {
    assert.doesNotMatch(headerSearchSrc, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(headerSearchSrc, /createClient\(/);
  });
});

group("SiteHeader — wiring and preserved structure", () => {
  test("renders HeaderSearch once, for the desktop slot", () => {
    assert.match(siteHeaderSrc, /import HeaderSearch from "@\/components\/HeaderSearch";/);
    const occurrences = siteHeaderSrc.match(/<HeaderSearch/g) ?? [];
    assert.equal(occurrences.length, 1);
    assert.match(siteHeaderSrc, /idPrefix="header-desktop"/);
  });

  test("preserves the logo, nav links, and admin bar", () => {
    assert.match(siteHeaderSrc, /<Logo \/>/);
    assert.match(siteHeaderSrc, /<AdminBar \/>/);
    assert.match(siteHeaderSrc, /const NAV = \[/);
  });

  /**
   * Redesign (mobile bottom nav): phones no longer get an always-visible
   * inline search bar in the header — that role moved to the bottom nav's
   * Search tab, which opens MobileSearchOverlay (still HeaderSearch
   * underneath, just presented full-screen with autofocus). SiteHeader's
   * own mobile affordance is now a compact icon that opens the same
   * overlay, so there's exactly one mobile search experience, not two.
   */
  test("desktop search bar stays hidden flex-1 justify-center md:flex; mobile gets a search icon opening the shared overlay instead of an inline bar", () => {
    assert.match(siteHeaderSrc, /hidden flex-1 justify-center md:flex/);
    assert.doesNotMatch(siteHeaderSrc, /border-t border-base-800 px-4 py-2 md:hidden/);
    assert.match(siteHeaderSrc, /import \{ useMobileUi \} from "@\/components\/MobileUiProvider";/);
    assert.match(siteHeaderSrc, /const \{ openSearch \} = useMobileUi\(\);/);
    assert.match(siteHeaderSrc, /onClick=\{openSearch\}/);
  });

  test("no longer defines its own submit handler or search state — that's HeaderSearch's job now", () => {
    assert.doesNotMatch(siteHeaderSrc, /function submit\(/);
    assert.doesNotMatch(siteHeaderSrc, /useState\(""\)/);
  });
});

group("MobileSearchOverlay — reuses HeaderSearch as-is, no parallel search logic", () => {
  test("renders HeaderSearch with its own idPrefix, autofocuses it, and closes on Escape", () => {
    assert.match(mobileSearchOverlaySrc, /import HeaderSearch from "@\/components\/HeaderSearch";/);
    // Multi-line JSX since the P1 mobile-search-scroll fix added a third
    // prop (scrollableResults) — see the "opts into..." test below.
    assert.match(mobileSearchOverlaySrc, /<HeaderSearch\s*\n\s*idPrefix="mobile-overlay"/);
    assert.match(mobileSearchOverlaySrc, /input\?\.focus\(\);/);
    assert.match(mobileSearchOverlaySrc, /event\.key === "Escape"/);
  });

  test("opts into HeaderSearch's scrollableResults mode — the P1 fix for the suggestions list having no scrollable ancestor inside this overlay's fixed, body-scroll-locked container", () => {
    assert.match(
      mobileSearchOverlaySrc,
      /<HeaderSearch\s*\n\s*idPrefix="mobile-overlay"\s*\n\s*placeholder="Search apps, packages, developers…"\s*\n\s*scrollableResults\s*\n\s*\/>/,
    );
  });

  test("only renders when the shared overlay state says 'search' — no independent open/close state of its own", () => {
    assert.match(mobileSearchOverlaySrc, /import \{ useMobileUi \} from "@\/components\/MobileUiProvider";/);
    assert.match(mobileSearchOverlaySrc, /const open = overlay === "search";/);
    assert.match(mobileSearchOverlaySrc, /if \(!open\) return null;/);
  });
});
