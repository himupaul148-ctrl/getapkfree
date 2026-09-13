/**
 * Phase 2: turns a Phase 1 plan (lib/metadata/play-dry-run.ts) into the
 * actual Supabase writes for a Play-sourced external app.
 *
 * This module never touches lib/apk/save-build.ts, lib/apk/import-pipeline.ts,
 * or scripts/import-fdroid.mjs. findOrCreateApp() (save-build.ts) has no
 * notion of source_type/external_url/rating and is shared by the real-APK
 * upload/URL-import paths — extending it for this one caller would risk
 * their behavior for no benefit, since a Play-sourced row's shape only
 * overlaps with ExternalAppForm.tsx's existing external-app insert, not
 * with either of those hosted-APK paths. This module mirrors
 * ExternalAppForm.tsx's own insert shape and save-build.ts's own
 * find-or-create/unique-violation-recovery pattern instead, independently.
 *
 * Every write here is scoped to source_type='external' rows only. An
 * existing app whose stored source_type is 'fdroid' is never touched by
 * this module at all — that row belongs to the F-Droid/real-APK pipeline,
 * not to a Play metadata refresh, regardless of whether it also happens to
 * share a package name with a Play listing.
 *
 * A new app is created as metadata only — no `versions` row. Play's public
 * listing page never exposes a version number, so version_code/version_name
 * (both NOT NULL columns) would have no legitimate source; see
 * createExternalAppFromPlay()'s own doc comment for why that's fine, not a
 * gap — the admin UI already treats a version-less app as an ordinary state.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExistingAppPlan, FieldChange, NewAppPlan } from "./play-dry-run.ts";
import type { OverridableField } from "./provenance.ts";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isUniqueViolation(
  error: { message?: string | null; code?: string | null } | null | undefined,
  constraint: string,
): boolean {
  if (!error) return false;
  return error.code === "23505" || Boolean(error.message?.includes(constraint));
}

/**
 * Splits a plan's "would change" fields into what is actually safe to
 * write (a real, non-empty value fromPlay() returned) versus what must
 * never be written (Play returned nothing for that field this time, and a
 * missing value must never blank out something already stored — that is a
 * "Play doesn't expose this" gap, not evidence the real value went away).
 */
export function writableChangesFor(plan: ExistingAppPlan): {
  applied: FieldChange[];
  skippedNull: FieldChange[];
} {
  const applied: FieldChange[] = [];
  const skippedNull: FieldChange[] = [];
  for (const change of plan.changes) {
    const isNullish = change.to === null || change.to === undefined || change.to === "";
    (isNullish ? skippedNull : applied).push(change);
  }
  return { applied, skippedNull };
}

/**
 * Applies only the given (already-filtered: non-manual, non-null) field
 * changes to an existing app row. Never touches versions, scan_status,
 * published, or any APK/file field — an existing app's build history is
 * entirely out of scope for a metadata refresh.
 */
export async function applyPermittedChanges(
  supabase: SupabaseClient,
  appId: string,
  applied: FieldChange[],
): Promise<void> {
  if (applied.length === 0) return;
  const payload: Partial<Record<OverridableField, unknown>> = {};
  for (const change of applied) payload[change.field] = change.to;

  const { error } = await supabase.from("apps").update(payload).eq("id", appId);
  if (error) throw error;
}

export type CreateExternalAppResult = {
  appId: string;
  slug: string;
  /** False when a concurrent writer won the package_name race — this call created nothing. */
  created: boolean;
};

/**
 * Creates a new Play-sourced external app row — metadata only, no version
 * row of any kind.
 *
 * An earlier version of this function also inserted one `versions` row
 * (version_name="Latest", version_code=1, ...) so the app would have
 * "something" to publish later. That was reverted: version_code and
 * version_name are both NOT NULL columns, and fromPlay() has no legitimate
 * source for either — Play's public listing page never exposes a version
 * number at all (see fetchers.ts's own `unavailable` list). Any value
 * placed there, "Latest"/1 included, is fabricated, not fetched.
 *
 * It also turns out a version row isn't needed for this draft to be a
 * normal, supported state: components/admin/EditMetadataModal.tsx already
 * handles `app.latestVersionId === null` as an ordinary case (it disables
 * the version-name field and shows "This app has no version row yet."
 * rather than assuming one exists), and AppsManager.tsx's VersionList
 * already renders "No builds uploaded yet." for zero versions. So a
 * Play-sourced draft with an app row and no version row is not a broken or
 * unanticipated state — it's exactly what "metadata fetched, not yet a
 * real listing" should look like. Turning it into a fully-published
 * external listing (the way ExternalAppForm.tsx's human-reviewed flow
 * creates one version immediately) is left as a genuinely separate,
 * not-yet-built admin action — out of scope for a metadata-only draft.
 *
 * package_name is the identity key: a concurrent insert of the same package
 * is resolved by re-fetching the winner's row, identical to
 * lib/apk/save-build.ts's findOrCreateApp.
 */
export async function createExternalAppFromPlay(
  supabase: SupabaseClient,
  input: {
    packageName: string;
    proposed: NewAppPlan["proposed"];
  },
): Promise<CreateExternalAppResult> {
  const { data: existing, error: lookupError } = await supabase
    .from("apps")
    .select("id, slug")
    .eq("package_name", input.packageName)
    .maybeSingle<{ id: string; slug: string }>();
  if (lookupError) throw lookupError;
  if (existing) return { appId: existing.id, slug: existing.slug, created: false };

  const base = slugify(input.proposed.name) || slugify(input.packageName) || "app";
  const { data: clash } = await supabase.from("apps").select("id").eq("slug", base).maybeSingle();
  const slug = clash ? `${base}-${Date.now().toString(36).slice(-4)}` : base;

  const { data: createdApp, error: createError } = await supabase
    .from("apps")
    .insert({
      name: input.proposed.name,
      slug,
      package_name: input.proposed.package_name,
      category: input.proposed.category,
      description: input.proposed.description,
      developer_name: input.proposed.developer_name,
      icon_url: input.proposed.icon_url,
      rating: input.proposed.rating,
      rating_count: input.proposed.rating_count ?? 0,
      source_type: input.proposed.source_type,
      external_url: input.proposed.external_url,
      hosted_locally: input.proposed.hosted_locally,
      // Nothing is manually overridden yet — this is a freshly auto-fetched row.
      manual_fields: [],
    })
    .select("id, slug")
    .single<{ id: string; slug: string }>();

  if (createError) {
    if (isUniqueViolation(createError, "apps_package_name_key")) {
      const { data: winner, error: refetchError } = await supabase
        .from("apps")
        .select("id, slug")
        .eq("package_name", input.packageName)
        .maybeSingle<{ id: string; slug: string }>();
      if (refetchError) throw refetchError;
      if (winner) return { appId: winner.id, slug: winner.slug, created: false };
    }
    throw createError;
  }

  return { appId: createdApp.id, slug: createdApp.slug, created: true };
}

export type ApplyOutcome =
  | { status: "created"; packageName: string; appId: string; slug: string }
  | { status: "updated"; packageName: string; appId: string; fields: OverridableField[] }
  | { status: "unchanged"; packageName: string }
  | { status: "skipped_fdroid_owned"; packageName: string }
  | { status: "skipped_invalid_url"; line: string }
  | { status: "skipped_fetch_failed"; packageName: string | null }
  | { status: "failed"; packageName: string | null; reason: string };

export type ApplySummary = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  total: number;
};

/** Pure aggregation over one run's real (or planned, in dry-run) outcomes — no I/O. */
export function summarizeApply(outcomes: ApplyOutcome[]): ApplySummary {
  const summary: ApplySummary = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, total: outcomes.length };
  for (const outcome of outcomes) {
    switch (outcome.status) {
      case "created":
        summary.created++;
        break;
      case "updated":
        summary.updated++;
        break;
      case "unchanged":
        summary.unchanged++;
        break;
      case "failed":
        summary.failed++;
        break;
      default:
        summary.skipped++;
    }
  }
  return summary;
}
