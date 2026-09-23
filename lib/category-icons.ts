import type { Category } from "@/lib/category-content";

/**
 * One shared source for every place that shows a category as an icon tile —
 * the homepage's Popular Categories grid and the category-page hero (see
 * app/page.tsx's `filters.category` branch). Plain data, not a component:
 * this project's plain `node --test` runner has no JSX transform, so a
 * shared icon *component* would not be directly testable the way this data
 * is (see lib/category-icons.test.ts) — each caller builds its own small
 * `<svg><path d={...} /></svg>` from these `d` strings instead.
 */
export const CATEGORY_ICON_PATHS: Record<Category, string> = {
  Tools: "m14 7 3-3 3 3-3 3M4 20l7-7M7 4l3 3-6 6-3-3z",
  Games: "M6 12h4m-2-2v4m6 1h.01M17 10h.01M4 8h16v8H4z",
  Productivity: "M8 4h8v4H8zM5 8h14v12H5zm4 5h6m-6 4h4",
  Multimedia: "M4 5h16v14H4zm6 3 6 4-6 4z",
  Internet: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 0c-3 3-3 15 0 18m0-18c3 3 3 15 0 18M3 12h18",
  System: "M8 8h8v8H8zM4 10h4m-4 4h4m8-4h4m-4 4h4M10 4v4m4-4v4m-4 8v4m4-4v4",
  Education: "m3 8 9-4 9 4-9 4zM7 11v5c0 1.5 2.5 3 5 3s5-1.5 5-3v-5",
  Writing: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
};

// Purely decorative per-category tint — distinct colours make a category
// identifiable at a glance in both the homepage grid and the category hero.
export const CATEGORY_TINTS: Record<Category, { bg: string; text: string }> = {
  Tools: { bg: "bg-sky-500/15", text: "text-sky-600" },
  Games: { bg: "bg-rose-500/15", text: "text-rose-600" },
  Productivity: { bg: "bg-violet-500/15", text: "text-violet-600" },
  Multimedia: { bg: "bg-amber-500/15", text: "text-amber-600" },
  Internet: { bg: "bg-cyan-500/15", text: "text-cyan-600" },
  System: { bg: "bg-slate-500/15", text: "text-slate-600" },
  Education: { bg: "bg-emerald-500/15", text: "text-emerald-600" },
  Writing: { bg: "bg-indigo-500/15", text: "text-indigo-600" },
};
