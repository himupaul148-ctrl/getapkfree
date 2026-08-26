"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import AppCard from "@/components/AppCard";
import FilterControls from "@/components/catalogue/FilterControls";
import { useFilters } from "@/components/catalogue/FilterProvider";
import { androidLevel, trendingScore } from "@/lib/format";
import type { AppSummary } from "@/lib/types";

const MAX_SUGGESTIONS = 6;

/** Name, description and package name, plus developer and category. */
function matches(app: AppSummary, needle: string): boolean {
  return (
    app.name.toLowerCase().includes(needle) ||
    (app.description?.toLowerCase().includes(needle) ?? false) ||
    (app.packageName?.toLowerCase().includes(needle) ?? false) ||
    (app.developer?.toLowerCase().includes(needle) ?? false) ||
    (app.category?.toLowerCase().includes(needle) ?? false)
  );
}

export default function CatalogueSection({ apps }: { apps: AppSummary[] }) {
  const router = useRouter();
  const {
    search,
    setSearch,
    category,
    android,
    sort,
    reset,
    activeCount,
    isDefault,
  } = useFilters();


  const [openSuggestions, setOpenSuggestions] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!searchRef.current?.contains(event.target as Node)) {
        setOpenSuggestions(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  // Lock the page behind the drawer and let Escape close it.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const needle = search.trim().toLowerCase();

  const suggestions = useMemo(() => {
    if (!needle) return [];
    // Names first: someone typing a name wants that app, not a description hit.
    const byName = apps.filter((app) => app.name.toLowerCase().includes(needle));
    const rest = apps.filter(
      (app) => !app.name.toLowerCase().includes(needle) && matches(app, needle),
    );
    return [...byName, ...rest].slice(0, MAX_SUGGESTIONS);
  }, [apps, needle]);

  const results = useMemo(() => {
    const deviceLevel = androidLevel(android || null);

    const filtered = apps.filter((app) => {
      if (needle && !matches(app, needle)) return false;
      if (category && app.category !== category) return false;
      // "Android X+" is the device you have — show what will install on it.
      if (deviceLevel && androidLevel(app.minAndroid) > deviceLevel) return false;
      return true;
    });

    const sorted = [...filtered];
    switch (sort) {
      case "downloads":
        sorted.sort((a, b) => b.downloadCount - a.downloadCount);
        break;
      case "newest":
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case "rating":
        sorted.sort(
          (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.ratingCount - a.ratingCount,
        );
        break;
      case "updated":
        sorted.sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""));
        break;
      default:
        sorted.sort(
          (a, b) =>
            trendingScore(b.downloadCount, b.lastUpdated) -
            trendingScore(a.downloadCount, a.lastUpdated),
        );
    }
    return sorted;
  }, [apps, needle, category, android, sort]);

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!openSuggestions || suggestions.length === 0) return;
    // "Down"/"Up" are the legacy key names some input stacks still emit.
    if (event.key === "ArrowDown" || event.key === "Down") {
      event.preventDefault();
      setHighlighted((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" || event.key === "Up") {
      event.preventDefault();
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && highlighted >= 0) {
      event.preventDefault();
      router.push(`/app/${suggestions[highlighted].slug}`);
    } else if (event.key === "Escape") {
      setOpenSuggestions(false);
    }
  }

  return (
    <section id="catalogue" className="mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">All apps</h2>
          <p className="mt-1 text-sm text-fg-muted" aria-live="polite">
            Showing {results.length} app{results.length === 1 ? "" : "s"}
            {isDefault ? "" : ` of ${apps.length}`}
            {category && ` in ${category}`}
          </p>
        </div>
        {!isDefault && (
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-base-700 px-3 py-2 text-sm text-fg-muted transition-colors hover:border-base-600 hover:text-fg"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-5 rounded-2xl border border-base-800 bg-base-900 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          {/* Search stays visible at every width. */}
          <div ref={searchRef} className="relative">
            <label htmlFor="catalogue-search" className="sr-only">
              Search apps
            </label>
            <svg
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-dim"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              id="catalogue-search"
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpenSuggestions(true);
                setHighlighted(-1);
              }}
              onFocus={() => setOpenSuggestions(true)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search apps, packages, developers…"
              autoComplete="off"
              role="combobox"
              aria-expanded={openSuggestions && suggestions.length > 0}
              aria-controls="catalogue-suggestions"
              className="w-full rounded-xl border border-base-700 bg-base-850 py-2.5 pr-4 pl-10 text-sm text-fg placeholder:text-fg-dim focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
            />

            {openSuggestions && suggestions.length > 0 && (
              <ul
                id="catalogue-suggestions"
                role="listbox"
                className="absolute top-full right-0 left-0 z-20 mt-2 overflow-hidden rounded-xl border border-base-700 bg-base-850 shadow-xl shadow-black/40"
              >
                {suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion.id}
                    role="option"
                    aria-selected={index === highlighted}
                  >
                    <button
                      type="button"
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => router.push(`/app/${suggestion.slug}`)}
                      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm ${
                        index === highlighted ? "bg-base-800" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-fg">
                        {suggestion.name}
                      </span>
                      <span className="shrink-0 text-xs text-fg-dim">
                        {suggestion.category}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Desktop: dropdowns inline. Mobile: behind the Filters button. */}
          <div className="hidden md:contents">
            <FilterControls idPrefix="desktop" />
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-haspopup="dialog"
            className="flex items-center justify-center gap-2 rounded-xl border border-base-700 bg-base-850 px-4 py-2.5 text-sm text-fg md:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 6h16M7 12h10M10 18h4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Filters
            {activeCount > 0 && (
              <span className="rounded-full bg-brand-500 px-1.5 text-xs font-bold text-base-950">
                {activeCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 md:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-base-700 bg-base-900 p-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Filters</h3>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close filters"
                className="rounded-lg border border-base-700 p-2 text-fg-muted"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <FilterControls idPrefix="drawer" />
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={reset}
                className="flex-1 rounded-xl border border-base-700 px-4 py-3 text-sm text-fg-muted"
              >
                Clear filters
              </button>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex-1 rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-base-950"
              >
                Show {results.length} app{results.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}

      {results.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-base-800 bg-base-900 p-8 text-center">
          <p className="text-fg-muted">No apps match those filters.</p>
          <button
            type="button"
            onClick={reset}
            className="mt-3 text-sm font-medium text-brand-400 hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      )}
    </section>
  );
}
