import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { resolveWriteMode } from "./play-confirm.ts";

group("resolveWriteMode", () => {
  test("no --apply -> dry-run, regardless of --confirm", () => {
    assert.deepEqual(resolveWriteMode({ apply: false, confirm: undefined }), { mode: "dry-run" });
    assert.deepEqual(resolveWriteMode({ apply: false, confirm: "PLAY-METADATA" }), { mode: "dry-run" });
  });

  test("--apply with no --confirm at all is an error, not a silent dry-run", () => {
    const result = resolveWriteMode({ apply: true, confirm: undefined });
    assert.equal(result.mode, "error");
  });

  test("--apply with the wrong confirm value is an error", () => {
    const result = resolveWriteMode({ apply: true, confirm: "yes" });
    assert.equal(result.mode, "error");
  });

  test("--apply with a case-mismatched confirm value is an error — exact match required", () => {
    const result = resolveWriteMode({ apply: true, confirm: "play-metadata" });
    assert.equal(result.mode, "error");
  });

  test("--apply with exactly the right confirm value -> apply", () => {
    assert.deepEqual(resolveWriteMode({ apply: true, confirm: "PLAY-METADATA" }), { mode: "apply" });
  });
});
