"use client";

import { useFilters } from "@/components/catalogue/FilterProvider";
import { CATEGORIES } from "@/lib/types";

const ICONS: Record<string, React.ReactNode> = {
  Tools: <path d="m14 7 3-3 3 3-3 3M4 20l7-7M7 4l3 3-6 6-3-3z" />,
  Games: <path d="M6 12h4m-2-2v4m6 1h.01M17 10h.01M4 8h16v8H4z" />,
  Productivity: <path d="M8 4h8v4H8zM5 8h14v12H5zm4 5h6m-6 4h4" />,
  Multimedia: <path d="M4 5h16v14H4zm6 3 6 4-6 4z" />,
  Internet: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 0c-3 3-3 15 0 18m0-18c3 3 3 15 0 18M3 12h18" />,
  System: <path d="M8 8h8v8H8zM4 10h4m-4 4h4m8-4h4m-4 4h4M10 4v4m4-4v4m-4 8v4m4-4v4" />,
  Education: <path d="m3 8 9-4 9 4-9 4zM7 11v5c0 1.5 2.5 3 5 3s5-1.5 5-3v-5" />,
  Writing: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
};

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

  return (
    <section id="categories" className="mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Browse by category</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {active
              ? `Showing ${active}. Tap it again to clear.`
              : "Every app is filed under one of eight categories."}
          </p>
        </div>
      </div>

      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {CATEGORIES.map((name) => {
          const isActive = name === active;
          return (
            <li key={name}>
              <button
                type="button"
                onClick={() => choose(name)}
                aria-pressed={isActive}
                className={`group flex h-full w-full flex-col gap-3 rounded-2xl border p-5 text-left transition-colors ${
                  isActive
                    ? "border-brand-500 bg-brand-500/10"
                    : "border-base-800 bg-base-900 hover:border-brand-500/50 hover:bg-base-850"
                }`}
              >
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                    isActive
                      ? "bg-brand-500 text-base-950"
                      : "bg-brand-500/10 text-brand-400 group-hover:bg-brand-500/20"
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
                    {ICONS[name]}
                  </svg>
                </span>

                <span
                  className={`font-semibold transition-colors ${
                    isActive ? "text-brand-300" : "text-fg group-hover:text-brand-400"
                  }`}
                >
                  {name}
                </span>

                <span className="flex items-center gap-2 text-xs text-fg-dim">
                  {counts[name] ?? 0} app{counts[name] === 1 ? "" : "s"}
                  {isActive && (
                    <span className="text-brand-400" aria-hidden="true">
                      • selected
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
