import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { isRetryEligible, describeEnrichmentStatus } from "./play-proposals-enrichment-ui.ts";
import { RETRYABLE_STATUSES, TERMINAL_STATUSES, type EnrichmentStatus } from "../apk/github-apk-enrichment-store.ts";
import { formatShortRelative } from "../format.ts";

/**
 * Run with: npm test — pure functions, no Supabase, no React. Mirrors
 * lib/metadata/play-proposals-ui.test.ts's own style for the same page's
 * existing pending-queue helpers.
 */

const NOW = new Date("2026-09-14T12:00:00Z");

function attempt(status: EnrichmentStatus, hoursAgo: number) {
  return { status, last_attempted_at: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString() };
}

/* --------------------------------------------------------------- isRetryEligible */

group("isRetryEligible — retryable statuses respect the 24h cooldown", () => {
  for (const status of RETRYABLE_STATUSES) {
    test(`${status}: NOT eligible 1h after the last attempt`, () => {
      assert.equal(isRetryEligible(attempt(status, 1), NOW), false);
    });

    test(`${status}: eligible 25h after the last attempt`, () => {
      assert.equal(isRetryEligible(attempt(status, 25), NOW), true);
    });
  }
});

group("isRetryEligible — the exact cooldown boundary", () => {
  test("not yet eligible a moment before 24h", () => {
    const justUnder = attempt("no_apk_asset", 24 - 1 / 3600); // 24h minus 1 second
    assert.equal(isRetryEligible(justUnder, NOW), false);
  });

  test("eligible at exactly 24h", () => {
    const exact = attempt("no_apk_asset", 24);
    assert.equal(isRetryEligible(exact, NOW), true);
  });

  test("a custom cooldownHours is honored", () => {
    assert.equal(isRetryEligible(attempt("no_release", 2), NOW, 1), true, "past a 1h cooldown");
    assert.equal(isRetryEligible(attempt("no_release", 2), NOW, 3), false, "still within a 3h cooldown");
  });
});

group("isRetryEligible — terminal statuses are never eligible, regardless of time", () => {
  for (const status of TERMINAL_STATUSES) {
    test(`${status}: not eligible even after 1000 hours`, () => {
      assert.equal(isRetryEligible(attempt(status, 1000), NOW), false);
    });
  }
});

group("isRetryEligible — a missing attempt", () => {
  test("null attempt is eligible — nothing recorded yet, nothing to wait out", () => {
    assert.equal(isRetryEligible(null, NOW), true);
  });

  test("undefined attempt is eligible", () => {
    assert.equal(isRetryEligible(undefined, NOW), true);
  });
});

/* --------------------------------------------------------- describeEnrichmentStatus */

group("describeEnrichmentStatus — every one of the 9 real statuses", () => {
  test("no_github_source", () => {
    const d = describeEnrichmentStatus(attempt("no_github_source", 1), null, NOW);
    assert.equal(d.status, "no_github_source");
    assert.equal(d.label, "No GitHub source linked");
    assert.equal(d.showRetry, false);
    assert.equal(d.needsAttention, false);
  });

  test("github_repo_not_found — retryable", () => {
    const d = describeEnrichmentStatus(attempt("github_repo_not_found", 1), null, NOW);
    assert.equal(d.label, "GitHub repository not found");
    assert.equal(d.showRetry, true);
    assert.equal(d.retryText, "eligible after cooldown");
  });

  test("no_release — retryable, eligible after cooldown elapses", () => {
    const d = describeEnrichmentStatus(attempt("no_release", 25), null, NOW);
    assert.equal(d.label, "No GitHub release yet");
    assert.equal(d.showRetry, true);
    assert.equal(d.retryText, "eligible now");
  });

  test("no_apk_asset — matches the Bit Switch example exactly", () => {
    const bitSwitchAttempt = attempt("no_apk_asset", 2);
    const d = describeEnrichmentStatus(bitSwitchAttempt, null, NOW);
    assert.equal(d.label, "No APK available");
    // lastChecked comes from formatShortRelative(), which measures against
    // the REAL current time (it has no `now` override) — so the expected
    // value must be computed the same way, not hardcoded as "2h ago",
    // which would only be true if this test happened to run at exactly
    // the moment NOW represents.
    assert.equal(d.lastChecked, formatShortRelative(bitSwitchAttempt.last_attempted_at));
    assert.equal(d.showRetry, true);
    assert.equal(d.retryText, "eligible after cooldown");
  });

  test("multiple_apk_assets — terminal, needs attention, no retry line", () => {
    const d = describeEnrichmentStatus(attempt("multiple_apk_assets", 1), null, NOW);
    assert.equal(d.needsAttention, true);
    assert.equal(d.showRetry, false);
  });

  test("package_mismatch — terminal, needs attention, no retry line", () => {
    const d = describeEnrichmentStatus(attempt("package_mismatch", 1), null, NOW);
    assert.equal(d.label, "Package mismatch");
    assert.equal(d.needsAttention, true);
    assert.equal(d.showRetry, false);
  });

  test("import_failed — retryable", () => {
    const d = describeEnrichmentStatus(attempt("import_failed", 1), null, NOW);
    assert.equal(d.label, "Import failed");
    assert.equal(d.showRetry, true);
  });

  test("already_has_version — matches the Photok example exactly, no version fields", () => {
    const d = describeEnrichmentStatus(attempt("already_has_version", 1), null, NOW);
    assert.equal(d.label, "Already has a version");
    assert.equal(d.showRetry, false);
    assert.equal(d.versionName, null);
    assert.equal(d.needsAttention, false);
  });

  test("imported_unpublished — with a version row, exposes version/published fields, never parsed from a message string", () => {
    const d = describeEnrichmentStatus(
      attempt("imported_unpublished", 1),
      { version_name: "3.3.0", version_code: 71, published: false },
      NOW,
    );
    assert.equal(d.label, "APK imported, awaiting publication");
    assert.equal(d.versionName, "3.3.0");
    assert.equal(d.versionCode, 71);
    assert.equal(d.published, false);
    assert.equal(d.showRetry, false);
  });

  test("imported_unpublished — without a version row (shouldn't normally happen, but handled), version fields stay null", () => {
    const d = describeEnrichmentStatus(attempt("imported_unpublished", 1), null, NOW);
    assert.equal(d.versionName, null);
    assert.equal(d.versionCode, null);
    assert.equal(d.published, null);
  });

  test("a version is ignored for any status other than imported_unpublished", () => {
    const d = describeEnrichmentStatus(
      attempt("already_has_version", 1),
      { version_name: "1.0", version_code: 1, published: true },
      NOW,
    );
    assert.equal(d.versionName, null, "a stray version must never leak into an unrelated status's card");
  });
});

group("describeEnrichmentStatus — no attempt at all", () => {
  test("a null attempt produces the 'waiting for first check' fallback, never a crash", () => {
    const d = describeEnrichmentStatus(null, null, NOW);
    assert.equal(d.status, "no_attempt");
    assert.equal(d.label, "Waiting for first automatic check");
    assert.equal(d.lastChecked, null);
    assert.equal(d.showRetry, false);
    assert.equal(d.retryText, null);
    assert.equal(d.needsAttention, false);
  });

  test("undefined behaves identically to null", () => {
    const d = describeEnrichmentStatus(undefined, null, NOW);
    assert.equal(d.status, "no_attempt");
  });
});

group("describeEnrichmentStatus — uses the shared label map, never a second copy", () => {
  test("every status's label matches lib/apk/enrichment-status-labels.ts exactly", async () => {
    const { STATUS_LABELS } = await import("../apk/enrichment-status-labels.ts");
    for (const status of [...RETRYABLE_STATUSES, ...TERMINAL_STATUSES, "no_github_source" as const]) {
      const d = describeEnrichmentStatus(attempt(status, 1), null, NOW);
      assert.equal(d.label, STATUS_LABELS[status]);
    }
  });
});
