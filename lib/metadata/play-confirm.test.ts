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

group("resolveWriteMode — --propose", () => {
  test("no --apply and no --propose -> dry-run, exactly as before --propose existed", () => {
    assert.deepEqual(resolveWriteMode({ apply: false, confirm: undefined }), { mode: "dry-run" });
  });

  test("--propose with no --confirm at all is an error, not a silent dry-run", () => {
    const result = resolveWriteMode({ apply: false, propose: true, confirm: undefined });
    assert.equal(result.mode, "error");
  });

  test("--propose with the wrong confirm value is an error", () => {
    const result = resolveWriteMode({ apply: false, propose: true, confirm: "yes" });
    assert.equal(result.mode, "error");
  });

  test("--propose with exactly the right confirm value -> propose", () => {
    assert.deepEqual(
      resolveWriteMode({ apply: false, propose: true, confirm: "PLAY-METADATA" }),
      { mode: "propose" },
    );
  });

  test("--apply and --propose together is always an error, even with a correct --confirm", () => {
    const result = resolveWriteMode({ apply: true, propose: true, confirm: "PLAY-METADATA" });
    assert.equal(result.mode, "error");
  });

  test("propose defaults to false when omitted — every Phase 2 call site keeps its exact original behavior", () => {
    assert.deepEqual(resolveWriteMode({ apply: false, confirm: undefined }), { mode: "dry-run" });
    assert.deepEqual(resolveWriteMode({ apply: true, confirm: "PLAY-METADATA" }), { mode: "apply" });
  });
});
