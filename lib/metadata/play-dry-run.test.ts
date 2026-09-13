import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { planImport, summarize, type ExistingAppRow, type UrlOutcome } from "./play-dry-run.ts";
import type { FetchedMetadata } from "./fetchers.ts";

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.example.app";

function fetched(overrides: Partial<FetchedMetadata> = {}): FetchedMetadata {
  return {
    name: "Example App",
    packageName: "com.example.app",
    description: "An example app.",
    iconUrl: "https://example.com/icon.png",
    developer: "Example Devs",
    category: "Tools",
    version: null,
    rating: 4.5,
    ratingCount: 1000,
    screenshots: [],
    source: "play",
    unavailable: ["version", "screenshots"],
    ...overrides,
  };
}

function existingRow(overrides: Partial<ExistingAppRow> = {}): ExistingAppRow {
  return {
    id: "app-1",
    slug: "example-app",
    package_name: "com.example.app",
    name: "Example App",
    description: "An example app.",
    icon_url: "https://example.com/icon.png",
    developer_name: "Example Devs",
    category: "Tools",
    rating: 4.5,
    rating_count: 1000,
    manual_fields: [],
    ...overrides,
  };
}

group("planImport — new app", () => {
  test("no existing row -> a 'new' plan with the external-app shape, no new source_type", () => {
    const plan = planImport(fetched(), null, PLAY_URL);
    assert.equal(plan.kind, "new");
    if (plan.kind !== "new") return;
    assert.deepEqual(plan.proposed, {
      source_type: "external",
      hosted_locally: false,
      external_url: PLAY_URL,
      scan_status: "external",
      name: "Example App",
      package_name: "com.example.app",
      developer_name: "Example Devs",
      description: "An example app.",
      icon_url: "https://example.com/icon.png",
      category: "Tools",
      rating: 4.5,
      rating_count: 1000,
    });
  });

  test("a missing name falls back to the package name rather than a blank/invented value", () => {
    const plan = planImport(fetched({ name: null }), null, PLAY_URL);
    assert.equal(plan.kind, "new");
    if (plan.kind !== "new") return;
    assert.equal(plan.proposed.name, "com.example.app");
  });
});

group("planImport — existing app, unchanged", () => {
  test("identical fetched values report zero changes and unchanged=true", () => {
    const plan = planImport(fetched(), existingRow(), PLAY_URL);
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.protectedFields, []);
    assert.equal(plan.unchanged, true);
  });
});

group("planImport — existing app, real changes", () => {
  test("a differing, non-manual field is reported as a change", () => {
    const plan = planImport(
      fetched({ description: "A completely rewritten description." }),
      existingRow(),
      PLAY_URL,
    );
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].field, "description");
    assert.equal(plan.changes[0].from, "An example app.");
    assert.equal(plan.changes[0].to, "A completely rewritten description.");
    assert.equal(plan.unchanged, false);
    assert.deepEqual(plan.protectedFields, []);
  });

  test("multiple differing fields are all reported", () => {
    const plan = planImport(
      fetched({ developer: "New Devs", rating: 3.1 }),
      existingRow(),
      PLAY_URL,
    );
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    const fields = plan.changes.map((c) => c.field).sort();
    assert.deepEqual(fields, ["developer_name", "rating"]);
  });
});

group("planImport — manual_fields protection", () => {
  test("a differing field that is manually overridden is reported as protected, not as a change", () => {
    const plan = planImport(
      fetched({ description: "A completely rewritten description." }),
      existingRow({ manual_fields: ["description"] }),
      PLAY_URL,
    );
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    assert.deepEqual(plan.changes, []);
    assert.equal(plan.protectedFields.length, 1);
    assert.equal(plan.protectedFields[0].field, "description");
    // Protected but still differing -> unchanged is about what WOULD be
    // written, so this must not be reported as unchanged.
    assert.equal(plan.unchanged, true);
  });

  test("a manual field that happens to already match the fetched value is neither a change nor a protected diff", () => {
    const plan = planImport(
      fetched(),
      existingRow({ manual_fields: ["description"] }),
      PLAY_URL,
    );
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    assert.deepEqual(plan.changes, []);
    assert.deepEqual(plan.protectedFields, []);
  });

  test("only the manually-overridden field is protected; other differing fields still change", () => {
    const plan = planImport(
      fetched({ description: "Rewritten.", developer: "New Devs" }),
      existingRow({ manual_fields: ["description"] }),
      PLAY_URL,
    );
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].field, "developer_name");
    assert.equal(plan.protectedFields.length, 1);
    assert.equal(plan.protectedFields[0].field, "description");
  });

  test("fields Play never provides (screenshots, version, license) are never compared, manual or not", () => {
    const plan = planImport(
      fetched(),
      existingRow({ manual_fields: ["screenshots", "version_name", "license"] }),
      PLAY_URL,
    );
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    // None of these fields exist on ExistingAppRow at all — asserting the
    // plan simply never mentions them either way.
    const allFields = [...plan.changes, ...plan.protectedFields].map((c) => c.field);
    assert.ok(!allFields.includes("screenshots" as never));
    assert.ok(!allFields.includes("version_name" as never));
    assert.ok(!allFields.includes("license" as never));
  });
});

group("summarize", () => {
  function ok(overrides: Partial<Extract<UrlOutcome, { status: "ok" }>> = {}): UrlOutcome {
    return {
      status: "ok",
      url: PLAY_URL,
      packageName: "com.example.app",
      plan: planImport(fetched(), null, PLAY_URL),
      ...overrides,
    };
  }

  test("counts total, successful and failed fetches", () => {
    const outcomes: UrlOutcome[] = [
      ok(),
      { status: "invalid_url", line: "not-a-url", reason: "not a valid URL" },
      { status: "fetch_failed", url: PLAY_URL, packageName: "com.example.app", reason: "timeout" },
    ];
    const summary = summarize(outcomes);
    assert.equal(summary.totalUrls, 3);
    assert.equal(summary.successfulFetches, 1);
    assert.equal(summary.failedFetches, 2);
  });

  test("classifies new vs existing, and changed vs unchanged, among successful fetches", () => {
    const newAppOutcome = ok({ plan: planImport(fetched(), null, PLAY_URL) });
    const unchangedOutcome = ok({ plan: planImport(fetched(), existingRow(), PLAY_URL) });
    const changedOutcome = ok({
      plan: planImport(fetched({ developer: "New Devs" }), existingRow(), PLAY_URL),
    });

    const summary = summarize([newAppOutcome, unchangedOutcome, changedOutcome]);
    assert.equal(summary.totalUrls, 3);
    assert.equal(summary.successfulFetches, 3);
    assert.equal(summary.failedFetches, 0);
    assert.equal(summary.newApps, 1);
    assert.equal(summary.existingApps, 2);
    assert.equal(summary.unchangedApps, 1);
    assert.equal(summary.appsWithChanges, 1);
  });

  test("an empty run reports all-zero counts, not a crash", () => {
    assert.deepEqual(summarize([]), {
      totalUrls: 0,
      successfulFetches: 0,
      failedFetches: 0,
      existingApps: 0,
      newApps: 0,
      appsWithChanges: 0,
      unchangedApps: 0,
    });
  });
});
