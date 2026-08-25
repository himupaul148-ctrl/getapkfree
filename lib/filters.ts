import { ANDROID_LEVELS, CATEGORIES, SORT_OPTIONS } from "@/lib/types";
import type { SortKey } from "@/lib/types";

/**
 * Pure helpers for reading filter values out of a URL. They live here rather
 * than beside the provider because the server page parses searchParams with
 * them, and a "use client" module cannot be called from the server.
 */

/** Accepts "productivity" as well as "Productivity" so hand-typed URLs work. */
export function normaliseCategory(raw: string | undefined): string {
  if (!raw) return "";
  const match = CATEGORIES.find(
    (c) => c.toLowerCase() === raw.trim().toLowerCase(),
  );
  return match ?? "";
}

export function normaliseSort(raw: string | undefined): SortKey {
  return SORT_OPTIONS.includes(raw as SortKey) ? (raw as SortKey) : "trending";
}

export function normaliseAndroid(raw: string | undefined): string {
  if (!raw) return "";
  const match = ANDROID_LEVELS.find((level) => level === raw.trim());
  return match ?? "";
}
