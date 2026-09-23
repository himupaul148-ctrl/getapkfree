"use client";

import { useMemo, useState } from "react";
import type { PickerApp } from "./RelatedAppPicker";

/**
 * Single-select "which app is this about" picker for the three-type blog
 * system's target_app_id — a genuinely different relationship from
 * RelatedAppPicker's multi-select related_app_ids (other apps the article
 * mentions). Reuses RelatedAppPicker's own search-and-list interaction
 * pattern and styling so the two feel like one consistent system, but
 * selecting an app here replaces the current choice rather than appending
 * to a list, and the selected app is shown as a single, unambiguous chip —
 * never a multi-item list — so it can never be mistaken for the related-apps
 * relationship sitting right below it in the form.
 */
export default function TargetAppPicker({
  apps,
  selectedId,
  onChange,
  required,
}: {
  apps: PickerApp[];
  selectedId: string | null;
  onChange: (id: string | null) => void;
  required?: boolean;
}) {
  const [query, setQuery] = useState("");

  const byId = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps]);
  const selected = selectedId ? byId.get(selectedId) : undefined;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return apps.filter((app) => app.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [apps, query]);

  function select(id: string) {
    onChange(id);
    setQuery("");
  }

  return (
    <div>
      <label htmlFor="target-app-search" className="block text-sm font-medium">
        Which app is this about? {required && <span className="text-danger-300">*</span>}
      </label>
      <p className="mt-1 text-xs text-fg-dim">
        The one app this article is about — separate from Related Apps below.
      </p>

      {selectedId && selected ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-brand-500/40 bg-brand-500/10 px-3.5 py-2.5 text-sm">
          <span className="truncate font-medium text-fg">{selected.name}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Change target app (currently ${selected.name})`}
            className="shrink-0 rounded-full p-1 text-fg-dim transition-colors hover:bg-base-800 hover:text-danger-300"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : selectedId ? (
        // An id that no longer resolves to a real app — deleted from the
        // catalogue since this post was tagged. Surfaced rather than
        // silently hidden, with the same one-click way out as a normal
        // selection.
        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-3.5 py-2.5 text-sm text-warn-300">
          <span>Selected app no longer exists in the catalogue.</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-lg border border-warn-500/40 px-2 py-1 text-xs hover:bg-warn-500/10"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="relative mt-2">
          <input
            id="target-app-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // This input sits inside BlogEditor's real <form>; Enter here
              // would otherwise submit it and publish the post. There's no
              // highlighted-match state to select on Enter (unlike
              // HeaderSearch's combobox), so this only swallows the
              // keystroke — it doesn't pick anything.
              if (e.key === "Enter") e.preventDefault();
            }}
            placeholder="Search the catalogue…"
            className="w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
          />

          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-base-700 bg-base-850 py-1 shadow-xl">
              {matches.map((app) => (
                <li key={app.id}>
                  <button
                    type="button"
                    onClick={() => select(app.id)}
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-sm text-fg-muted hover:bg-base-800 hover:text-fg"
                  >
                    <span className="truncate">{app.name}</span>
                    {app.category && (
                      <span className="shrink-0 text-xs text-fg-dim">{app.category}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
