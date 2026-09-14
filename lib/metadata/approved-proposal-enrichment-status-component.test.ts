import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * components/admin/ApprovedProposalEnrichmentStatus.tsx — a server
 * component this project's plain `node --test` runner still can't import
 * directly (no JSX transform), the same constraint documented throughout
 * this project's other *-component.test.ts files. The real logic it
 * renders (label/retry/version shaping) is exercised directly and
 * behaviorally in lib/metadata/play-proposals-enrichment-ui.test.ts; this
 * file only proves the component actually renders what that logic hands
 * it, and nothing it shouldn't.
 */

const src = readFileSync(
  fileURLToPath(new URL("../../components/admin/ApprovedProposalEnrichmentStatus.tsx", import.meta.url)),
  "utf8",
);

group("ApprovedProposalEnrichmentStatus — is purely presentational", () => {
  test("props are already-resolved data — no fetch, no Supabase client, no service-role reference", () => {
    assert.doesNotMatch(src, /fetch\(/);
    assert.doesNotMatch(src, /createClient/);
    assert.doesNotMatch(src, /SUPABASE_SERVICE_ROLE_KEY/);
  });

  test("never calls setVersionPublished or any publish action", () => {
    assert.doesNotMatch(src, /setVersionPublished/);
  });

  test("never renders an Approve or Reject control", () => {
    assert.doesNotMatch(src, /onApprove/);
    assert.doesNotMatch(src, /onReject/);
    assert.doesNotMatch(src, />\s*Approve\s*</);
    assert.doesNotMatch(src, />\s*Reject\s*</);
  });
});

group("ApprovedProposalEnrichmentStatus — required content", () => {
  test("shows an Approved badge", () => {
    assert.match(src, />Approved</);
  });

  test("shows the app icon and name via the existing AppIcon component", () => {
    assert.match(src, /import AppIcon from "@\/components\/AppIcon";/);
    assert.match(src, /<AppIcon src=\{card\.iconUrl\} name=\{card\.appName\}/);
  });

  test("shows the enrichment status label, prefixed exactly 'APK enrichment: '", () => {
    assert.match(src, /APK enrichment: \{status\.label\}/);
  });

  test("shows 'Last checked' only when lastChecked is present", () => {
    assert.match(src, /\{status\.lastChecked && <p[^>]*>Last checked: \{status\.lastChecked\}<\/p>\}/);
  });

  test("shows 'Next retry' only when showRetry is true", () => {
    assert.match(src, /\{status\.showRetry && <p[^>]*>Next retry: \{status\.retryText\}<\/p>\}/);
  });

  test("shows version and publish-state details only when a version was actually imported", () => {
    assert.match(src, /\{status\.versionName && \(/);
    assert.match(src, /Version: /);
    assert.match(src, /Status: \{status\.published \? "Published" : "Unpublished — ready for review"\}/);
  });
});

group("ApprovedProposalEnrichmentStatus — link to the existing admin app page, no new route", () => {
  test("links to the existing /admin/apps route only, for imported_unpublished/already_has_version", () => {
    assert.match(src, /href="\/admin\/apps"/);
    assert.match(src, /TERMINAL_LINK_STATUSES\s*=\s*new Set\(\["imported_unpublished", "already_has_version"\]\)/);
  });

  test("no new route is introduced — no /admin/apps/ with an appended id or slug", () => {
    assert.doesNotMatch(src, /\/admin\/apps\/\$\{/);
    assert.doesNotMatch(src, /\/admin\/apps\/\[/);
  });
});
