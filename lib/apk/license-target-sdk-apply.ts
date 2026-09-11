/**
 * Pure apply-phase logic for P2-1 Phase E: turning a Phase C decision
 * (lib/apk/license-target-sdk-backfill.ts) into a guarded, single-column
 * write instruction, running that guard against a real or fake Supabase
 * client, classifying what the guarded UPDATE actually did, and gating
 * whether a run is even allowed to write at all.
 *
 * The one rule everything else here exists to enforce: a write is ONLY ever
 * attempted when the Phase C decision's action is "propose" — i.e. the
 * current database value is null AND F-Droid has a usable value. "conflict"
 * (non-null, disagrees) and "match" (non-null, agrees) never produce a write
 * instruction. There is no force path, no way to opt into overwriting a
 * non-null value, anywhere in this module.
 *
 * That rule is enforced twice, deliberately, matching this project's
 * existing pattern (see lib/apk/fdroid-description.ts's own comment on this):
 *   1. here, in licenseWriteInstruction/targetSdkWriteInstruction, before a
 *      write is even attempted;
 *   2. again in the guarded UPDATE's own WHERE clause (`.eq("id", …)` plus
 *      `.is(column, null)`), so a row that changed between the read and the
 *      write is still refused by the database itself, not just by this
 *      module's earlier judgement call.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LicenseBackfillDecision,
  TargetSdkBackfillDecision,
} from "./license-target-sdk-backfill.ts";

// -------------------------------------------------------- write eligibility

export type WriteInstruction<TValue> =
  | { eligible: true; column: "license" | "target_sdk"; value: TValue }
  | { eligible: false; reason: string };

/**
 * Eligible only when the Phase C decision proposes a fill (current value is
 * null, F-Droid has a usable license) — never for "match" or "conflict".
 * Falls back to ineligible defensively even if `fdroidLicense` is somehow
 * empty despite a "propose" decision, rather than trusting the caller.
 */
export function licenseWriteInstruction(
  decision: LicenseBackfillDecision,
  fdroidLicense: string | null,
): WriteInstruction<string> {
  if (decision.action !== "propose" || !fdroidLicense) {
    return {
      eligible: false,
      reason: decision.action === "propose" ? "no-fdroid-license" : decision.reason,
    };
  }
  return { eligible: true, column: "license", value: fdroidLicense };
}

/** Same rule as licenseWriteInstruction, for the per-version target_sdk fact. */
export function targetSdkWriteInstruction(
  decision: TargetSdkBackfillDecision,
  fdroidTargetSdk: number | null,
): WriteInstruction<number> {
  if (decision.action !== "propose" || fdroidTargetSdk === null) {
    return {
      eligible: false,
      reason: decision.action === "propose" ? "no-fdroid-target-sdk" : decision.reason,
    };
  }
  return { eligible: true, column: "target_sdk", value: fdroidTargetSdk };
}

// ------------------------------------------------------------ apply gating

/**
 * A run is only ever authorized to write when BOTH `--apply` and the exact
 * confirmation token `--confirm=P2-1` are present. Missing either one keeps
 * the run in dry-run mode; the runner script additionally treats "--apply
 * without the confirmation" as a hard error rather than a silent downgrade,
 * so a typo is loud rather than quietly doing nothing.
 */
export function parseApplyFlags(args: readonly string[]): {
  applyRequested: boolean;
  confirmed: boolean;
  authorized: boolean;
} {
  const applyRequested = args.includes("--apply");
  const confirmed = args.includes("--confirm=P2-1");
  return { applyRequested, confirmed, authorized: applyRequested && confirmed };
}

// --------------------------------------------------------- outcome mapping

export type GuardedWriteOutcome = "applied" | "skipped-concurrent-change";

/**
 * A guarded UPDATE (`.eq("id", …).is(column, null)`) that matches and
 * updates a row returns that row when `.select()` is chained after it; one
 * that matched nothing — because the value was no longer null by the time
 * the write ran — returns zero rows. Zero rows is always reported as
 * "skipped-concurrent-change", never as success.
 */
export function classifyGuardedUpdateResult(matchedRowCount: number): GuardedWriteOutcome {
  return matchedRowCount > 0 ? "applied" : "skipped-concurrent-change";
}

// ------------------------------------------------------- guarded DB writes

/**
 * Writes `apps.license` for exactly one row, identified by its own id, only
 * if that row's license is still null. Never touches any other column, any
 * other row, and never matches by package_name. Throws on a real database
 * error so the caller can record it distinctly from a guarded skip.
 */
export async function applyGuardedLicenseUpdate(
  supabase: SupabaseClient,
  appId: string,
  license: string,
): Promise<GuardedWriteOutcome> {
  const { data, error } = await supabase
    .from("apps")
    .update({ license })
    .eq("id", appId)
    .is("license", null)
    .select("id");
  if (error) throw error;
  return classifyGuardedUpdateResult((data ?? []).length);
}

/** Same guarantee as applyGuardedLicenseUpdate, for versions.target_sdk. */
export async function applyGuardedTargetSdkUpdate(
  supabase: SupabaseClient,
  versionId: string,
  targetSdk: number,
): Promise<GuardedWriteOutcome> {
  const { data, error } = await supabase
    .from("versions")
    .update({ target_sdk: targetSdk })
    .eq("id", versionId)
    .is("target_sdk", null)
    .select("id");
  if (error) throw error;
  return classifyGuardedUpdateResult((data ?? []).length);
}
