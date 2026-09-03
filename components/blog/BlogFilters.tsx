"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BLOG_CATEGORIES, CATEGORY_LABELS } from "@/lib/blog";

/**
 * Search and category controls for the listing.
 *
 * These push to the URL rather than filtering in place: every filtered view is
 * then a real, crawlable, shareable page, which is the whole point of a blog
 * that exists to pull search traffic. Search is debounced so typing does not
 * fire a navigation per keystroke.
 */
export default function BlogFilters({
  initialQuery,
  initialCategory,
}: {
  initialQuery: string;
  initialCategory: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);

  /*
   * Keep the controls honest when the user navigates back or forward: this
   * component survives that navigation (Next re-renders it with new props
   * rather than remounting it), so query/category would otherwise still show
   * whatever was last typed.
   *
   * Adjusted during render rather than in an effect — React's own pattern for
   * this exact case (see "Adjusting state when a prop changes" in the React
   * docs). A mirrored previous-props state lets the comparison run inline and
   * converge in the same render, so there is no extra effect-triggered pass
   * and no flash of the stale value.
   */
  const [prevInitial, setPrevInitial] = useState({
    query: initialQuery,
    category: initialCategory,
  });
  if (
    initialQuery !== prevInitial.query ||
    initialCategory !== prevInitial.category
  ) {
    setPrevInitial({ query: initialQuery, category: initialCategory });
    setQuery(initialQuery);
    setCategory(initialCategory);
  }

  /*
   * `mode` is the whole point here. Typing used to push one entry per
   * debounce, so searching "privacy" left five near-identical /blog?q=... in
   * the history and backing out of a post walked through all of them looking
   * like the button was dead. A search is one continuous act, so it replaces;
   * choosing a category is a deliberate step worth returning to, so it pushes.
   */
  function go(nextQuery: string, nextCategory: string, mode: "push" | "replace") {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextCategory) params.set("category", nextCategory);
    const qs = params.toString();
    const url = qs ? `/blog?${qs}` : "/blog";
    if (mode === "push") router.push(url);
    else router.replace(url);
  }

  useEffect(() => {
    if (query === initialQuery) return;
    const timer = setTimeout(() => go(query, category, "replace"), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <label htmlFor="blog-search" className="sr-only">
          Search posts
        </label>
        <input
          id="blog-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search posts…"
          className="w-full rounded-xl border border-base-700 bg-base-900 px-4 py-3 text-sm outline-none focus:border-brand-500"
        />
      </div>

      <div>
        <label htmlFor="blog-category" className="sr-only">
          Category
        </label>
        <select
          id="blog-category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            go(query, e.target.value, "push");
          }}
          className="w-full rounded-xl border border-base-700 bg-base-900 px-4 py-3 text-sm outline-none focus:border-brand-500 sm:w-52"
        >
          <option value="">All categories</option>
          {BLOG_CATEGORIES.map((c) => (
            <option key={c} value={c} className="bg-base-850">
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
