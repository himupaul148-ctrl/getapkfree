/**
 * Version-level publish/unpublish logic for the admin Apps Manager,
 * extracted so it's testable without a React harness and so the actual
 * database write lives in exactly one place, filtered by the version's own
 * id — never by app_id. That per-app_id filter is the bug this module
 * replaces: it used to publish/unpublish every build an app has in one
 * query, which silently exposed a still-pending build sitting alongside an
 * already-published one.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * scan_status values safe to expose publicly. Was a UX safeguard only —
 * `setVersionPublished` below now re-checks this same rule server-side
 * before every publish, closing the gap this comment used to describe (a
 * direct authenticated write could set published=true on a pending/flagged/
 * failed build, bypassing the UI entirely). A database-level CHECK
 * constraint (see supabase/migrations/20260909000000_versions_publish_requires_scan.sql)
 * backs this up as the actual, unconditional boundary — this function's own
 * guard is what lets a rejection surface as a clean, catchable error instead
 * of a raw constraint-violation message.
 */
export function canPublishVersion(scanStatus: string | null): boolean {
  return scanStatus === "clean" || scanStatus === "external";
}

/** Thrown by setVersionPublished when the target version's current scan_status does not permit publishing. */
export class VersionNotPublishableError extends Error {
  scanStatus: string | null;
  constructor(scanStatus: string | null) {
    super(
      `Version cannot be published: scan_status is "${scanStatus ?? "null"}", not "clean" or "external".`,
    );
    this.name = "VersionNotPublishableError";
    this.scanStatus = scanStatus;
  }
}

export type ManagedVersion = {
  id: string;
  versionName: string;
  versionCode: number;
  published: boolean;
  scanStatus: string | null;
  scannedAt: string | null;
  minAndroidVersion: string | null;
  uploadedAt: string;
  fileSize: number | null;
};

/** Newest build first — matches how the public site itself picks a "latest" build. */
export function sortVersionsByCodeDesc(versions: ManagedVersion[]): ManagedVersion[] {
  return [...versions].sort((a, b) => b.versionCode - a.versionCode);
}

/**
 * Publishes or unpublishes exactly ONE version, identified by its own
 * primary key. Never filters by app_id — a sibling build of the same app
 * must never be touched by this call.
 *
 * Unpublishing has no eligibility requirement — a build that somehow ended
 * up published with an ineligible scan_status must still always be
 * unpublishable. Publishing does: the target's current scan_status is read
 * first and checked against canPublishVersion, and the write itself is then
 * additionally filtered on that same scan_status (not just the version id),
 * so a concurrent change landing between the read and the write makes the
 * update affect zero rows instead of silently publishing anyway. Either
 * failure mode throws VersionNotPublishableError rather than the write
 * quietly no-op'ing.
 */
export async function setVersionPublished(
  supabase: SupabaseClient,
  versionId: string,
  published: boolean,
): Promise<void> {
  if (!published) {
    const { error } = await supabase
      .from("versions")
      .update({ published })
      .eq("id", versionId);
    if (error) throw error;
    return;
  }

  const { data: current, error: readError } = await supabase
    .from("versions")
    .select("scan_status")
    .eq("id", versionId)
    .maybeSingle<{ scan_status: string | null }>();
  if (readError) throw readError;
  if (!current) throw new Error("No version with that id.");
  if (!canPublishVersion(current.scan_status)) {
    throw new VersionNotPublishableError(current.scan_status);
  }

  const { data, error } = await supabase
    .from("versions")
    .update({ published })
    .eq("id", versionId)
    .eq("scan_status", current.scan_status)
    .select("id");
  if (error) throw error;
  if (!data || (Array.isArray(data) && data.length === 0)) {
    // The row's scan_status changed between the read above and this write —
    // treat that exactly like the eligibility check above failing, rather
    // than silently doing nothing.
    throw new VersionNotPublishableError(current.scan_status);
  }
}
