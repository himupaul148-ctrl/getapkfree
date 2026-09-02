"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  normaliseAndroid,
  normaliseCategory,
  normaliseSort,
  normaliseSource,
} from "@/lib/filters";
import type { SortKey, SourceFilter } from "@/lib/types";
import { track } from "@/lib/gtag";

export type Filters = {
  search: string;
  category: string;
  android: string;
  sort: SortKey;
  source: SourceFilter;
};

type FilterContextValue = Filters & {
  setSearch: (value: string) => void;
  setCategory: (value: string) => void;
  toggleCategory: (value: string) => void;
  setAndroid: (value: string) => void;
  setSort: (value: SortKey) => void;
  setSource: (value: SourceFilter) => void;
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
  /*
   * Seed from the live URL, falling back to what the server passed.
   *
   * On a back navigation the router restores the entry's URL — including the
   * params replaceState wrote — but `initial` still carries the payload the
   * server rendered for the unfiltered page. Reading searchParams here is what
   * makes a filtered view survive going back to it.
   */
  const params = useSearchParams();
  const seed = <T,>(key: string, fallback: T, parse: (raw: string) => T): T => {
    const raw = params.get(key);
    return raw === null ? fallback : parse(raw);
  };

  const [search, setSearch] = useState(() =>
    seed("search", initial.search, (v) => v),
  );
  const [category, setCategory] = useState(() =>
    seed("category", initial.category, normaliseCategory),
  );
  const [android, setAndroid] = useState(() =>
    seed("android", initial.android, normaliseAndroid),
  );
  const [sort, setSort] = useState<SortKey>(() =>
    seed("sort", initial.sort, normaliseSort),
  );
  const [source, setSource] = useState<SourceFilter>(() =>
    seed("source", initial.source, normaliseSource),
  );

  /*
   * Mirror the state into the URL so a filtered view can be bookmarked or
   * shared. replaceState rather than pushState keeps this out of the
   * back-history — typing would otherwise create an entry per keystroke.
   *
   * The state argument must be `null`. Next patches replaceState and attaches
   * its own router state; handing it back the *current* entry's state made it
   * re-assert a stale tree, after which the router treated the next real
   * navigation as a replace instead of a push. The visible result was that
   * clicking an app card from a filtered homepage created no history entry at
   * all, so the back button on /app/[slug] had nowhere to go and appeared
   * dead. `null` is what the Next docs prescribe, and it is load-bearing.
   */
  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (category) params.set("category", category);
    if (android) params.set("android", android);
    if (sort !== "trending") params.set("sort", sort);
    if (source !== "all") params.set("source", source);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
  }, [search, category, android, sort, source]);

  /*
   * One event per filter dimension that actually changed. The mount pass is
   * skipped so arriving on a shared /?category=Games link does not report a
   * filter the visitor never applied, and empty values are skipped so
   * *clearing* a filter is not counted as applying one.
   */
  const previous = useRef({ category, android, sort, source });
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      previous.current = { category, android, sort, source };
      return;
    }

    const now = { category, android, sort, source };
    for (const key of ["category", "android", "sort", "source"] as const) {
      const value = now[key];
      if (value === previous.current[key]) continue;
      if (!value || value === "all") continue;
      track("filter_applied", { filter_type: key, filter_value: String(value) });
    }
    previous.current = now;
  }, [category, android, sort, source]);

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
    setSource("all");
  }, []);

  const value = useMemo<FilterContextValue>(() => {
    const activeCount =
      (search.trim() ? 1 : 0) +
      (category ? 1 : 0) +
      (android ? 1 : 0) +
      (sort !== "trending" ? 1 : 0) +
      (source !== "all" ? 1 : 0);

    return {
      search,
      category,
      android,
      sort,
      source,
      setSearch,
      setCategory,
      toggleCategory,
      setAndroid,
      setSort,
      setSource,
      reset,
      activeCount,
      isDefault: activeCount === 0,
    };
  }, [search, category, android, sort, source, toggleCategory, reset]);

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}
