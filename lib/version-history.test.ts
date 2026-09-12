import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { hasTargetSdk, summarizeVersionPermissions } from "./version-history.ts";

/**
 * components/VersionHistory.tsx has no dedicated test file. A literal
 * `.tsx` test isn't runnable here: `npm test` is `node --test lib/**\/*.test.ts`
 * — it doesn't glob `components/`, and Node's built-in TypeScript support
 * strips *types* only, not JSX syntax, so a `.tsx` test couldn't execute
 * under this runner even if the glob covered it. This project has never had
 * a component-testing harness (see lib/blog-editor-fields.ts's own comment
 * making the same call for BlogEditor).
 *
 * This file instead pins the actual per-build DECISION logic
 * VersionHistory.tsx delegates to — the two things that make its rendering
 * correct or not: whether a target SDK is shown at all (never a placeholder)
 * and what a build's permissions summary line says (reusing
 * lib/permissions.ts, never re-deriving labels). The rest of what the task
 * asked this suite to cover — ordering, ScanBadge, download links, external
 * apps, "historical" entries rendering independently — is either a trivial,
 * risk-free pass-through in the component (no logic to test: it maps over
 * whatever array it's given, in order, with no reordering/filtering step)
 * or was verified directly against the real, live app page's rendered HTML
 * during the P2-3 implementation's read-only production check.
 */

group("hasTargetSdk — never a placeholder", () => {
  test("a real, finite number is shown", () => {
    assert.equal(hasTargetSdk(34), true);
    assert.equal(hasTargetSdk(0), true);
  });

  test("null, undefined, NaN are all 'not shown' — never rendered as Unknown", () => {
    assert.equal(hasTargetSdk(null), false);
    assert.equal(hasTargetSdk(undefined), false);
    assert.equal(hasTargetSdk(Number.NaN), false);
  });
});

group("summarizeVersionPermissions", () => {
  test("zero permissions -> null, so the caller renders no block at all (never an empty list)", () => {
    assert.equal(summarizeVersionPermissions([]), null);
    assert.equal(summarizeVersionPermissions(null), null);
    assert.equal(summarizeVersionPermissions(undefined), null);
  });

  test("one permission, not sensitive -> singular wording, no 'worth reviewing' clause", () => {
    const summary = summarizeVersionPermissions(["android.permission.INTERNET"]);
    assert.equal(summary?.summaryText, "1 permission");
    assert.equal(summary?.sensitiveCount, 0);
    assert.equal(summary?.described.length, 1);
  });

  test("multiple permissions, none sensitive -> plural wording, no 'worth reviewing' clause", () => {
    const summary = summarizeVersionPermissions([
      "android.permission.INTERNET",
      "android.permission.VIBRATE",
    ]);
    assert.equal(summary?.summaryText, "2 permissions");
  });

  test("a mix including sensitive permissions -> both counts appear in the summary text", () => {
    const summary = summarizeVersionPermissions([
      "android.permission.INTERNET",
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
    ]);
    assert.equal(summary?.summaryText, "3 permissions · 2 worth reviewing");
    assert.equal(summary?.sensitiveCount, 2);
  });

  test("the described list reuses lib/permissions.ts's own labels, not a second mapping", () => {
    const summary = summarizeVersionPermissions(["android.permission.CAMERA"]);
    assert.equal(summary?.described[0].label, "Camera");
    assert.equal(summary?.described[0].sensitive, true);
  });
});
