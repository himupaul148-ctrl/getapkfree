"use client";

import { useMemo, useState } from "react";

export type PickerApp = { id: string; name: string; category: string | null };

/**
 * Multi-select over the catalogue.
 *
 * Order is meaningful — the sidebar renders apps in the order chosen here — so
 * selections append rather than sorting themselves, and the chips show that
 * order back to the author.
 */
export default function RelatedAppPicker({
  apps,
  selected,
  onChange,
  max = 10,
}: {
  apps: PickerApp[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max?: number;
}) {
  const [query, setQuery] = useState("");

  const byId = useMemo(
    () => new Map(apps.map((app) => [app.id, app])),
    [apps],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return apps
      .filter(
        (app) =>
          !selected.includes(app.id) &&
          app.name.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [apps, query, selected]);

  function add(id: string) {
    if (selected.length >= max || selected.includes(id)) return;
    onChange([...selected, id]);
    setQuery("");
  }

  return (
    <div>
      <label htmlFor="related-search" className="block text-sm font-medium">
        Related apps
      </label>
      <p className="mt-1 text-xs text-fg-dim">
        Shown in the post sidebar, in this order. Up to {max}.
      </p>

      <div className="relative mt-2">
        <input
          id="related-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            selected.length >= max
              ? `${max} selected — remove one to add another`
              : "Search the catalogue…"
          }
          disabled={selected.length >= max}
          className="w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 disabled:opacity-50"
        />

        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-base-700 bg-base-850 py-1 shadow-xl">
            {matches.map((app) => (
              <li key={app.id}>
                <button
                  type="button"
                  onClick={() => add(app.id)}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm text-fg-muted hover:bg-base-800 hover:text-fg"
                >
                  <span className="truncate">{app.name}</span>
                  {app.category && (
                    <span className="shrink-0 text-xs text-fg-dim">
                      {app.category}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {selected.map((id, index) => {
            const app = byId.get(id);
            return (
              <li
                key={id}
                className="inline-flex items-center gap-2 rounded-full border border-base-700 bg-base-900 py-1 pr-1.5 pl-3 text-xs"
              >
                <span className="text-fg-dim">{index + 1}.</span>
                {/* An id with no matching app means the app was deleted. */}
                <span className={app ? "text-fg-muted" : "text-warn-300"}>
                  {app?.name ?? "Missing app"}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((s) => s !== id))}
                  aria-label={`Remove ${app?.name ?? "app"}`}
                  className="rounded-full p-1 text-fg-dim transition-colors hover:bg-base-800 hover:text-danger-300"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
