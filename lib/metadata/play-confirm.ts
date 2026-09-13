/**
 * The one gate between "planned" and "actually written to the database" for
 * scripts/import-play-metadata.mjs. `--apply` alone is not enough — it must
 * be paired with the exact literal `--confirm=PLAY-METADATA`, so a write run
 * can never be triggered by a copy-pasted `--apply` alone (e.g. muscle
 * memory from another tool's flag) or a typo'd confirm value.
 */
export type WriteModeResult =
  | { mode: "dry-run" }
  | { mode: "apply" }
  | { mode: "error"; reason: string };

const REQUIRED_CONFIRM_VALUE = "PLAY-METADATA";

export function resolveWriteMode(args: {
  apply: boolean;
  confirm: string | undefined;
}): WriteModeResult {
  if (!args.apply) return { mode: "dry-run" };
  if (args.confirm !== REQUIRED_CONFIRM_VALUE) {
    return {
      mode: "error",
      reason: `--apply requires --confirm=${REQUIRED_CONFIRM_VALUE} exactly (got: ${
        args.confirm === undefined ? "(missing)" : `"${args.confirm}"`
      })`,
    };
  }
  return { mode: "apply" };
}
