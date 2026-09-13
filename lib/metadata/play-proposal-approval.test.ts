import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { approveProposal, rejectProposal } from "./play-proposal-approval.ts";
import { FakeSupabase } from "../apk/test-helpers/fake-supabase.ts";

/**
 * Run with: npm test — FakeSupabase throughout, never a real database
 * connection, network call, or production project. Mirrors
 * lib/metadata/play-apply.test.ts's and lib/apk/save-build.test.ts's own
 * pattern for exercising Supabase-writing logic.
 *
 * The routes themselves (app/api/admin/play-proposals/[id]/{approve,reject}
 * /route.ts) are deliberately not unit-tested here — neither of the two
 * existing admin routes this project already has
 * (app/api/admin/fetch-metadata, app/api/admin/versions/[versionId]/verify)
 * has its own route-level test either; both push all real logic into a lib
 * module (exactly what these tests exercise) and leave the route as a thin,
 * unmodified isAdmin()-guard-plus-plumbing wrapper that isn't independently
 * tested anywhere in this codebase.
 */

const DECIDED_BY = "admin-user-1";
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.example.app";

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
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

function seedProposal(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  const row = {
    id: "proposal-1",
    proposal_type: "new_app",
    package_name: "com.example.app",
    play_url: PLAY_URL,
    app_id: null,
    proposed_fields: { name: "Example App", developer_name: "Example Devs" },
    previous_fields: null,
    status: "pending",
    created_at: new Date().toISOString(),
    decided_at: null,
    decided_by: null,
    rejection_reason: null,
    applied_at: null,
    ...overrides,
  };
  fake.play_import_proposals.push(row);
  return row;
}

group("approveProposal — missing proposal", () => {
  test("returns 404 for an id that does not exist", async () => {
    const fake = new FakeSupabase();
    const result = await approveProposal(client(fake), "no-such-id", DECIDED_BY);
    assert.equal(result.status, 404);
  });
});

group("approveProposal — new_app", () => {
  test("a pending new_app proposal is approved: app created, zero versions, proposal marked applied", async () => {
    const fake = new FakeSupabase();
    seedProposal(fake, {
      proposed_fields: {
        name: "Example App",
        description: "An example app.",
        icon_url: "https://example.com/icon.png",
        developer_name: "Example Devs",
        category: "Tools",
        rating: 4.5,
        rating_count: 1000,
      },
    });

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.apps[0].source_type, "external");
    assert.equal(fake.apps[0].hosted_locally, false);
    assert.equal(fake.apps[0].external_url, PLAY_URL);

    // The one thing this whole phase exists to guarantee:
    assert.equal(fake.versions.length, 0);

    const proposal = fake.play_import_proposals[0];
    assert.equal(proposal.status, "applied");
    assert.equal(proposal.decided_by, DECIDED_BY);
    assert.ok(proposal.decided_at);
    assert.ok(proposal.applied_at);
  });

  test("never touches Storage", async () => {
    const fake = new FakeSupabase();
    seedProposal(fake);
    await approveProposal(client(fake), "proposal-1", DECIDED_BY);
    assert.equal(fake.storageUploads.length, 0);
    assert.equal(fake.storageRemovedPaths.length, 0);
  });

  test("the app now existing (created between proposal creation and approval) supersedes the proposal, writes nothing", async () => {
    const fake = new FakeSupabase();
    seedApp(fake); // package already exists now
    seedProposal(fake);

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 409);
    assert.equal(fake.play_import_proposals[0].status, "superseded");
    // Exactly the one pre-existing app — nothing new was created.
    assert.equal(fake.apps.length, 1);
  });

  test("the app now being F-Droid-sourced supersedes the proposal, never downgrades it to external", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, { source_type: "fdroid" });
    seedProposal(fake);

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 409);
    assert.equal(fake.play_import_proposals[0].status, "superseded");
    assert.equal(fake.apps[0].source_type, "fdroid"); // untouched
  });

  test("a concurrent app creation racing the write itself is handled safely — no duplicate app", async () => {
    const fake = new FakeSupabase();
    seedProposal(fake);
    // Simulate another writer's app row landing exactly when this call
    // tries to insert its own.
    fake.onBeforeInsert = (table, payload) => {
      if (table === "apps" && payload.package_name === "com.example.app" && fake.apps.length === 0) {
        fake.apps.push({ id: "winner-app", slug: "example-app", package_name: "com.example.app" });
      }
    };

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 409);
    assert.equal(fake.play_import_proposals[0].status, "superseded");
    assert.equal(fake.apps.length, 1); // the race winner's row only
  });

  test("no version row is created for a new Play app under any of these paths", async () => {
    const fake = new FakeSupabase();
    seedProposal(fake);
    await approveProposal(client(fake), "proposal-1", DECIDED_BY);
    assert.equal(fake.versions.length, 0);
  });
});

group("approveProposal — metadata_update", () => {
  function seedUpdateProposal(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
    return seedProposal(fake, {
      proposal_type: "metadata_update",
      app_id: "app-1",
      proposed_fields: { developer_name: "New Devs" },
      previous_fields: { developer_name: "Example Devs" },
      ...overrides,
    });
  }

  test("a pending metadata_update proposal is approved and the field is written", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    seedUpdateProposal(fake);

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.appliedFields, ["developer_name"]);
    assert.equal(fake.apps[0].developer_name, "New Devs");
    assert.equal(fake.play_import_proposals[0].status, "applied");
  });

  test("manual field changed after proposal creation — the current (protected) value is preserved, not overwritten", async () => {
    const fake = new FakeSupabase();
    // By the time of approval, an admin has since marked developer_name manual.
    seedApp(fake, { manual_fields: ["developer_name"] });
    seedUpdateProposal(fake);

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.appliedFields, []);
    assert.equal(fake.apps[0].developer_name, "Example Devs"); // untouched
    assert.equal(fake.play_import_proposals[0].status, "applied"); // legitimately a no-op, not an error
  });

  test("app changed after proposal creation — live re-diff reflects the CURRENT value, not the stale snapshot", async () => {
    const fake = new FakeSupabase();
    // The proposal was built when rating_count was 1000 -> proposing 2000.
    // By approval time, some other process has already moved it to 2500.
    seedApp(fake, { rating_count: 2500 });
    seedUpdateProposal(fake, {
      proposed_fields: { rating_count: 2000 },
      previous_fields: { rating_count: 1000 },
    });

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 200);
    // Still genuinely differs from the live value (2500 -> 2000), so it is
    // legitimately applied — but against the live baseline, not the stale one.
    assert.deepEqual(result.body.appliedFields, ["rating_count"]);
    assert.equal(fake.apps[0].rating_count, 2000);
  });

  test("the app no longer existing supersedes the proposal", async () => {
    const fake = new FakeSupabase();
    seedUpdateProposal(fake); // no seedApp — the app has been deleted since

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 409);
    assert.equal(fake.play_import_proposals[0].status, "superseded");
  });

  test("F-Droid source rejection — the app becoming F-Droid-sourced supersedes the proposal, no write", async () => {
    const fake = new FakeSupabase();
    seedApp(fake, { source_type: "fdroid" });
    seedUpdateProposal(fake);

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 409);
    assert.equal(fake.play_import_proposals[0].status, "superseded");
    assert.equal(fake.apps[0].developer_name, "Example Devs"); // untouched
  });

  test("a forbidden field embedded in stored proposed_fields is never applied", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    // Not a shape buildProposalRow() would ever produce — simulating a
    // corrupted/tampered stored row to prove the defence holds regardless.
    seedUpdateProposal(fake, {
      proposed_fields: { developer_name: "New Devs", published: true, source_type: "fdroid" },
    });

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.appliedFields, ["developer_name"]);
    assert.equal(fake.apps[0].source_type, "external"); // never touched
    assert.ok(!("published" in fake.apps[0])); // never written at all
  });

  test("never creates or touches a versions row", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    fake.versions.push({ id: "v-1", app_id: "app-1", version_name: "1.0", published: true });
    seedUpdateProposal(fake);

    await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(fake.versions.length, 1);
    assert.equal(fake.versions[0].version_name, "1.0"); // untouched
  });

  test("never touches Storage", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    seedUpdateProposal(fake);
    await approveProposal(client(fake), "proposal-1", DECIDED_BY);
    assert.equal(fake.storageUploads.length, 0);
    assert.equal(fake.storageRemovedPaths.length, 0);
  });
});

group("approveProposal — staleness / expiry", () => {
  test("an expired proposal is transitioned to 'expired' and never applied", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    seedProposal(fake, {
      proposal_type: "metadata_update",
      app_id: "app-1",
      proposed_fields: { developer_name: "New Devs" },
      created_at: new Date("2020-01-01T00:00:00Z").toISOString(),
    });

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 409);
    assert.equal(fake.play_import_proposals[0].status, "expired");
    assert.equal(fake.apps[0].developer_name, "Example Devs"); // untouched
  });

  test("a fresh (within the default 30-day TTL) proposal is not treated as expired", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    seedUpdateProposalHelper(fake);
    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);
    assert.equal(result.status, 200);

    function seedUpdateProposalHelper(f: FakeSupabase) {
      return seedProposal(f, {
        proposal_type: "metadata_update",
        app_id: "app-1",
        proposed_fields: { developer_name: "New Devs" },
        created_at: new Date().toISOString(),
      });
    }
  });
});

group("approveProposal — idempotency", () => {
  test("an already-applied proposal returns an idempotent 'already handled' response, no re-write", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    seedProposal(fake, {
      proposal_type: "metadata_update",
      app_id: "app-1",
      status: "applied",
      proposed_fields: { developer_name: "Should Not Apply" },
    });

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(result.status, 200);
    assert.equal(result.body.alreadyHandled, true);
    assert.equal(fake.apps[0].developer_name, "Example Devs"); // untouched
  });

  test("approving the same pending proposal twice in sequence only applies once", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    seedProposal(fake, {
      proposal_type: "metadata_update",
      app_id: "app-1",
      proposed_fields: { developer_name: "New Devs" },
    });

    const first = await approveProposal(client(fake), "proposal-1", DECIDED_BY);
    const second = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    assert.equal(first.body.success, true);
    assert.equal(second.body.alreadyHandled, true);
    assert.equal(fake.apps[0].developer_name, "New Devs");
  });

  test("status transitions are conditional: a concurrent status change between load and write is not overwritten", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    seedProposal(fake, {
      proposal_type: "metadata_update",
      app_id: "app-1",
      proposed_fields: { developer_name: "New Devs" },
    });

    // Simulate a concurrent reject landing on this exact row right before
    // this call's own conditional UPDATE runs.
    fake.onBeforeUpdate = (table, payload) => {
      if (table === "play_import_proposals" && payload.status === "applied") {
        const row = fake.play_import_proposals.find((r) => r.id === "proposal-1")!;
        row.status = "rejected";
        fake.onBeforeUpdate = null; // only once
      }
    };

    const result = await approveProposal(client(fake), "proposal-1", DECIDED_BY);

    // The conditional update (WHERE status='pending') affected zero rows
    // because the row was already 'rejected' by the time it ran.
    assert.equal(result.body.alreadyHandled, true);
    assert.equal(fake.play_import_proposals[0].status, "rejected");
  });
});

group("rejectProposal", () => {
  test("missing proposal -> 404", async () => {
    const fake = new FakeSupabase();
    const result = await rejectProposal(client(fake), "no-such-id", DECIDED_BY, null);
    assert.equal(result.status, 404);
  });

  test("a pending proposal is rejected, decided_by/decided_at set, no apps/versions/storage touched", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    seedProposal(fake);

    const result = await rejectProposal(client(fake), "proposal-1", DECIDED_BY, "not a good fit");

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "rejected");
    const proposal = fake.play_import_proposals[0];
    assert.equal(proposal.status, "rejected");
    assert.equal(proposal.decided_by, DECIDED_BY);
    assert.ok(proposal.decided_at);
    assert.equal(proposal.rejection_reason, "not a good fit");
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.apps[0].name, "Example App"); // untouched
    assert.equal(fake.versions.length, 0);
    assert.equal(fake.storageUploads.length, 0);
  });

  test("rejection reason is optional — omitted entirely stores null", async () => {
    const fake = new FakeSupabase();
    seedProposal(fake);
    await rejectProposal(client(fake), "proposal-1", DECIDED_BY, null);
    assert.equal(fake.play_import_proposals[0].rejection_reason, null);
  });

  test("duplicate reject is safe — the second call is idempotent and does not overwrite the first reason", async () => {
    const fake = new FakeSupabase();
    seedProposal(fake);

    const first = await rejectProposal(client(fake), "proposal-1", DECIDED_BY, "first reason");
    const second = await rejectProposal(client(fake), "proposal-1", DECIDED_BY, "second reason (should not stick)");

    assert.equal(first.body.success, true);
    assert.equal(second.body.alreadyHandled, true);
    assert.equal(fake.play_import_proposals[0].rejection_reason, "first reason");
  });

  test("rejecting an already-applied proposal is a safe no-op, not an error", async () => {
    const fake = new FakeSupabase();
    seedProposal(fake, { status: "applied" });
    const result = await rejectProposal(client(fake), "proposal-1", DECIDED_BY, "too late");
    assert.equal(result.status, 200);
    assert.equal(result.body.alreadyHandled, true);
    assert.equal(fake.play_import_proposals[0].status, "applied");
  });

  test("never touches apps, versions, or storage in any outcome", async () => {
    const fake = new FakeSupabase();
    seedApp(fake);
    fake.versions.push({ id: "v-1", app_id: "app-1" });
    seedProposal(fake);
    await rejectProposal(client(fake), "proposal-1", DECIDED_BY, "reason");
    assert.equal(fake.apps.length, 1);
    assert.equal(fake.apps[0].name, "Example App");
    assert.equal(fake.versions.length, 1);
    assert.equal(fake.storageUploads.length, 0);
  });
});
