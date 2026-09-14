import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAttempt,
  getAttemptsByAppIds,
  recordAttempt,
  selectEligibleApps,
  DEFAULT_RETRY_COOLDOWN_HOURS,
  DEFAULT_MAX_ENRICHMENTS,
} from "./github-apk-enrichment-store.ts";
import { FakeSupabase } from "./test-helpers/fake-supabase.ts";

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

function seedGithubSource(fake: FakeSupabase, packageName: string, ownerRepo: string, appliedAt = "2026-09-01T00:00:00Z") {
  fake.play_import_proposals.push({
    id: `proposal-${packageName}`,
    package_name: packageName,
    proposal_type: "new_app",
    status: "applied",
    applied_at: appliedAt,
  });
  fake.play_discovery_candidates.push({
    id: `cand-${packageName}`,
    source: "github",
    source_ref: ownerRepo,
    proposal_id: `proposal-${packageName}`,
  });
}

function seedApp(fake: FakeSupabase, id: string, packageName: string, name = packageName) {
  fake.apps.push({ id, package_name: packageName, name });
}

/* --------------------------------------------------------------- recordAttempt / getAttempt */

group("getAttempt", () => {
  test("returns null when the app has never been attempted", async () => {
    const fake = new FakeSupabase();
    const attempt = await getAttempt(client(fake), "app-1");
    assert.equal(attempt, null);
  });

  test("returns the stored row when one exists", async () => {
    const fake = new FakeSupabase();
    fake.github_apk_enrichment_attempts.push({
      id: "e-1",
      app_id: "app-1",
      status: "no_apk_asset",
      message: "no assets",
      owner_repo: "someone/repo",
      version_id: null,
      attempt_count: 1,
      last_attempted_at: "2026-09-01T00:00:00Z",
      created_at: "2026-09-01T00:00:00Z",
    });
    const attempt = await getAttempt(client(fake), "app-1");
    assert.equal(attempt?.status, "no_apk_asset");
    assert.equal(attempt?.owner_repo, "someone/repo");
  });
});

group("getAttemptsByAppIds — the batched counterpart to getAttempt", () => {
  test("an empty appIds list returns an empty Map without touching the database", async () => {
    const fake = new FakeSupabase();
    // Force any query to fail loudly if one is somehow made — proves the
    // empty-input short-circuit never reaches .from() at all.
    fake.forceError = { table: "github_apk_enrichment_attempts", op: "select", error: { message: "must not be called", code: "XXXXX" } };

    const result = await getAttemptsByAppIds(client(fake), []);

    assert.ok(result instanceof Map);
    assert.equal(result.size, 0);
  });

  test("returns an empty Map when none of the given app ids have an attempt row", async () => {
    const fake = new FakeSupabase();
    fake.github_apk_enrichment_attempts.push({
      id: "e-1",
      app_id: "app-unrelated",
      status: "no_apk_asset",
      message: null,
      owner_repo: null,
      version_id: null,
      attempt_count: 1,
      last_attempted_at: "2026-09-01T00:00:00Z",
      created_at: "2026-09-01T00:00:00Z",
    });

    const result = await getAttemptsByAppIds(client(fake), ["app-1", "app-2"]);
    assert.equal(result.size, 0);
  });

  test("one matching app id returns a Map with exactly that entry", async () => {
    const fake = new FakeSupabase();
    fake.github_apk_enrichment_attempts.push({
      id: "e-1",
      app_id: "app-1",
      status: "already_has_version",
      message: null,
      owner_repo: "leonlatsch/Photok",
      version_id: null,
      attempt_count: 1,
      last_attempted_at: "2026-09-14T00:00:00Z",
      created_at: "2026-09-14T00:00:00Z",
    });

    const result = await getAttemptsByAppIds(client(fake), ["app-1"]);
    assert.equal(result.size, 1);
    assert.equal(result.get("app-1")?.status, "already_has_version");
  });

  test("multiple matching app ids all come back in one call — never one query per id", async () => {
    const fake = new FakeSupabase();
    fake.github_apk_enrichment_attempts.push(
      {
        id: "e-1",
        app_id: "app-1",
        status: "already_has_version",
        message: null,
        owner_repo: null,
        version_id: null,
        attempt_count: 1,
        last_attempted_at: "2026-09-14T00:00:00Z",
        created_at: "2026-09-14T00:00:00Z",
      },
      {
        id: "e-2",
        app_id: "app-2",
        status: "no_apk_asset",
        message: null,
        owner_repo: null,
        version_id: null,
        attempt_count: 1,
        last_attempted_at: "2026-09-14T00:00:00Z",
        created_at: "2026-09-14T00:00:00Z",
      },
    );

    const result = await getAttemptsByAppIds(client(fake), ["app-1", "app-2"]);
    assert.equal(result.size, 2);
    assert.equal(result.get("app-1")?.status, "already_has_version");
    assert.equal(result.get("app-2")?.status, "no_apk_asset");
  });

  test("a partial match returns only the ids that actually have a row — no entry, not an error, for the rest", async () => {
    const fake = new FakeSupabase();
    fake.github_apk_enrichment_attempts.push({
      id: "e-1",
      app_id: "app-1",
      status: "imported_unpublished",
      message: null,
      owner_repo: null,
      version_id: "v-1",
      attempt_count: 1,
      last_attempted_at: "2026-09-14T00:00:00Z",
      created_at: "2026-09-14T00:00:00Z",
    });

    const result = await getAttemptsByAppIds(client(fake), ["app-1", "app-2", "app-3"]);
    assert.equal(result.size, 1);
    assert.ok(result.has("app-1"));
    assert.equal(result.has("app-2"), false);
    assert.equal(result.has("app-3"), false);
  });
});

group("recordAttempt — first attempt for an app", () => {
  test("inserts a new row with attempt_count 1", async () => {
    const fake = new FakeSupabase();
    await recordAttempt(client(fake), { appId: "app-1", status: "no_release", ownerRepo: "owner/repo", message: "no release yet" });

    assert.equal(fake.github_apk_enrichment_attempts.length, 1);
    const row = fake.github_apk_enrichment_attempts[0];
    assert.equal(row.app_id, "app-1");
    assert.equal(row.status, "no_release");
    assert.equal(row.attempt_count, 1);
    assert.equal(row.owner_repo, "owner/repo");
    assert.equal(row.message, "no release yet");
  });

  test("optional fields default to null when omitted", async () => {
    const fake = new FakeSupabase();
    await recordAttempt(client(fake), { appId: "app-1", status: "no_github_source" });
    const row = fake.github_apk_enrichment_attempts[0];
    assert.equal(row.message, null);
    assert.equal(row.owner_repo, null);
    assert.equal(row.version_id, null);
  });
});

group("recordAttempt — repeated attempts for the same app", () => {
  test("never inserts a second row — updates the existing one and increments attempt_count", async () => {
    const fake = new FakeSupabase();
    await recordAttempt(client(fake), { appId: "app-1", status: "no_apk_asset", ownerRepo: "owner/repo" });
    await recordAttempt(client(fake), { appId: "app-1", status: "no_apk_asset", ownerRepo: "owner/repo" });
    await recordAttempt(client(fake), { appId: "app-1", status: "imported_unpublished", ownerRepo: "owner/repo", versionId: "v-1" });

    assert.equal(fake.github_apk_enrichment_attempts.length, 1, "only ever one row per app");
    const row = fake.github_apk_enrichment_attempts[0];
    assert.equal(row.attempt_count, 3);
    assert.equal(row.status, "imported_unpublished", "the latest status always wins");
    assert.equal(row.version_id, "v-1");
  });

  test("a race where a concurrent writer's first insert lands first is recovered by updating that row, not erroring", async () => {
    const fake = new FakeSupabase();
    // Simulate another process inserting the first attempt row between this
    // call's own getAttempt() read and its insert — the same race shape
    // lib/apk/save-build.ts's findOrCreateApp() already recovers from.
    let firstCall = true;
    fake.onBeforeInsert = (table, payload) => {
      if (table === "github_apk_enrichment_attempts" && firstCall) {
        firstCall = false;
        fake.github_apk_enrichment_attempts.push({
          id: "e-race",
          app_id: payload.app_id,
          status: "no_release",
          message: null,
          owner_repo: null,
          version_id: null,
          attempt_count: 1,
          last_attempted_at: "2026-09-01T00:00:00Z",
          created_at: "2026-09-01T00:00:00Z",
        });
      }
    };

    await recordAttempt(client(fake), { appId: "app-1", status: "no_apk_asset", ownerRepo: "owner/repo" });

    assert.equal(fake.github_apk_enrichment_attempts.length, 1, "no duplicate row from the race");
    const row = fake.github_apk_enrichment_attempts[0];
    assert.equal(row.attempt_count, 2, "the racer's row is updated, not replaced");
    assert.equal(row.status, "no_apk_asset");
  });
});

/* ------------------------------------------------------------- selectEligibleApps */

group("selectEligibleApps — basic eligibility", () => {
  test("an app with a resolvable GitHub source and zero versions is eligible", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, "app-1", "dev.leonlatsch.photok", "Photok");
    seedGithubSource(fake, "dev.leonlatsch.photok", "leonlatsch/Photok");

    const eligible = await selectEligibleApps(client(fake));
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0].appId, "app-1");
    assert.equal(eligible[0].ownerRepo, "leonlatsch/Photok");
    assert.equal(eligible[0].name, "Photok");
  });

  test("an app with no applied new_app proposal at all is never selected", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, "app-1", "com.example.manual", "Manually Added");
    // No play_import_proposals row at all.
    const eligible = await selectEligibleApps(client(fake));
    assert.equal(eligible.length, 0);
  });

  test("an app whose proposal is not a GitHub-sourced discovery (e.g. Discord, via --watchlist) is never selected", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, "app-1", "com.discord", "Discord");
    fake.play_import_proposals.push({
      id: "proposal-discord",
      package_name: "com.discord",
      proposal_type: "new_app",
      status: "applied",
      applied_at: "2026-09-01T00:00:00Z",
    });
    // No play_discovery_candidates row at all — no GitHub source.
    const eligible = await selectEligibleApps(client(fake));
    assert.equal(eligible.length, 0);
  });

  test("a proposal that is only 'pending' (not applied) is never selected", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, "app-1", "com.example.pending", "Pending App");
    fake.play_import_proposals.push({
      id: "proposal-pending",
      package_name: "com.example.pending",
      proposal_type: "new_app",
      status: "pending",
    });
    fake.play_discovery_candidates.push({
      id: "cand-pending",
      source: "github",
      source_ref: "someone/pending",
      proposal_id: "proposal-pending",
    });
    const eligible = await selectEligibleApps(client(fake));
    assert.equal(eligible.length, 0);
  });

  test("a metadata_update proposal (not new_app) is never selected", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, "app-1", "com.example.update", "Existing App");
    fake.play_import_proposals.push({
      id: "proposal-update",
      package_name: "com.example.update",
      proposal_type: "metadata_update",
      status: "applied",
      applied_at: "2026-09-01T00:00:00Z",
    });
    fake.play_discovery_candidates.push({
      id: "cand-update",
      source: "github",
      source_ref: "someone/update",
      proposal_id: "proposal-update",
    });
    const eligible = await selectEligibleApps(client(fake));
    assert.equal(eligible.length, 0);
  });
});

group("selectEligibleApps — zero-version requirement", () => {
  test("an app that already has a version is never selected, regardless of a resolvable GitHub source", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, "app-1", "dev.leonlatsch.photok", "Photok");
    seedGithubSource(fake, "dev.leonlatsch.photok", "leonlatsch/Photok");
    fake.versions.push({ id: "v-1", app_id: "app-1", version_code: 71 });

    const eligible = await selectEligibleApps(client(fake));
    assert.equal(eligible.length, 0);
  });
});

group("selectEligibleApps — terminal status exclusion", () => {
  for (const status of ["imported_unpublished", "already_has_version", "package_mismatch", "multiple_apk_assets"]) {
    test(`a terminal attempt status (${status}) is never re-selected`, async () => {
      const fake = new FakeSupabase();
      seedApp(fake, "app-1", "dev.leonlatsch.photok", "Photok");
      seedGithubSource(fake, "dev.leonlatsch.photok", "leonlatsch/Photok");
      fake.github_apk_enrichment_attempts.push({
        id: "e-1",
        app_id: "app-1",
        status,
        message: null,
        owner_repo: "leonlatsch/Photok",
        version_id: null,
        attempt_count: 1,
        // Even a very recent attempt must never be retried once terminal.
        last_attempted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      const eligible = await selectEligibleApps(client(fake));
      assert.equal(eligible.length, 0);
    });
  }
});

group("selectEligibleApps — retryable status handling and the cooldown window", () => {
  for (const status of ["github_repo_not_found", "no_release", "no_apk_asset", "import_failed"]) {
    test(`a retryable status (${status}) is NOT selected before the cooldown elapses`, async () => {
      const fake = new FakeSupabase();
      seedApp(fake, "app-1", "dev.leonlatsch.photok", "Photok");
      seedGithubSource(fake, "dev.leonlatsch.photok", "leonlatsch/Photok");
      const now = new Date("2026-09-14T12:00:00Z");
      fake.github_apk_enrichment_attempts.push({
        id: "e-1",
        app_id: "app-1",
        status,
        message: null,
        owner_repo: "leonlatsch/Photok",
        version_id: null,
        attempt_count: 1,
        // 1 hour ago — well inside the default 24h cooldown.
        last_attempted_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
        created_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      });

      const eligible = await selectEligibleApps(client(fake), { now });
      assert.equal(eligible.length, 0);
    });

    test(`a retryable status (${status}) IS selected once the cooldown has elapsed`, async () => {
      const fake = new FakeSupabase();
      seedApp(fake, "app-1", "dev.leonlatsch.photok", "Photok");
      seedGithubSource(fake, "dev.leonlatsch.photok", "leonlatsch/Photok");
      const now = new Date("2026-09-14T12:00:00Z");
      fake.github_apk_enrichment_attempts.push({
        id: "e-1",
        app_id: "app-1",
        status,
        message: null,
        owner_repo: "leonlatsch/Photok",
        version_id: null,
        attempt_count: 1,
        // 25 hours ago — past the default 24h cooldown.
        last_attempted_at: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
        created_at: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
      });

      const eligible = await selectEligibleApps(client(fake), { now });
      assert.equal(eligible.length, 1);
    });
  }

  test("the cooldown is configurable via cooldownHours", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, "app-1", "dev.leonlatsch.photok", "Photok");
    seedGithubSource(fake, "dev.leonlatsch.photok", "leonlatsch/Photok");
    const now = new Date("2026-09-14T12:00:00Z");
    fake.github_apk_enrichment_attempts.push({
      id: "e-1",
      app_id: "app-1",
      status: "no_apk_asset",
      message: null,
      owner_repo: "leonlatsch/Photok",
      version_id: null,
      attempt_count: 1,
      last_attempted_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    });

    const withDefaultCooldown = await selectEligibleApps(client(fake), { now });
    assert.equal(withDefaultCooldown.length, 0, "2h ago is still within the default 24h cooldown");

    const withShortCooldown = await selectEligibleApps(client(fake), { now, cooldownHours: 1 });
    assert.equal(withShortCooldown.length, 1, "2h ago is past a 1h cooldown");
  });

  test("DEFAULT_RETRY_COOLDOWN_HOURS is 24, matching the spec", () => {
    assert.equal(DEFAULT_RETRY_COOLDOWN_HOURS, 24);
  });
});

group("selectEligibleApps — batch size", () => {
  test("caps results at maxResults even when more apps are eligible", async () => {
    const fake = new FakeSupabase();
    for (let i = 0; i < 5; i++) {
      seedApp(fake, `app-${i}`, `com.example.app${i}`, `App ${i}`);
      seedGithubSource(fake, `com.example.app${i}`, `someone/app${i}`, `2026-09-0${i + 1}T00:00:00Z`);
    }

    const eligible = await selectEligibleApps(client(fake), { maxResults: 2 });
    assert.equal(eligible.length, 2);
  });

  test("DEFAULT_MAX_ENRICHMENTS is a sane positive default", () => {
    assert.ok(DEFAULT_MAX_ENRICHMENTS > 0);
  });

  test("maxResults of 0 returns nothing without querying further", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, "app-1", "dev.leonlatsch.photok", "Photok");
    seedGithubSource(fake, "dev.leonlatsch.photok", "leonlatsch/Photok");

    const eligible = await selectEligibleApps(client(fake), { maxResults: 0 });
    assert.equal(eligible.length, 0);
  });

  test("the same package is never counted twice even with multiple applied proposals in its history", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, "app-1", "dev.leonlatsch.photok", "Photok");
    // Two applied new_app proposals for the same package (e.g. a re-discovery).
    fake.play_import_proposals.push(
      { id: "proposal-old", package_name: "dev.leonlatsch.photok", proposal_type: "new_app", status: "applied", applied_at: "2026-01-01T00:00:00Z" },
      { id: "proposal-new", package_name: "dev.leonlatsch.photok", proposal_type: "new_app", status: "applied", applied_at: "2026-09-01T00:00:00Z" },
    );
    fake.play_discovery_candidates.push({
      id: "cand-new",
      source: "github",
      source_ref: "leonlatsch/Photok",
      proposal_id: "proposal-new",
    });

    const eligible = await selectEligibleApps(client(fake));
    assert.equal(eligible.length, 1);
  });
});
