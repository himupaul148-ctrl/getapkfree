import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runEnrichmentBatch, type EnrichmentRunDeps } from "./github-apk-enrichment-run.ts";
import type { GithubApkImportResult } from "./github-release-import.ts";
import type { EligibleApp, RecordAttemptInput } from "./github-apk-enrichment-store.ts";

/**
 * Run with: npm test — importGithubApkForApp() and recordAttempt() are
 * both injected fakes here (each already has its own exhaustive test suite
 * — lib/apk/github-release-import.test.ts and
 * lib/apk/github-apk-enrichment-store.test.ts). This file proves only the
 * NEW orchestration in lib/apk/github-apk-enrichment-run.ts: which summary
 * counter each returned status increments, what gets logged, what gets
 * recorded, and — critically — that one app's failure never stops the
 * batch.
 */

function client(): SupabaseClient {
  return {} as unknown as SupabaseClient;
}

function app(overrides: Partial<EligibleApp> = {}): EligibleApp {
  return { appId: "app-1", packageName: "com.example.app", name: "Example App", ownerRepo: "someone/repo", ...overrides };
}

/** Captures every recordAttempt() call and every log line, in order. */
function trackedDeps(
  resultsByAppId: Record<string, GithubApkImportResult | (() => never)>,
): { deps: Partial<EnrichmentRunDeps>; logs: string[]; recorded: RecordAttemptInput[] } {
  const logs: string[] = [];
  const recorded: RecordAttemptInput[] = [];
  const deps: Partial<EnrichmentRunDeps> = {
    importGithubApkForApp: async (_supabase, targetApp) => {
      const outcome = resultsByAppId[targetApp.id];
      if (typeof outcome === "function") return outcome();
      if (!outcome) throw new Error(`no fixture result for ${targetApp.id}`);
      return outcome;
    },
    recordAttempt: async (_supabase, input) => {
      recorded.push(input);
    },
    log: (line) => logs.push(line),
  };
  return { deps, logs, recorded };
}

group("runEnrichmentBatch — per-status handling", () => {
  test("imported_unpublished: increments `imported`, logs the version, records ownerRepo/versionId", async () => {
    const result: GithubApkImportResult = {
      status: "imported_unpublished",
      ownerRepo: "leonlatsch/Photok",
      tagName: "3.3.0",
      appId: "app-1",
      versionId: "v-1",
      packageName: "dev.leonlatsch.photok",
      versionName: "3.3.0",
      versionCode: 71,
      scanStatus: "clean",
    };
    const { deps, logs, recorded } = trackedDeps({ "app-1": result });

    const summary = await runEnrichmentBatch(client(), [app({ name: "Photok" })], deps);

    assert.equal(summary.imported, 1);
    assert.equal(summary.processed, 1);
    assert.ok(logs.some((l) => l.includes("[Photok]") && l.includes("imported_unpublished")));
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].status, "imported_unpublished");
    assert.equal(recorded[0].ownerRepo, "leonlatsch/Photok");
    assert.equal(recorded[0].versionId, "v-1");
  });

  test("no_apk_asset: increments `no_apk`", async () => {
    const result: GithubApkImportResult = { status: "no_apk_asset", ownerRepo: "zackria/bit-switch", tagName: "v1.0" };
    const { deps, recorded } = trackedDeps({ "app-1": result });

    const summary = await runEnrichmentBatch(client(), [app({ name: "Bit Switch" })], deps);

    assert.equal(summary.no_apk, 1);
    assert.equal(summary.imported, 0);
    assert.equal(recorded[0].status, "no_apk_asset");
    assert.equal(recorded[0].ownerRepo, "zackria/bit-switch");
  });

  test("no_release: increments `no_release`", async () => {
    const result: GithubApkImportResult = { status: "no_release", ownerRepo: "someone/repo" };
    const { deps } = trackedDeps({ "app-1": result });
    const summary = await runEnrichmentBatch(client(), [app()], deps);
    assert.equal(summary.no_release, 1);
  });

  test("package_mismatch: increments `mismatch`, records the expected/actual package in the message", async () => {
    const result: GithubApkImportResult = {
      status: "package_mismatch",
      ownerRepo: "someone/repo",
      tagName: "1.0",
      expectedPackageName: "dev.example.target",
      actualPackageName: "com.attacker.other",
    };
    const { deps, recorded } = trackedDeps({ "app-1": result });

    const summary = await runEnrichmentBatch(client(), [app()], deps);

    assert.equal(summary.mismatch, 1);
    assert.match(recorded[0].message ?? "", /dev\.example\.target/);
    assert.match(recorded[0].message ?? "", /com\.attacker\.other/);
  });

  test("import_failed: increments `failed`, records the returned message", async () => {
    const result: GithubApkImportResult = { status: "import_failed", message: "Could not download the release APK." };
    const { deps, recorded } = trackedDeps({ "app-1": result });

    const summary = await runEnrichmentBatch(client(), [app()], deps);

    assert.equal(summary.failed, 1);
    assert.equal(recorded[0].status, "import_failed");
    assert.equal(recorded[0].message, "Could not download the release APK.");
  });

  test("already_has_version: increments `already_had_version` (e.g. a second run against the real Photok app)", async () => {
    const result: GithubApkImportResult = { status: "already_has_version", ownerRepo: "leonlatsch/Photok" };
    const { deps, recorded } = trackedDeps({ "app-1": result });

    const summary = await runEnrichmentBatch(client(), [app({ name: "Photok" })], deps);

    assert.equal(summary.already_had_version, 1);
    assert.equal(summary.imported, 0, "must never be counted as a fresh import");
    assert.equal(recorded[0].status, "already_has_version");
  });

  test("github_repo_not_found and multiple_apk_assets and no_github_source all count as `failed`", async () => {
    for (const result of [
      { status: "github_repo_not_found", ownerRepo: "someone/repo" } as GithubApkImportResult,
      { status: "multiple_apk_assets", ownerRepo: "someone/repo", tagName: "1.0", assets: [] } as GithubApkImportResult,
      { status: "no_github_source" } as GithubApkImportResult,
    ]) {
      const { deps } = trackedDeps({ "app-1": result });
      const summary = await runEnrichmentBatch(client(), [app()], deps);
      assert.equal(summary.failed, 1, `expected ${result.status} to count as failed`);
    }
  });
});

group("runEnrichmentBatch — duplicate/idempotency behavior", () => {
  test("a duplicate-version race result (already_has_version) is recorded, not treated as an error", async () => {
    const result: GithubApkImportResult = { status: "already_has_version", ownerRepo: "leonlatsch/Photok" };
    const { deps, recorded } = trackedDeps({ "app-1": result });

    const summary = await runEnrichmentBatch(client(), [app()], deps);

    assert.equal(summary.failed, 0);
    assert.equal(summary.already_had_version, 1);
    assert.equal(recorded.length, 1);
  });
});

group("runEnrichmentBatch — one app's failure never stops the batch", () => {
  test("an unexpected throw from importGithubApkForApp for one app still processes every other app", async () => {
    const okResult: GithubApkImportResult = { status: "no_apk_asset", ownerRepo: "zackria/bit-switch", tagName: "v1.0" };
    const { deps, logs, recorded } = trackedDeps({
      "app-1": () => {
        throw new Error("simulated transient database error");
      },
      "app-2": okResult,
      "app-3": okResult,
    });

    const summary = await runEnrichmentBatch(
      client(),
      [app({ appId: "app-1", name: "Broken App" }), app({ appId: "app-2", name: "Bit Switch" }), app({ appId: "app-3", name: "Third App" })],
      deps,
    );

    assert.equal(summary.eligible, 3);
    assert.equal(summary.processed, 3, "every app is still attempted");
    assert.equal(summary.failed, 1, "only the broken app counts as failed");
    assert.equal(summary.no_apk, 2, "the two healthy apps still succeed normally");
    assert.ok(logs.some((l) => l.includes("[Broken App] ERROR")));
    // The broken app's failure never reaches recordAttempt (there is no
    // valid status to record for a thrown exception) — only the two
    // successful apps' outcomes are recorded.
    assert.equal(recorded.length, 2);
  });

  test("a throw from recordAttempt itself (not just importGithubApkForApp) also does not stop the batch", async () => {
    const okResult: GithubApkImportResult = { status: "no_release", ownerRepo: "someone/repo" };
    let calls = 0;
    const deps: Partial<EnrichmentRunDeps> = {
      importGithubApkForApp: async () => okResult,
      recordAttempt: async () => {
        calls++;
        if (calls === 1) throw new Error("simulated write failure");
      },
      log: () => {},
    };

    const summary = await runEnrichmentBatch(
      client(),
      [app({ appId: "app-1", name: "First" }), app({ appId: "app-2", name: "Second" })],
      deps,
    );

    assert.equal(summary.processed, 2);
    assert.equal(summary.failed, 1, "the first app's recordAttempt failure counts as failed");
    assert.equal(summary.no_release, 1, "the second app still succeeds and is counted normally");
  });

  test("an empty eligible list produces an all-zero summary and never calls importGithubApkForApp", async () => {
    let called = false;
    const deps: Partial<EnrichmentRunDeps> = {
      importGithubApkForApp: async () => {
        called = true;
        throw new Error("must not be called");
      },
    };

    const summary = await runEnrichmentBatch(client(), [], deps);

    assert.deepEqual(summary, {
      eligible: 0,
      processed: 0,
      imported: 0,
      no_apk: 0,
      no_release: 0,
      mismatch: 0,
      failed: 0,
      already_had_version: 0,
    });
    assert.equal(called, false);
  });
});

group("runEnrichmentBatch — never publishes, never touches proposals", () => {
  test("the deps passed to importGithubApkForApp are exactly {id, packageName} — nothing that could publish or approve", async () => {
    let receivedArgs: unknown = null;
    const deps: Partial<EnrichmentRunDeps> = {
      importGithubApkForApp: async (_supabase, targetApp) => {
        receivedArgs = targetApp;
        return { status: "no_release", ownerRepo: "someone/repo" };
      },
      recordAttempt: async () => {},
      log: () => {},
    };

    await runEnrichmentBatch(client(), [app({ appId: "app-1", packageName: "com.example.app" })], deps);

    assert.deepEqual(receivedArgs, { id: "app-1", packageName: "com.example.app" });
  });
});

group("runEnrichmentBatch — uses the real, unmodified pipeline by default", () => {
  test("defaultEnrichmentRunDeps wires the actual importGithubApkForApp/recordAttempt, not stand-ins", async () => {
    const { defaultEnrichmentRunDeps } = await import("./github-apk-enrichment-run.ts");
    const { importGithubApkForApp: realImport } = await import("./github-release-import.ts");
    const { recordAttempt: realRecord } = await import("./github-apk-enrichment-store.ts");

    assert.equal(defaultEnrichmentRunDeps.importGithubApkForApp, realImport);
    assert.equal(defaultEnrichmentRunDeps.recordAttempt, realRecord);
  });
});
