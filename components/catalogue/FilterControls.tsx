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

/**
 * The catalogue's four filters, shared by the desktop bar and the mobile
 * drawer. Same underlying setCategory/setAndroid/setSource/setSort calls
 * either way — only the control each variant renders differs:
 *
 * - "compact" (desktop inline bar, <1024px catalogue pages): dropdowns, so
 *   four filters fit in one row without pushing the search box down.
 * - "chips" (mobile drawer): tappable pill groups for Category/Source/
 *   Android — bigger touch targets, and every option (plus which one is
 *   active) is visible at a glance instead of hidden inside a closed
 *   <select>. Sort stays a dropdown even here: five prose labels like
 *   "Highest rated" read better in a list than as a wrapped pill row.
 * - "sidebar" (desktop catalogue's left column, 1024px+): Android/Source/
 *   Sort only, stacked full-width — Category is left out because the
 *   sidebar renders its own counted category list above this instead of a
 *   second, redundant category control.
 */
export default function FilterControls({
  idPrefix,
  variant = "compact",
}: {
  idPrefix: string;
  variant?: "compact" | "chips" | "sidebar";
}) {
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

  if (variant === "chips") {
    return (
      <>
        <ChipGroup
          legend="Category"
          value={category}
          onChange={setCategory}
          options={[
            { value: "", label: "All" },
            ...CATEGORIES.map((c) => ({ value: c, label: c })),
          ]}
        />

        <ChipGroup
          legend="Source"
          value={source}
          onChange={(value) => setSource(value as SourceFilter)}
          options={SOURCE_FILTERS.map((key) => ({
            value: key,
            label: SOURCE_FILTER_LABELS[key],
          }))}
        />

        <ChipGroup
          legend="Android version"
          value={android}
          onChange={setAndroid}
          options={[
            { value: "", label: "Any" },
            ...ANDROID_LEVELS.map((level) => ({
              value: level,
              label: `${level}+`,
            })),
          ]}
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

  if (variant === "sidebar") {
    return (
      <>
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

function ChipGroup({
  legend,
  value,
  onChange,
  options,
}: {
  legend: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium text-fg-dim">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value || "__all"}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-brand-500 bg-brand-500 text-base-950"
                  : "border-base-700 text-fg-muted hover:border-brand-500/50 hover:text-fg"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
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
