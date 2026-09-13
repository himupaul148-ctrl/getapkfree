import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findCurrentApp,
  insertProposal,
  proposeForPackage,
  summarizeProposeRun,
  type ProposeOutcome,
} from "./play-proposal-store.ts";
import { UnsafeProposalFieldError, type ProposalRow } from "./play-proposals.ts";
import { FakeSupabase } from "../apk/test-helpers/fake-supabase.ts";
import type { FetchedMetadata } from "./fetchers.ts";

/**
 * Run with: npm test — an in-memory FakeSupabase stand-in throughout, never
 * a real database connection or network call.
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

function seedApp(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  const row = {
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
    source_type: "external",
    ...overrides,
  };
  fake.apps.push(row);
  return row;
}

group("findCurrentApp", () => {
  test("returns null when the package does not exist", async () => {
    const fake = new FakeSupabase();
    const result = await findCurrentApp(client(fake), "com.nonexistent.app");
    assert.equal(result, null);
  });

  test("returns the app row when it exists", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    const result = await findCurrentApp(client(fake), "com.example.app");
    assert.equal(result?.slug, "example-app");
  });

  test("never touches versions — only ever selects from apps", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    fake.versions.push({ id: "v-1", app_id: "app-1" });
    await findCurrentApp(client(fake), "com.example.app");
    // findCurrentApp performs a read only; versions must be untouched.
    assert.equal(fake.versions.length, 1);
    assert.equal(fake.versions[0].id, "v-1");
  });
});

group("proposeForPackage — new_app", () => {
  test("inserts a pending new_app proposal with app_id null", async () => {
    const fake = new FakeSupabase();
    const outcome = await proposeForPackage(client(fake), {
      fetched: fetched(),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(outcome.status, "new_app");
    if (outcome.status !== "new_app") return;
    assert.equal(outcome.row.app_id, null);
    assert.equal(fake.play_import_proposals.length, 1);
    const stored = fake.play_import_proposals[0];
    assert.equal(stored.status, "pending");
    assert.equal(stored.proposal_type, "new_app");
    assert.equal(stored.app_id, null);
    assert.equal(stored.previous_fields, null);
  });

  test("never writes to apps or versions", async () => {
    const fake = new FakeSupabase();
    await proposeForPackage(client(fake), {
      fetched: fetched(),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(fake.apps.length, 0);
    assert.equal(fake.versions.length, 0);
  });

  test("proposed_fields contains only safe Play-comparable metadata", async () => {
    const fake = new FakeSupabase();
    const outcome = await proposeForPackage(client(fake), {
      fetched: fetched(),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(outcome.status, "new_app");
    if (outcome.status !== "new_app") return;
    assert.deepEqual(Object.keys(outcome.row.proposed_fields).sort(), [
      "category",
      "description",
      "developer_name",
      "icon_url",
      "name",
      "rating",
      "rating_count",
    ]);
  });

  test("zero-version new Play app is still proposed — versions never enter this at all", async () => {
    const fake = new FakeSupabase();
    const outcome = await proposeForPackage(client(fake), {
      fetched: fetched(),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(outcome.status, "new_app");
    assert.equal(fake.versions.length, 0);
  });
});

group("proposeForPackage — metadata_update", () => {
  test("inserts a pending metadata_update proposal with app_id set and previous_fields populated", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    const outcome = await proposeForPackage(client(fake), {
      fetched: fetched({ developer: "New Devs" }),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(outcome.status, "metadata_update");
    if (outcome.status !== "metadata_update") return;
    assert.equal(outcome.appSlug, "example-app");
    assert.equal(outcome.row.app_id, "app-1");
    assert.deepEqual(outcome.row.proposed_fields, { developer_name: "New Devs" });
    assert.deepEqual(outcome.row.previous_fields, { developer_name: "Example Devs" });
    assert.equal(fake.apps[0].developer_name, "Example Devs"); // untouched
  });

  test("manually overridden field is excluded — no proposal for it at all", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, { manual_fields: ["description"] });
    const outcome = await proposeForPackage(client(fake), {
      fetched: fetched({ description: "Rewritten by Play." }),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(outcome.status, "unchanged");
    assert.equal(fake.play_import_proposals.length, 0);
  });

  test("null Play field is excluded from the proposal", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    const outcome = await proposeForPackage(client(fake), {
      fetched: fetched({ category: null }),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(outcome.status, "unchanged");
    assert.equal(fake.play_import_proposals.length, 0);
  });
});

group("proposeForPackage — unchanged and F-Droid skip", () => {
  test("identical fetched values create no proposal", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    const outcome = await proposeForPackage(client(fake), {
      fetched: fetched(),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(outcome.status, "unchanged");
    assert.equal(fake.play_import_proposals.length, 0);
  });

  test("an F-Droid-sourced current app is skipped as ineligible, no proposal created", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, { source_type: "fdroid" });
    const outcome = await proposeForPackage(client(fake), {
      fetched: fetched({ developer: "New Devs" }),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(outcome.status, "ineligible");
    if (outcome.status !== "ineligible") return;
    assert.match(outcome.reason, /F-Droid/);
    assert.equal(fake.play_import_proposals.length, 0);
    assert.equal(fake.apps[0].source_type, "fdroid"); // untouched
  });
});

group("insertProposal — superseding and history preservation", () => {
  function row(overrides: Partial<ProposalRow> = {}): ProposalRow {
    return {
      proposal_type: "metadata_update",
      package_name: "com.example.app",
      play_url: PLAY_URL,
      app_id: "app-1",
      proposed_fields: { developer_name: "New Devs" },
      previous_fields: { developer_name: "Example Devs" },
      ...overrides,
    };
  }

  test("a second proposal for the same package+type supersedes the first, preserving its data", async () => {
    const fake = new FakeSupabase();
    const first = await insertProposal(client(fake), row());
    const second = await insertProposal(
      client(fake),
      row({ proposed_fields: { developer_name: "Even Newer Devs" } }),
    );

    assert.equal(second.superseded, true);
    assert.equal(fake.play_import_proposals.length, 2);

    const oldRow = fake.play_import_proposals.find((r) => r.id === first.id)!;
    assert.equal(oldRow.status, "superseded");
    // History preserved — nothing about the old row's own data changed,
    // only its status.
    assert.deepEqual(oldRow.proposed_fields, { developer_name: "New Devs" });

    const newRow = fake.play_import_proposals.find((r) => r.id === second.id)!;
    assert.equal(newRow.status, "pending");
    assert.deepEqual(newRow.proposed_fields, { developer_name: "Even Newer Devs" });
  });

  test("superseding never deletes the old row", async () => {
    const fake = new FakeSupabase();
    await insertProposal(client(fake), row());
    await insertProposal(client(fake), row());
    assert.equal(fake.play_import_proposals.length, 2);
  });

  test("a different package+type is never superseded by an unrelated insert", async () => {
    const fake = new FakeSupabase();
    const unrelated = await insertProposal(client(fake), row({ package_name: "com.other.app" }));
    await insertProposal(client(fake), row());
    const unrelatedRow = fake.play_import_proposals.find((r) => r.id === unrelated.id)!;
    assert.equal(unrelatedRow.status, "pending");
  });

  test("a concurrent-insert race (unique violation) is resolved by superseding the winner and retrying once", async () => {
    const fake = new FakeSupabase();
    // Simulate another process's pending proposal for the same
    // package+type landing between this call's own check and its insert.
    let injected = false;
    fake.onBeforeInsert = (table) => {
      if (table === "play_import_proposals" && !injected) {
        injected = true;
        fake.play_import_proposals.push({
          id: "race-winner",
          proposal_type: "metadata_update",
          package_name: "com.example.app",
          play_url: PLAY_URL,
          app_id: "app-1",
          proposed_fields: { rating: 3.1 },
          previous_fields: { rating: 4.5 },
          status: "pending",
          created_at: new Date().toISOString(),
        });
      }
    };

    const result = await insertProposal(client(fake), row());

    assert.equal(result.superseded, true);
    const raceWinnerRow = fake.play_import_proposals.find((r) => r.id === "race-winner")!;
    assert.equal(raceWinnerRow.status, "superseded");
    const finalRow = fake.play_import_proposals.find((r) => r.id === result.id)!;
    assert.equal(finalRow.status, "pending");
    // Exactly two rows total: the raced-in one (now superseded) and this
    // call's own successful insert — no duplicate pending rows.
    assert.equal(fake.play_import_proposals.length, 2);
    assert.equal(fake.play_import_proposals.filter((r) => r.status === "pending").length, 1);
  });

  test("re-validates field safety immediately before inserting — an unsafe field is rejected even if it somehow reached this function", async () => {
    const fake = new FakeSupabase();
    await assert.rejects(
      () => insertProposal(client(fake), row({ proposed_fields: { published: true } })),
      UnsafeProposalFieldError,
    );
    assert.equal(fake.play_import_proposals.length, 0);
  });
});

group("insertProposal / proposeForPackage — never touch storage", () => {
  test("no storage upload/remove call is ever made", async () => {
    const fake = new FakeSupabase();
    await proposeForPackage(client(fake), {
      fetched: fetched(),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    seedApp(fake);
    await proposeForPackage(client(fake), {
      fetched: fetched({ developer: "New Devs" }),
      packageName: "com.example.app",
      playUrl: PLAY_URL,
    });
    assert.equal(fake.storageUploads.length, 0);
    assert.equal(fake.storageRemovedPaths.length, 0);
  });
});

group("summarizeProposeRun", () => {
  test("counts every outcome kind correctly, including a failed fetch continuing the batch", () => {
    const outcomes: (ProposeOutcome | { status: "invalid_url" } | { status: "fetch_failed" } | { status: "failed" })[] =
      [
        { status: "invalid_url" },
        { status: "fetch_failed" },
        { status: "unchanged" },
        { status: "ineligible", reason: "F-Droid" },
        { status: "new_app", proposalId: "p-1", superseded: false, row: {} as ProposalRow },
        {
          status: "metadata_update",
          proposalId: "p-2",
          superseded: true,
          row: {} as ProposalRow,
          appSlug: "example-app",
        },
        { status: "failed" },
      ];
    const summary = summarizeProposeRun(outcomes);
    assert.equal(summary.totalUrls, 7);
    assert.equal(summary.failures, 3); // invalid_url + fetch_failed + failed
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.newProposals, 1);
    assert.equal(summary.metadataUpdateProposals, 1);
    assert.equal(summary.superseded, 1);
    assert.equal(summary.inserted, 2);
  });

  test("an empty run reports all-zero counts", () => {
    assert.deepEqual(summarizeProposeRun([]), {
      totalUrls: 0,
      successfulFetches: 0,
      failures: 0,
      newProposals: 0,
      metadataUpdateProposals: 0,
      unchanged: 0,
      skipped: 0,
      superseded: 0,
      inserted: 0,
    });
  });
});
