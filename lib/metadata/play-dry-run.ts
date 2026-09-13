/**
 * Pure classification/diff logic for the Play-metadata dry-run tool
 * (scripts/import-play-metadata.mjs). Kept dependency-free (no fetch, no
 * Supabase) so it can be exercised directly under plain `node --test` —
 * the script itself only wires this up to a real HTTP fetch and a real
 * (read-only) Supabase query.
 *
 * Deliberately reuses lib/metadata/provenance.ts's changedFields()/isManual()
 * rather than reimplementing a diff: those functions already encode this
 * project's one rule for "did a field really change, and is it protected
 * from being overwritten" — the same rule the admin edit UI enforces.
 */
import {
  changedFields,
  isManual,
  OVERRIDABLE_FIELDS,
  type OverridableField,
} from "./provenance.ts";
import type { FetchedMetadata } from "./fetchers.ts";

/**
 * The only fields fromPlay() ever actually populates (see fetchers.ts's own
 * `unavailable` list: screenshots, version and license are never available
 * from the public Play listing) — comparing the rest would only ever report
 * a spurious "would clear this field" that fromPlay() never intended to
 * assert one way or the other.
 */
export const PLAY_COMPARABLE_FIELDS: readonly OverridableField[] = [
  "name",
  "description",
  "icon_url",
  "developer_name",
  "category",
  "rating",
  "rating_count",
];

// Compile-time check that the list above is actually a subset of the real
// OVERRIDABLE_FIELDS, so a future rename in provenance.ts fails a typecheck
// here rather than silently comparing a field that no longer exists.
PLAY_COMPARABLE_FIELDS.forEach((f) => {
  if (!OVERRIDABLE_FIELDS.includes(f)) throw new Error(`unreachable: ${f}`);
});

/** The columns read from the `apps` table for an existing-app comparison. */
export type ExistingAppRow = {
  id: string;
  slug: string;
  package_name: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  developer_name: string | null;
  category: string | null;
  rating: number | null;
  rating_count: number;
  manual_fields: string[] | null;
};

export type FieldChange = {
  field: OverridableField;
  from: unknown;
  to: unknown;
};

export type ExistingAppPlan = {
  kind: "existing";
  appId: string;
  slug: string;
  packageName: string;
  /** Fields that differ and are NOT manually overridden — these would actually change. */
  changes: FieldChange[];
  /** Fields that differ but ARE manually overridden — these would NOT change. */
  protectedFields: FieldChange[];
  unchanged: boolean;
};

export type NewAppPlan = {
  kind: "new";
  packageName: string;
  /**
   * Exactly the shape ExternalAppForm.tsx already saves for a Play listing —
   * source_type stays "external" (no new source_type is introduced), the
   * build carries no binary of our own, and scan_status is "external"
   * because there is nothing here for VirusTotal to have an opinion on.
   */
  proposed: {
    source_type: "external";
    hosted_locally: false;
    external_url: string;
    scan_status: "external";
    name: string;
    package_name: string;
    developer_name: string | null;
    description: string | null;
    icon_url: string | null;
    category: string | null;
    rating: number | null;
    rating_count: number | null;
  };
};

export type ImportPlan = ExistingAppPlan | NewAppPlan;

function toFetchedMap(
  fetched: FetchedMetadata,
): Partial<Record<OverridableField, unknown>> {
  return {
    name: fetched.name,
    description: fetched.description,
    icon_url: fetched.iconUrl,
    developer_name: fetched.developer,
    category: fetched.category,
    rating: fetched.rating,
    rating_count: fetched.ratingCount,
  };
}

/**
 * Builds the plan for one URL's fetched metadata: a proposed-external-app
 * shape when the package is new, or a changed/protected/unchanged field
 * breakdown against the stored row when it already exists. Never touches
 * the database — the caller decides what (if anything) to do with the
 * result.
 */
export function planImport(
  fetched: FetchedMetadata,
  existing: ExistingAppRow | null,
  playUrl: string,
): ImportPlan {
  const packageName = fetched.packageName ?? "";

  if (!existing) {
    return {
      kind: "new",
      packageName,
      proposed: {
        source_type: "external",
        hosted_locally: false,
        external_url: playUrl,
        scan_status: "external",
        name: fetched.name ?? (packageName || "Unknown"),
        package_name: packageName,
        developer_name: fetched.developer,
        description: fetched.description,
        icon_url: fetched.iconUrl,
        category: fetched.category,
        rating: fetched.rating,
        rating_count: fetched.ratingCount,
      },
    };
  }

  const storedMap: Partial<Record<OverridableField, unknown>> = {
    name: existing.name,
    description: existing.description,
    icon_url: existing.icon_url,
    developer_name: existing.developer_name,
    category: existing.category,
    rating: existing.rating,
    rating_count: existing.rating_count,
  };
  const fetchedMap = toFetchedMap(fetched);
  // Only ever compare the fields Play actually provides — see
  // PLAY_COMPARABLE_FIELDS's own comment.
  const restrictedFetchedMap: Partial<Record<OverridableField, unknown>> = {};
  for (const field of PLAY_COMPARABLE_FIELDS) restrictedFetchedMap[field] = fetchedMap[field];

  // changedFields(fetched, entered) is written for "fetched vs what the
  // admin typed" — reused here as "stored baseline vs newly fetched
  // candidate", which is exactly the same comparison shape.
  const differing = changedFields(storedMap, restrictedFetchedMap);

  const changes: FieldChange[] = [];
  const protectedFields: FieldChange[] = [];
  for (const field of differing) {
    const entry: FieldChange = {
      field,
      from: storedMap[field] ?? null,
      to: restrictedFetchedMap[field] ?? null,
    };
    if (isManual(existing.manual_fields, field)) protectedFields.push(entry);
    else changes.push(entry);
  }

  return {
    kind: "existing",
    appId: existing.id,
    slug: existing.slug,
    packageName: existing.package_name,
    changes,
    protectedFields,
    unchanged: changes.length === 0,
  };
}

export type UrlOutcome =
  | { status: "invalid_url"; line: string; reason: string }
  | { status: "fetch_failed"; url: string; packageName: string; reason: string }
  | { status: "ok"; url: string; packageName: string; plan: ImportPlan };

export type Summary = {
  totalUrls: number;
  successfulFetches: number;
  failedFetches: number;
  existingApps: number;
  newApps: number;
  appsWithChanges: number;
  unchangedApps: number;
};

/** Pure aggregation over a run's per-URL outcomes — no I/O, fully testable. */
export function summarize(outcomes: UrlOutcome[]): Summary {
  const summary: Summary = {
    totalUrls: outcomes.length,
    successfulFetches: 0,
    failedFetches: 0,
    existingApps: 0,
    newApps: 0,
    appsWithChanges: 0,
    unchangedApps: 0,
  };

  for (const outcome of outcomes) {
    if (outcome.status !== "ok") {
      summary.failedFetches++;
      continue;
    }
    summary.successfulFetches++;
    if (outcome.plan.kind === "new") {
      summary.newApps++;
      continue;
    }
    summary.existingApps++;
    if (outcome.plan.unchanged) summary.unchangedApps++;
    else summary.appsWithChanges++;
  }

  return summary;
}
