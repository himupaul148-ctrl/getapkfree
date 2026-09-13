import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyPermittedChanges,
  createExternalAppFromPlay,
  summarizeApply,
  writableChangesFor,
  type ApplyOutcome,
} from "./play-apply.ts";
import { planImport, type ExistingAppRow } from "./play-dry-run.ts";
import { FakeSupabase } from "../apk/test-helpers/fake-supabase.ts";
import type { FetchedMetadata } from "./fetchers.ts";

/**
 * Run with: npm test — an in-memory FakeSupabase stand-in, never a real
 * database connection, matching lib/apk/save-build.test.ts's own pattern.
 */

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.example.app";

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

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
    unavailable: [],
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

group("writableChangesFor", () => {
  test("a real, non-null fetched value is applied", () => {
    const plan = planImport(fetched({ developer: "New Devs" }), existingRow(), PLAY_URL);
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    const { applied, skippedNull } = writableChangesFor(plan);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].field, "developer_name");
    assert.deepEqual(skippedNull, []);
  });

  test("a fetched null value that differs from a real stored value is never applied", () => {
    const plan = planImport(fetched({ category: null }), existingRow(), PLAY_URL);
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    const { applied, skippedNull } = writableChangesFor(plan);
    assert.deepEqual(applied, []);
    assert.equal(skippedNull.length, 1);
    assert.equal(skippedNull[0].field, "category");
    assert.equal(skippedNull[0].to, null);
  });

  test("a mix of a real change and a null-would-blank change separates cleanly", () => {
    const plan = planImport(
      fetched({ developer: "New Devs", icon_url: null, iconUrl: null }),
      existingRow(),
      PLAY_URL,
    );
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    const { applied, skippedNull } = writableChangesFor(plan);
    assert.deepEqual(applied.map((c) => c.field), ["developer_name"]);
    assert.deepEqual(skippedNull.map((c) => c.field), ["icon_url"]);
  });
});

group("applyPermittedChanges", () => {
  test("writes only the given fields to the app row, nothing else", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", name: "Old Name", rating: 3.0, description: "Old desc" });

    await applyPermittedChanges(client(fake), "app-1", [
      { field: "name", from: "Old Name", to: "New Name" },
    ]);

    assert.equal(fake.apps[0].name, "New Name");
    assert.equal(fake.apps[0].description, "Old desc"); // untouched
    assert.equal(fake.apps[0].rating, 3.0); // untouched
  });

  test("an empty change list writes nothing at all", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", name: "Old Name" });
    await applyPermittedChanges(client(fake), "app-1", []);
    assert.equal(fake.apps[0].name, "Old Name");
  });

  test("never receives a manually-protected field to begin with (protected fields never reach the writer)", () => {
    const plan = planImport(
      fetched({ description: "Rewritten." }),
      existingRow({ manual_fields: ["description"] }),
      PLAY_URL,
    );
    assert.equal(plan.kind, "existing");
    if (plan.kind !== "existing") return;
    const { applied } = writableChangesFor(plan);
    // The protected field never even makes it into `applied` — this is
    // enforced upstream by planImport()/writableChangesFor(), not by this
    // test calling the writer with it and hoping it's ignored.
    assert.ok(!applied.some((c) => c.field === "description"));
  });
});

group("createExternalAppFromPlay — new app, metadata only, no version row", () => {
  test("creates the app with source_type='external', hosted_locally=false, and no new source_type", async () => {
    const fake = new FakeSupabase();
    const proposed = {
      source_type: "external" as const,
      hosted_locally: false as const,
      external_url: PLAY_URL,
      scan_status: "external" as const,
      name: "Example App",
      package_name: "com.example.app",
      developer_name: "Example Devs",
      description: "An example app.",
      icon_url: "https://example.com/icon.png",
      category: "Tools",
      rating: 4.5,
      rating_count: 1000,
    };

    const result = await createExternalAppFromPlay(client(fake), {
      packageName: "com.example.app",
      proposed,
    });

    assert.equal(result.created, true);
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.apps[0].source_type, "external");
    assert.equal(fake.apps[0].hosted_locally, false);
    assert.equal(fake.apps[0].external_url, PLAY_URL);
    assert.deepEqual(fake.apps[0].manual_fields, []);
  });

  test("no versions row is created at all — no fabricated version_code, version_name, or any other build metadata", async () => {
    const fake = new FakeSupabase();
    await createExternalAppFromPlay(client(fake), {
      packageName: "com.example.app",
      proposed: {
        source_type: "external",
        hosted_locally: false,
        external_url: PLAY_URL,
        scan_status: "external",
        name: "Example App",
        package_name: "com.example.app",
        developer_name: null,
        description: null,
        icon_url: null,
        category: null,
        rating: null,
        rating_count: null,
      },
    });

    // The real assertion this whole fix is about: zero rows in `versions`
    // after creating a new Play-sourced app — no version_code, no
    // version_name ("Latest" or otherwise), no scan_status, no file_url,
    // nothing. fromPlay() has no legitimate source for a version number,
    // so none is invented.
    assert.equal(fake.versions.length, 0);
  });

  test("the result carries no version-related field of any kind", async () => {
    const fake = new FakeSupabase();
    const result = await createExternalAppFromPlay(client(fake), {
      packageName: "com.example.app",
      proposed: {
        source_type: "external",
        hosted_locally: false,
        external_url: PLAY_URL,
        scan_status: "external",
        name: "Example App",
        package_name: "com.example.app",
        developer_name: null,
        description: null,
        icon_url: null,
        category: null,
        rating: null,
        rating_count: null,
      },
    });
    assert.ok(!("versionId" in result));
    assert.deepEqual(Object.keys(result).sort(), ["appId", "created", "slug"]);
  });
});

group("createExternalAppFromPlay — package_name idempotency", () => {
  test("a second call for the same package_name creates nothing new", async () => {
    const fake = new FakeSupabase();
    const proposed = {
      source_type: "external" as const,
      hosted_locally: false as const,
      external_url: PLAY_URL,
      scan_status: "external" as const,
      name: "Example App",
      package_name: "com.example.app",
      developer_name: null,
      description: null,
      icon_url: null,
      category: null,
      rating: null,
      rating_count: null,
    };

    const first = await createExternalAppFromPlay(client(fake), {
      packageName: "com.example.app",
      proposed,
    });
    const second = await createExternalAppFromPlay(client(fake), {
      packageName: "com.example.app",
      proposed,
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.appId, first.appId);
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.versions.length, 0);
  });

  test("a concurrent-insert race (unique violation) is resolved to the winner's row, not a duplicate", async () => {
    const fake = new FakeSupabase();
    // Simulate another process's insert landing between this call's lookup
    // and its own insert attempt.
    fake.onBeforeInsert = (table, payload) => {
      if (table === "apps" && payload.package_name === "com.example.app" && fake.apps.length === 0) {
        fake.apps.push({ id: "winner-app", slug: "example-app", package_name: "com.example.app" });
      }
    };

    const result = await createExternalAppFromPlay(client(fake), {
      packageName: "com.example.app",
      proposed: {
        source_type: "external",
        hosted_locally: false,
        external_url: PLAY_URL,
        scan_status: "external",
        name: "Example App",
        package_name: "com.example.app",
        developer_name: null,
        description: null,
        icon_url: null,
        category: null,
        rating: null,
        rating_count: null,
      },
    });

    assert.equal(result.created, false);
    assert.equal(result.appId, "winner-app");
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.versions.length, 0);
  });
});

group("summarizeApply — a failed app never stops the batch, and counts are accurate", () => {
  test("failures alongside successes are all still counted, not thrown or dropped", () => {
    const outcomes: ApplyOutcome[] = [
      { status: "created", packageName: "com.a", appId: "app-a", slug: "a" },
      { status: "failed", packageName: "com.b", reason: "network error" },
      { status: "updated", packageName: "com.c", appId: "app-c", fields: ["name"] },
      { status: "unchanged", packageName: "com.d" },
      { status: "skipped_fdroid_owned", packageName: "com.e" },
    ];
    const summary = summarizeApply(outcomes);
    assert.equal(summary.total, 5);
    assert.equal(summary.created, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.updated, 1);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.skipped, 1);
  });

  test("processing continues past a failure — two real writes around a forced failure both land", async () => {
    const fake = new FakeSupabase();

    // App A: succeeds normally.
    const a = await createExternalAppFromPlay(client(fake), {
      packageName: "com.a",
      proposed: {
        source_type: "external",
        hosted_locally: false,
        external_url: "https://play.google.com/store/apps/details?id=com.a",
        scan_status: "external",
        name: "App A",
        package_name: "com.a",
        developer_name: null,
        description: null,
        icon_url: null,
        category: null,
        rating: null,
        rating_count: null,
      },
    });
    assert.equal(a.created, true);

    // App B: forced to fail.
    fake.forceError = { table: "apps", op: "insert", error: { message: "simulated failure", code: "XXXXX" } };
    await assert.rejects(() =>
      createExternalAppFromPlay(client(fake), {
        packageName: "com.b",
        proposed: {
          source_type: "external",
          hosted_locally: false,
          external_url: "https://play.google.com/store/apps/details?id=com.b",
          scan_status: "external",
          name: "App B",
          package_name: "com.b",
          developer_name: null,
          description: null,
          icon_url: null,
          category: null,
          rating: null,
          rating_count: null,
        },
      }),
    );

    // Clear the forced error, then app C succeeds — proving the earlier
    // failure did not corrupt or block subsequent, unrelated writes.
    fake.forceError = null;
    const c = await createExternalAppFromPlay(client(fake), {
      packageName: "com.c",
      proposed: {
        source_type: "external",
        hosted_locally: false,
        external_url: "https://play.google.com/store/apps/details?id=com.c",
        scan_status: "external",
        name: "App C",
        package_name: "com.c",
        developer_name: null,
        description: null,
        icon_url: null,
        category: null,
        rating: null,
        rating_count: null,
      },
    });
    assert.equal(c.created, true);

    assert.deepEqual(
      fake.apps.map((r) => r.package_name).sort(),
      ["com.a", "com.c"],
    );
    // No versions row was ever created for any of the three apps — the
    // failure/success mix above never had one to create in the first place.
    assert.equal(fake.versions.length, 0);
  });
});
