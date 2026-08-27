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

  // Keep the controls honest when the user navigates back or forward.
  useEffect(() => {
    setQuery(initialQuery);
    setCategory(initialCategory);
  }, [initialQuery, initialCategory]);

  function push(nextQuery: string, nextCategory: string) {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextCategory) params.set("category", nextCategory);
    const qs = params.toString();
    router.push(qs ? `/blog?${qs}` : "/blog");
  }

  useEffect(() => {
    if (query === initialQuery) return;
    const timer = setTimeout(() => push(query, category), 350);
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
            push(query, e.target.value);
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
