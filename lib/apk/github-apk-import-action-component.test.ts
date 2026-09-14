import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * components/admin/GithubApkImportAction.tsx. This is a "use client"
 * component with no JSX transform available under this project's plain
 * `node --test` runner, so it cannot be imported and rendered directly —
 * the same constraint documented in lib/header-search-component.test.ts and
 * lib/metadata/play-proposals-review-component.test.ts for their own
 * components. These assertions read the component's literal source; the
 * pure orchestration logic it calls through the API is exercised directly
 * and behaviorally in lib/apk/github-release-import.test.ts.
 */

const src = readFileSync(
  fileURLToPath(new URL("../../components/admin/GithubApkImportAction.tsx", import.meta.url)),
  "utf8",
);

group("GithubApkImportAction — button visibility rules", () => {
  test("is hidden for an app that already has a version, or has no resolvable GitHub discovery source", () => {
    // Covers both rules at once: `!app.githubSourceRepo` is also what keeps
    // this hidden for an F-Droid app and any app with no discovery history
    // (see lib/apk/app-github-source.test.ts for the resolver itself).
    assert.match(src, /if \(app\.versionCount > 0 \|\| !app\.githubSourceRepo\) return null;/);
  });
});

group("GithubApkImportAction — confirmation before importing", () => {
  test("clicking the button shows a confirm phase before calling the API", () => {
    assert.match(src, /onClick=\{\(\) => setPhase\(\{ kind: "confirm" \}\)\}/);
    assert.match(src, /phase\?\.kind === "confirm"/);
  });

  test("the confirmation explicitly states the build is created unpublished", () => {
    assert.match(src, /created <strong>unpublished<\/strong>/);
  });
});

group("GithubApkImportAction — calls the admin API, never a direct database/service-role write", () => {
  test("POSTs to /api/admin/apps/<id>/import-from-github", () => {
    assert.match(src, /fetch\(`\/api\/admin\/apps\/\$\{app\.id\}\/import-from-github`,/);
    assert.match(src, /method: "POST"/);
  });

  test("never references the service-role key or constructs a Supabase client directly", () => {
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(src, /createClient\(/);
  });

  test("never calls the publish endpoint or setVersionPublished — publishing stays a separate, deliberate action", () => {
    assert.doesNotMatch(src, /setVersionPublished/);
    assert.doesNotMatch(src, /published:\s*true/);
  });
});

group("GithubApkImportAction — multiple-asset selection requires an explicit click", () => {
  test("renders a picker rather than auto-selecting when multiple_apk_assets comes back", () => {
    assert.match(src, /"choose-asset"/);
    assert.match(src, /phase\.assets\.map/);
  });

  test("selecting an asset re-calls the import with that asset's own download URL", () => {
    assert.match(src, /runImport\(asset\.browserDownloadUrl\)/);
  });
});

group("GithubApkImportAction — result messaging matches the spec exactly", () => {
  test("no_apk_asset message", () => {
    assert.match(src, /No APK release asset is currently available for this repository\./);
  });

  test("package_mismatch message", () => {
    assert.match(src, /The GitHub APK package does not match this app and was not imported\./);
  });

  test("imported_unpublished message", () => {
    assert.match(src, /APK imported as an unpublished version\. Review and publish it manually\./);
  });
});
