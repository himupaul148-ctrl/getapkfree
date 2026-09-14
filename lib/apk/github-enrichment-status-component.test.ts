import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * components/admin/GithubEnrichmentStatus.tsx and its wiring into
 * components/admin/AppsManager.tsx. Both are non-"use client"/"use client"
 * components this project's plain `node --test` runner cannot import and
 * render directly (no JSX transform) — the same constraint documented in
 * lib/header-search-component.test.ts and
 * lib/apk/github-apk-import-action-component.test.ts for their own
 * components.
 */

const statusSrc = readFileSync(
  fileURLToPath(new URL("../../components/admin/GithubEnrichmentStatus.tsx", import.meta.url)),
  "utf8",
);
const managerSrc = readFileSync(
  fileURLToPath(new URL("../../components/admin/AppsManager.tsx", import.meta.url)),
  "utf8",
);
const importActionSrc = readFileSync(
  fileURLToPath(new URL("../../components/admin/GithubApkImportAction.tsx", import.meta.url)),
  "utf8",
);

group("GithubEnrichmentStatus — renders nothing without an attempt", () => {
  test("returns null when `attempt` is null", () => {
    assert.match(statusSrc, /if \(!attempt\) return null;/);
  });
});

group("GithubEnrichmentStatus — shows the status label and a relative timestamp", () => {
  test("renders 'Latest GitHub APK check: <label> · <time>'", () => {
    assert.match(statusSrc, /Latest GitHub APK check:\s*\{label\}\s*·\s*\{formatShortRelative\(attempt\.lastAttemptedAt\)\}/);
  });

  test("uses the minute/hour-granular formatter, not the day-level one", () => {
    assert.match(statusSrc, /import \{ formatShortRelative \} from "@\/lib\/format";/);
  });

  test("maps every enrichment status the store can record to a human label", () => {
    for (const status of [
      "no_github_source",
      "github_repo_not_found",
      "no_release",
      "no_apk_asset",
      "multiple_apk_assets",
      "package_mismatch",
      "import_failed",
      "already_has_version",
      "imported_unpublished",
    ]) {
      assert.match(statusSrc, new RegExp(`${status}:\\s*"`));
    }
  });

  test("the imported_unpublished label matches the spec's own wording", () => {
    assert.match(statusSrc, /imported_unpublished:\s*"APK imported, awaiting publication"/);
  });

  test("the no_apk_asset label matches the spec's own wording", () => {
    assert.match(statusSrc, /no_apk_asset:\s*"No APK available"/);
  });
});

group("GithubEnrichmentStatus — never a publish action", () => {
  test("contains no button, no fetch call, and never references setVersionPublished — purely read-only display", () => {
    assert.doesNotMatch(statusSrc, /<button/);
    assert.doesNotMatch(statusSrc, /fetch\(/);
    assert.doesNotMatch(statusSrc, /setVersionPublished/);
  });
});

group("AppsManager — wires the new status alongside the existing version list, for every app row", () => {
  test("imports and renders GithubEnrichmentStatus", () => {
    assert.match(managerSrc, /import GithubEnrichmentStatus/);
    const occurrences = managerSrc.match(/<GithubEnrichmentStatus/g) ?? [];
    assert.equal(occurrences.length, 2, "once for the desktop table row, once for the mobile card");
  });

  test("ManagedApp carries the enrichmentAttempt field the status component needs", () => {
    assert.match(managerSrc, /enrichmentAttempt:\s*EnrichmentAttemptSummary \| null/);
  });

  test("still imports and renders the existing manual GithubApkImportAction — not replaced", () => {
    assert.match(managerSrc, /import GithubApkImportAction from "@\/components\/admin\/GithubApkImportAction";/);
    assert.match(managerSrc, /<GithubApkImportAction/);
  });
});

group("GithubApkImportAction — the existing manual action and its retry capability are untouched", () => {
  test("the button and confirm/result flow are still present", () => {
    assert.match(importActionSrc, /Import GitHub APK/);
    assert.match(importActionSrc, /onClick=\{\(\) => setPhase\(\{ kind: "confirm" \}\)\}/);
  });

  test("still visible whenever eligible, independent of any enrichment-attempt state — the automatic job's own outcome never disables the manual retry button", () => {
    assert.match(importActionSrc, /if \(app\.versionCount > 0 \|\| !app\.githubSourceRepo\) return null;/);
    assert.doesNotMatch(importActionSrc, /enrichmentAttempt/);
  });
});
