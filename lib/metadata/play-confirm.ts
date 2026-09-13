/**
 * The one gate between "planned" and "actually written to the database" for
 * scripts/import-play-metadata.mjs. `--apply`/`--propose` alone are not
 * enough — either must be paired with the exact literal
 * `--confirm=PLAY-METADATA`, so a write run can never be triggered by a
 * copy-pasted flag alone (e.g. muscle memory from another tool's flag) or a
 * typo'd confirm value.
 */
export type WriteModeResult =
  | { mode: "dry-run" }
  | { mode: "apply" }
  | { mode: "propose" }
  | { mode: "error"; reason: string };

const REQUIRED_CONFIRM_VALUE = "PLAY-METADATA";

export function resolveWriteMode(args: {
  apply: boolean;
  /** Optional so every existing call site (Phase 2, before --propose existed) keeps working unchanged. */
  propose?: boolean;
  confirm: string | undefined;
}): WriteModeResult {
  const propose = args.propose ?? false;

  if (args.apply && propose) {
    return { mode: "error", reason: "--apply and --propose cannot both be set — choose one." };
  }
  if (!args.apply && !propose) return { mode: "dry-run" };

  if (args.confirm !== REQUIRED_CONFIRM_VALUE) {
    const flagName = args.apply ? "--apply" : "--propose";
    return {
      mode: "error",
      reason: `${flagName} requires --confirm=${REQUIRED_CONFIRM_VALUE} exactly (got: ${
        args.confirm === undefined ? "(missing)" : `"${args.confirm}"`
      })`,
    };
  }
  return { mode: args.apply ? "apply" : "propose" };
}
