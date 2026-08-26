/**
 * Which app fields an admin can override by hand, and how we remember that
 * they did.
 *
 * `apps.manual_fields` holds the names below. Two things depend on it: the
 * edit UI labels each field "auto-fetched" or "custom", and a re-fetch skips
 * anything listed — an override is meant to be permanent, so re-reading the
 * Play page must not quietly undo it.
 */
export const OVERRIDABLE_FIELDS = [
  "name",
  "description",
  "icon_url",
  "screenshots",
  "developer_name",
  "category",
  "rating",
  "rating_count",
  "version_name",
] as const;

export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

export const FIELD_LABELS: Record<OverridableField, string> = {
  name: "App name",
  description: "Description",
  icon_url: "Icon",
  screenshots: "Screenshots",
  developer_name: "Developer",
  category: "Category",
  rating: "Rating",
  rating_count: "Rating count",
  version_name: "Version",
};

export function isManual(
  manualFields: string[] | null | undefined,
  field: OverridableField,
): boolean {
  return (manualFields ?? []).includes(field);
}

/** Adds fields to the manual list without duplicating existing entries. */
export function markManual(
  manualFields: string[] | null | undefined,
  fields: OverridableField[],
): string[] {
  return [...new Set([...(manualFields ?? []), ...fields])];
}

/** Drops fields back to auto, for the "revert to auto-fetched" action. */
export function clearManual(
  manualFields: string[] | null | undefined,
  fields: OverridableField[],
): string[] {
  const drop = new Set<string>(fields);
  return (manualFields ?? []).filter((f) => !drop.has(f));
}

/**
 * Compares what the admin is about to save against what the fetcher produced,
 * so the form can record only the fields a human actually changed rather than
 * marking everything manual on every save.
 */
export function changedFields(
  fetched: Partial<Record<OverridableField, unknown>>,
  entered: Partial<Record<OverridableField, unknown>>,
): OverridableField[] {
  return OVERRIDABLE_FIELDS.filter((field) => {
    if (!(field in entered)) return false;
    const before = fetched[field];
    const after = entered[field];

    const norm = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      if (Array.isArray(v)) return v.length ? v.join(" ") : null;
      if (typeof v === "number") return String(v);
      return String(v).trim() || null;
    };

    return norm(before) !== norm(after);
  });
}
