"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SortKey } from "@/lib/types";

export type Filters = {
  search: string;
  category: string;
  android: string;
  sort: SortKey;
};

type FilterContextValue = Filters & {
  setSearch: (value: string) => void;
  setCategory: (value: string) => void;
  toggleCategory: (value: string) => void;
  setAndroid: (value: string) => void;
  setSort: (value: SortKey) => void;
  reset: () => void;
  activeCount: number;
  isDefault: boolean;
};

const FilterContext = createContext<FilterContextValue | null>(null);

export function useFilters(): FilterContextValue {
  const value = useContext(FilterContext);
  if (!value) throw new Error("useFilters must be used inside <FilterProvider>");
  return value;
}

/**
 * One source of truth for the homepage filters. The category cards and the
 * catalogue's dropdowns both read from here, so selecting a category in one
 * place immediately highlights it in the other — they cannot drift apart.
 */
export default function FilterProvider({
  initial,
  children,
}: {
  initial: Filters;
  children: React.ReactNode;
}) {
  const [search, setSearch] = useState(initial.search);
  const [category, setCategory] = useState(initial.category);
  const [android, setAndroid] = useState(initial.android);
  const [sort, setSort] = useState<SortKey>(initial.sort);

  // Mirror the state into the URL so a filtered view can be bookmarked or
  // shared. replaceState keeps this out of the back-history (typing would
  // otherwise create an entry per keystroke) and preserves the App Router's
  // own history state — passing null there breaks later router.push() calls.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (category) params.set("category", category);
    if (android) params.set("android", android);
    if (sort !== "trending") params.set("sort", sort);
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", qs ? `/?${qs}` : "/");
  }, [search, category, android, sort]);

  const toggleCategory = useCallback((value: string) => {
    // Tapping the selected card again clears it, so the cards work as a filter
    // rather than a one-way trip.
    setCategory((current) => (current === value ? "" : value));
  }, []);

  const reset = useCallback(() => {
    setSearch("");
    setCategory("");
    setAndroid("");
    setSort("trending");
  }, []);

  const value = useMemo<FilterContextValue>(() => {
    const activeCount =
      (search.trim() ? 1 : 0) +
      (category ? 1 : 0) +
      (android ? 1 : 0) +
      (sort !== "trending" ? 1 : 0);

    return {
      search,
      category,
      android,
      sort,
      setSearch,
      setCategory,
      toggleCategory,
      setAndroid,
      setSort,
      reset,
      activeCount,
      isDefault: activeCount === 0,
    };
  }, [search, category, android, sort, toggleCategory, reset]);

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}
