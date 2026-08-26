"use client";

import { useFilters } from "@/components/catalogue/FilterProvider";
import {
  ANDROID_LEVELS,
  CATEGORIES,
  SORT_LABELS,
  SORT_OPTIONS,
  SOURCE_FILTERS,
  SOURCE_FILTER_LABELS,
} from "@/lib/types";
import type { SortKey, SourceFilter } from "@/lib/types";

/** The four dropdowns, shared by the desktop bar and the mobile drawer. */
export default function FilterControls({ idPrefix }: { idPrefix: string }) {
  const {
    category,
    setCategory,
    android,
    setAndroid,
    sort,
    setSort,
    source,
    setSource,
  } = useFilters();

  return (
    <>
      <Select
        id={`${idPrefix}-category`}
        label="Category"
        value={category}
        onChange={setCategory}
        options={[
          { value: "", label: "All categories" },
          ...CATEGORIES.map((c) => ({ value: c, label: c })),
        ]}
      />

      <Select
        id={`${idPrefix}-android`}
        label="Runs on"
        value={android}
        onChange={setAndroid}
        options={[
          { value: "", label: "Any Android" },
          ...ANDROID_LEVELS.map((level) => ({
            value: level,
            label: `Android ${level}+`,
          })),
        ]}
      />

      <Select
        id={`${idPrefix}-source`}
        label="Source"
        value={source}
        onChange={(value) => setSource(value as SourceFilter)}
        options={SOURCE_FILTERS.map((key) => ({
          value: key,
          label: SOURCE_FILTER_LABELS[key],
        }))}
      />

      <Select
        id={`${idPrefix}-sort`}
        label="Sort by"
        value={sort}
        onChange={(value) => setSort(value as SortKey)}
        options={SORT_OPTIONS.map((key) => ({
          value: key,
          label: SORT_LABELS[key],
        }))}
      />
    </>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-medium text-fg-dim md:sr-only md:mb-0"
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl border border-base-700 bg-base-850 py-2.5 pr-9 pl-3.5 text-sm text-fg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-base-850">
              {option.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-fg-dim"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
