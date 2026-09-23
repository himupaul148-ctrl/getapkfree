"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AppIcon from "@/components/AppIcon";
import { MIN_QUERY_LENGTH, type AppSearchResult } from "@/lib/search";

const DEBOUNCE_MS = 250;

/**
 * Live, app-only header search — replaces SiteHeader's old submit-only
 * form. Debounces requests to /api/search, cancels/ignores stale ones via
 * AbortController, and falls back to the exact same full-catalogue search
 * ("/?search=<q>#catalogue") the old form already used whenever the user
 * presses Enter without picking a suggestion, or clicks "View all
 * results" — that full-results page (components/catalogue/CatalogueSection.tsx)
 * is unchanged by this component.
 *
 * Rendered twice by SiteHeader (desktop + mobile) — each instance is
 * fully self-contained with its own state, matching the two independent
 * <input> elements the original header already had. `idPrefix` keeps
 * their DOM ids (and therefore aria-controls) from colliding.
 */
export default function HeaderSearch({
  idPrefix,
  placeholder,
  className = "",
  size = "default",
  scrollableResults = false,
}: {
  idPrefix: string;
  placeholder: string;
  className?: string;
  /** "large" is the homepage hero's own visual scale — same debounce/fetch/
      suggestions logic throughout, just bigger padding, text and button so
      it reads as the page's primary search rather than the header's. */
  size?: "default" | "large";
  /**
   * Opt-in only — set by MobileSearchOverlay, whose own `fixed inset-0`
   * full-screen container disables page scroll entirely while open
   * (document.body.style.overflow = "hidden"), so a result list with no
   * bound of its own has no scrollable ancestor at all: at a short/keyboard-
   * reduced viewport, lower results (and the trailing "View all results"
   * link, the list's own last item) can render past the bottom edge with no
   * way to reach them. Every other instance of this component (the desktop
   * header, the homepage hero search) renders inside a normally-scrolling
   * page, where an overflowing dropdown was never actually unreachable —
   * so this stays false there, deliberately, to leave their behavior
   * byte-for-byte unchanged.
   */
  scrollableResults?: boolean;
}) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<AppSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click — same pattern CatalogueSection.tsx already uses.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Keeps the arrow-key-highlighted option in view when the results list has
  // its own bounded/scrollable height (scrollableResults) — without this, an
  // ArrowDown past the visible area still updates `highlighted` correctly
  // (ARIA/aria-activedescendant already reflects it) but the option itself
  // stays scrolled out of sight. A harmless no-op everywhere the list isn't
  // height-constrained (scrollIntoView on an element already fully in view
  // does nothing), so this runs unconditionally rather than only when
  // scrollableResults is set.
  useEffect(() => {
    if (highlighted < 0) return;
    document
      .getElementById(`${idPrefix}-search-option-${highlighted}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted, idPrefix]);

  // Debounced, cancellable fetch. The cleanup function both clears a timer
  // that hasn't fired yet AND aborts an in-flight request from the
  // previous keystroke — either way, a stale response can never overwrite
  // a newer one, since its own fetch was told to abort before the next
  // effect run's state updates could ever happen.
  useEffect(() => {
    const trimmed = term.trim();
    // Below the minimum length: no request, and no state update either —
    // `belowMinLength` below already masks `results`/`loading` down to
    // "nothing" for rendering, so there's nothing to reset here. (Calling
    // setState synchronously in an effect body is also a lint error in
    // this project — deriving it at render time avoids that entirely.)
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      // Set inside the debounce callback, not synchronously in the effect
      // body: the lint rule for this project's React version flags any
      // setState call made directly at the top of an effect. This also
      // means the loading indicator only appears once the debounce window
      // has actually elapsed, which avoids a flash of "Searching…" on
      // every single keystroke.
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`search request failed (${res.status})`);
        const body: { results?: AppSearchResult[] } = await res.json();
        setResults(body.results ?? []);
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  function viewAllResultsHref(): string {
    const q = term.trim();
    return q ? `/?search=${encodeURIComponent(q)}#catalogue` : "/#catalogue";
  }

  function goToApp(slug: string) {
    setOpen(false);
    router.push(`/app/${slug}`);
  }

  // Derived, not stored: below the minimum length there is nothing to
  // show regardless of whatever `results`/`loading` happen to still hold
  // from a previous, longer query — masking it here (rather than resetting
  // that state from inside the effect above) is what keeps the effect free
  // of a synchronous setState call.
  const belowMinLength = term.trim().length < MIN_QUERY_LENGTH;
  const activeResults = belowMinLength ? [] : results;
  const isLoading = belowMinLength ? false : loading;

  /**
   * Selecting the highlighted suggestion (if any), or falling through to
   * the full-catalogue "view all" search — the one decision both the
   * form's native submit AND the input's own Enter keydown need to make.
   * Handling Enter explicitly in onKeyDown (below), rather than relying
   * solely on the browser's implicit form-submission default action, is
   * deliberate: that native behavior is inconsistent across automated
   * input (and some real browser/IME combinations) for a text input that
   * isn't the form's only interactive element — explicit handling here
   * removes that dependency entirely rather than hoping it fires.
   */
  function selectHighlightedOrViewAll() {
    if (highlighted >= 0 && activeResults[highlighted]) {
      goToApp(activeResults[highlighted].slug);
      return;
    }
    setOpen(false);
    router.push(viewAllResultsHref());
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    selectHighlightedOrViewAll();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter") {
      // preventDefault regardless of whether the browser would also fire
      // its own native form submission for this same keypress — if it
      // does, this still avoids a second, duplicate navigation.
      event.preventDefault();
      selectHighlightedOrViewAll();
      return;
    }
    if (!open || activeResults.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((i) => (i + 1) % activeResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((i) => (i <= 0 ? activeResults.length - 1 : i - 1));
    }
  }

  const showDropdown = open && (isLoading || activeResults.length > 0 || term.trim().length >= MIN_QUERY_LENGTH);
  const listboxId = `${idPrefix}-search-suggestions`;
  const large = size === "large";

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <form onSubmit={submit} role="search">
        <div className="relative">
          <SearchGlyph large={large} />
          <input
            id={`${idPrefix}-search-input`}
            type="search"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
              setHighlighted(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="Search apps"
            autoComplete="off"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={listboxId}
            aria-activedescendant={highlighted >= 0 ? `${idPrefix}-search-option-${highlighted}` : undefined}
            className={
              large
                ? "w-full rounded-2xl border-2 border-brand-500/25 bg-base-900 py-3.5 pr-[4.75rem] pl-11 text-base text-fg placeholder:text-fg-dim focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 focus:outline-none sm:pr-24 sm:pl-12"
                : "w-full rounded-full border border-base-700 bg-base-850 py-2 pr-20 pl-10 text-sm text-fg placeholder:text-fg-dim focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
            }
          />
          <button
            type="submit"
            className={
              large
                ? "absolute top-1.5 right-1.5 bottom-1.5 rounded-xl bg-brand-500 px-3.5 text-sm font-semibold text-base-950 transition-colors hover:bg-brand-400 sm:px-5"
                : "absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-base-950 transition-colors hover:bg-brand-400"
            }
          >
            Search
          </button>
        </div>
      </form>

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className={`absolute top-full right-0 left-0 z-30 mt-2 rounded-xl border border-base-700 bg-base-850 shadow-xl shadow-black/40 ${
            scrollableResults
              ? "max-h-[calc(100dvh-6rem-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain"
              : "overflow-hidden"
          }`}
        >
          {isLoading && activeResults.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-fg-dim" aria-live="polite">
              Searching…
            </li>
          ) : (
            activeResults.map((app, index) => (
              <li key={app.id} id={`${idPrefix}-search-option-${index}`} role="option" aria-selected={index === highlighted}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => goToApp(app.slug)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm ${
                    index === highlighted ? "bg-base-800" : ""
                  }`}
                >
                  <AppIcon src={app.iconUrl} name={app.name} size={28} />
                  <span className="min-w-0 flex-1 truncate text-fg">{app.name}</span>
                  {app.category && <span className="shrink-0 text-xs text-fg-dim">{app.category}</span>}
                </button>
              </li>
            ))
          )}

          {!isLoading && term.trim().length >= MIN_QUERY_LENGTH && (
            <li role="presentation" className="border-t border-base-800">
              <Link
                href={viewAllResultsHref()}
                onClick={() => setOpen(false)}
                className="block px-3 py-2.5 text-left text-sm font-medium text-brand-400 hover:bg-base-800"
              >
                View all results for &ldquo;{term.trim()}&rdquo;
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function SearchGlyph({ large = false }: { large?: boolean }) {
  const size = large ? 18 : 15;
  return (
    <svg
      className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-dim ${large ? "left-4" : "left-3.5"}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
