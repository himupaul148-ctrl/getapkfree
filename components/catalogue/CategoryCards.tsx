"use client";

import Link from "next/link";
import { useFilters } from "@/components/catalogue/FilterProvider";
import { CATEGORY_ICON_PATHS, CATEGORY_TINTS } from "@/lib/category-icons";
import { CATEGORIES } from "@/lib/types";
import type { Category } from "@/lib/category-content";

export default function CategoryCards({
  counts,
}: {
  counts: Record<string, number>;
}) {
  const { category: active, toggleCategory } = useFilters();

  function choose(name: string) {
    toggleCategory(name);
    // Filtering happens further down the page; take the reader there.
    document
      .getElementById("catalogue")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * The card is a real <Link> now (see below) so Googlebot, a no-JS visitor,
   * and a Cmd/Ctrl/middle-click (open in a new tab) all get a genuine,
   * working navigation to the same canonical category URL
   * components/SiteFooter.tsx already links with. A plain left-click keeps
   * the existing instant, client-side filter toggle instead of a real
   * navigation — this component's entire reason to exist is letting the
   * catalogue below re-filter immediately, without a server round trip, so
   * that behavior is preserved deliberately rather than replaced by <Link>'s
   * own routing.
   */
  function handleClick(event: React.MouseEvent<HTMLAnchorElement>, name: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    choose(name);
  }

  return (
    <section id="categories" className="mt-12 sm:mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Popular Categories</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {active
              ? `Showing ${active}. Tap it again to clear.`
              : "Every app is filed under one of eight categories."}
          </p>
        </div>
      </div>

      <ul className="mt-5 grid grid-cols-3 gap-2.5 sm:mt-6 sm:grid-cols-4 sm:gap-4 lg:grid-cols-4">
        {CATEGORIES.map((name) => {
          const isActive = name === active;
          const tint = CATEGORY_TINTS[name as Category];
          return (
            <li key={name}>
              <Link
                href={`/?category=${encodeURIComponent(name)}#catalogue`}
                onClick={(event) => handleClick(event, name)}
                aria-current={isActive ? "true" : undefined}
                className={`group flex h-full w-full flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors sm:items-start sm:gap-3 sm:p-5 sm:text-left ${
                  isActive
                    ? "border-brand-500 bg-brand-500/10"
                    : "border-base-800 bg-base-900 hover:border-brand-500/50 hover:bg-base-850"
                }`}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                    isActive ? "bg-brand-500 text-base-950" : `${tint.bg} ${tint.text}`
                  }`}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={CATEGORY_ICON_PATHS[name as Category]} />
                  </svg>
                </span>

                <span
                  className={`text-xs font-semibold transition-colors sm:text-base ${
                    isActive ? "text-brand-300" : "text-fg group-hover:text-brand-400"
                  }`}
                >
                  {name}
                </span>

                <span className="hidden items-center gap-2 text-xs text-fg-dim sm:flex">
                  {counts[name] ?? 0} app{counts[name] === 1 ? "" : "s"}
                  {isActive && (
                    <span className="text-brand-400" aria-hidden="true">
                      • selected
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
