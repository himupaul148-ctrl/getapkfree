import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DuplicateVersionError,
  createVersion,
  findOrCreateApp,
  updateAppMetadata,
} from "./save-build.ts";
import { FakeSupabase } from "./test-helpers/fake-supabase.ts";

/**
 * Run with: npm test
 *
 * Exercises the shared save/build logic against an in-memory fake of the
 * Supabase query builder — no real database, and no dependency on either
 * the browser or server Supabase client, matching how this module is
 * actually called from both components/admin/UploadForm.tsx and
 * lib/apk/import-pipeline.ts.
 */

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

group("findOrCreateApp", () => {
  test("creates a new app when the package does not exist yet", async () => {
    const fake = new FakeSupabase();
    const result = await findOrCreateApp(client(fake), {
      packageName: "com.example.app",
      name: "Example App",
      category: null,
      description: null,
      developerName: null,
      iconUrl: null,
    });

    assert.equal(result.created, true);
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.apps[0].package_name, "com.example.app");
    assert.equal(fake.apps[0].name, "Example App");
    assert.equal(fake.apps[0].slug, "example-app");
  });

  test("a newly-created hosted app never sets external-app fields", async () => {
    // The schema's own apps_source_shape_check requires an app to be either
    // fully external (source_type='external', external_url set,
    // hosted_locally=false) or fully hosted (source_type='fdroid',
    // hosted_locally=true, external_url=null). This module must rely on
    // the column defaults for a hosted import, never set source_type or
    // external_url itself.
    const fake = new FakeSupabase();
    await findOrCreateApp(client(fake), {
      packageName: "com.example.hosted",
      name: "Hosted App",
      category: null,
      description: null,
      developerName: null,
      iconUrl: null,
    });

    const row = fake.apps[0];
    assert.equal("source_type" in row, false);
    assert.equal("external_url" in row, false);
    assert.equal("hosted_locally" in row, false);
  });

  test("reuses an existing app by package_name instead of creating a duplicate", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", slug: "existing-app", package_name: "com.example.existing", name: "Existing" });

    const result = await findOrCreateApp(client(fake), {
      packageName: "com.example.existing",
      name: "Some Other Label",
      category: null,
      description: null,
      developerName: null,
      iconUrl: null,
    });

    assert.equal(result.created, false);
    assert.equal(result.appId, "app-1");
    assert.equal(result.slug, "existing-app");
    assert.equal(fake.apps.length, 1, "no duplicate app row must be created");
  });

  test("falls back to a suffixed slug on a collision", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", slug: "example-app", package_name: "com.example.other" });

    const result = await findOrCreateApp(client(fake), {
      packageName: "com.example.new",
      name: "Example App",
      category: null,
      description: null,
      developerName: null,
      iconUrl: null,
    });

    assert.notEqual(result.slug, "example-app");
    assert.match(result.slug, /^example-app-/);
  });

  test("recovers from a concurrent package_name race by reusing the winner's row", async () => {
    const fake = new FakeSupabase();
    fake.onBeforeInsert = (table, payload) => {
      // Simulate another request's insert landing first, for the exact
      // package this call is about to insert.
      if (table === "apps" && payload.package_name === "com.example.race") {
        fake.apps.push({ id: "app-winner", slug: "race-app", package_name: "com.example.race" });
      }
    };

    const result = await findOrCreateApp(client(fake), {
      packageName: "com.example.race",
      name: "Race App",
      category: null,
      description: null,
      developerName: null,
      iconUrl: null,
    });

    assert.equal(result.created, false, "the loser of the race must not report itself as the creator");
    assert.equal(result.appId, "app-winner");
    assert.equal(fake.apps.length, 1, "only the winner's row must exist");
  });
});

group("updateAppMetadata", () => {
  test("overwrites the editable fields on an existing app", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({
      id: "app-1",
      name: "App",
      category: "old-category",
      description: "old description",
      developer_name: "Old Dev",
      icon_url: "https://old.example/icon.png",
    });

    await updateAppMetadata(client(fake), "app-1", {
      category: "guides",
      description: "new description",
      developerName: "New Dev",
      iconUrl: "https://new.example/icon.png",
    });

    const row = fake.apps[0];
    assert.equal(row.category, "guides");
    assert.equal(row.description, "new description");
    assert.equal(row.developer_name, "New Dev");
    assert.equal(row.icon_url, "https://new.example/icon.png");
  });

  test("leaves the existing icon untouched when no new icon is given", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", icon_url: "https://old.example/icon.png" });

    await updateAppMetadata(client(fake), "app-1", {
      category: null,
      description: null,
      developerName: null,
      // iconUrl omitted
    });

    assert.equal(fake.apps[0].icon_url, "https://old.example/icon.png");
  });
});

group("createVersion", () => {
  test("creates a version row for a new build", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "app-1", package_name: "com.example.app" });

    const { versionId } = await createVersion(client(fake), {
      appId: "app-1",
      versionName: "1.0.0",
      versionCode: 1,
      fileUrl: "https://fake.supabase.local/storage/v1/object/public/apks/builds/x.apk",
      fileSize: 12345,
      minAndroidVersion: "9.0",
      permissions: ["android.permission.INTERNET"],
      scanStatus: "pending",
      scannedAt: null,
      published: false,
    });

    assert.ok(versionId);
    assert.equal(fake.versions.length, 1);
    assert.equal(fake.versions[0].published, false);
    assert.equal(fake.versions[0].scan_status, "pending");
    assert.equal(fake.versions[0].scanned_at, null);
  });

  test("throws DuplicateVersionError on a (app_id, version_code) clash, without creating a second row", async () => {
    const fake = new FakeSupabase();
    fake.versions.push({ id: "v-1", app_id: "app-1", version_code: 5 });

    await assert.rejects(
      createVersion(client(fake), {
        appId: "app-1",
        versionName: "5.0.0",
        versionCode: 5,
        fileUrl: "https://fake.supabase.local/x.apk",
        fileSize: 1,
        minAndroidVersion: null,
        permissions: [],
        scanStatus: "pending",
        scannedAt: null,
        published: false,
      }),
      (err: unknown) => {
        assert.ok(err instanceof DuplicateVersionError);
        assert.equal(err.versionCode, 5);
        return true;
      },
    );

    assert.equal(fake.versions.length, 1, "no duplicate version row must be created");
  });

  test("the same version_code is fine on a different app", async () => {
    const fake = new FakeSupabase();
    fake.versions.push({ id: "v-1", app_id: "app-1", version_code: 5 });

    const { versionId } = await createVersion(client(fake), {
      appId: "app-2",
      versionName: "5.0.0",
      versionCode: 5,
      fileUrl: "https://fake.supabase.local/x.apk",
      fileSize: 1,
      minAndroidVersion: null,
      permissions: [],
      scanStatus: "pending",
      scannedAt: null,
      published: false,
    });

    assert.ok(versionId);
    assert.equal(fake.versions.length, 2);
  });
});
