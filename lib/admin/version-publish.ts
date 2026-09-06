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
 * scan_status values safe to expose publicly. This is a UX safeguard only —
 * exactly like UploadForm's own "must be marked scanned" rule at upload
 * time — not a database security boundary. RLS and the schema's own CHECK
 * constraint still allow any of the five values to be published; nothing
 * here stops a direct API or SQL write. A real enforcement boundary (a DB
 * trigger, say) is a separate, larger change, deliberately not made here.
 */
export function canPublishVersion(scanStatus: string | null): boolean {
  return scanStatus === "clean" || scanStatus === "external";
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
 */
export async function setVersionPublished(
  supabase: SupabaseClient,
  versionId: string,
  published: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("versions")
    .update({ published })
    .eq("id", versionId);
  if (error) throw error;
}
