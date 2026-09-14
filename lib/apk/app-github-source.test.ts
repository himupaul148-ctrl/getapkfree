import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidOwnerRepo, resolveAppGithubSource } from "./app-github-source.ts";
import { FakeSupabase } from "./test-helpers/fake-supabase.ts";

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

/* ---------------------------------------------------------- isValidOwnerRepo */

group("isValidOwnerRepo", () => {
  test("accepts a plausible owner/repo", () => {
    assert.equal(isValidOwnerRepo("leonlatsch/Photok"), true);
    assert.equal(isValidOwnerRepo("zackria/bit-switch"), true);
    assert.equal(isValidOwnerRepo("a/b"), true);
    assert.equal(isValidOwnerRepo("some-org/some.repo_name"), true);
  });

  test("rejects a malformed source_ref", () => {
    assert.equal(isValidOwnerRepo("not-a-repo-ref"), false, "no slash at all");
    assert.equal(isValidOwnerRepo("owner/"), false, "empty repo segment");
    assert.equal(isValidOwnerRepo("/repo"), false, "empty owner segment");
    assert.equal(isValidOwnerRepo("owner/repo/extra"), false, "too many segments");
    assert.equal(isValidOwnerRepo("-owner/repo"), false, "owner starting with a hyphen");
    assert.equal(isValidOwnerRepo("owner-/repo"), false, "owner ending with a hyphen");
    assert.equal(isValidOwnerRepo("https://github.com/owner/repo"), false, "a full URL, not a bare ref");
    assert.equal(isValidOwnerRepo(""), false, "empty string");
  });
});

/* ----------------------------------------------------- resolveAppGithubSource */

group("resolveAppGithubSource", () => {
  test("resolves a GitHub source_ref when a matching applied new_app proposal and github discovery candidate both exist", async () => {
    const fake = new FakeSupabase();
    fake.play_import_proposals.push({
      id: "proposal-1",
      package_name: "dev.leonlatsch.photok",
      proposal_type: "new_app",
      status: "applied",
      applied_at: "2026-09-10T00:00:00Z",
    });
    fake.play_discovery_candidates.push({
      id: "cand-1",
      source: "github",
      source_ref: "leonlatsch/Photok",
      proposal_id: "proposal-1",
    });

    const result = await resolveAppGithubSource(client(fake), "dev.leonlatsch.photok");
    assert.equal(result, "leonlatsch/Photok");
  });

  test("returns null when no proposal exists for the package at all", async () => {
    const fake = new FakeSupabase();
    const result = await resolveAppGithubSource(client(fake), "com.example.unknown");
    assert.equal(result, null);
  });

  test("returns null when a proposal exists but is not an applied new_app (still pending)", async () => {
    const fake = new FakeSupabase();
    fake.play_import_proposals.push({
      id: "proposal-1",
      package_name: "com.example.pending",
      proposal_type: "new_app",
      status: "pending",
    });
    const result = await resolveAppGithubSource(client(fake), "com.example.pending");
    assert.equal(result, null);
  });

  test("returns null when the applied proposal is a metadata_update, not a new_app", async () => {
    const fake = new FakeSupabase();
    fake.play_import_proposals.push({
      id: "proposal-1",
      package_name: "com.example.update",
      proposal_type: "metadata_update",
      status: "applied",
      applied_at: "2026-09-10T00:00:00Z",
    });
    const result = await resolveAppGithubSource(client(fake), "com.example.update");
    assert.equal(result, null);
  });

  test("returns null when the applied proposal has no matching discovery candidate (e.g. Discord, proposed via CLI --watchlist, not GitHub discovery)", async () => {
    const fake = new FakeSupabase();
    fake.play_import_proposals.push({
      id: "proposal-1",
      package_name: "com.discord",
      proposal_type: "new_app",
      status: "applied",
      applied_at: "2026-09-05T00:00:00Z",
    });
    // No play_discovery_candidates row at all for this proposal.
    const result = await resolveAppGithubSource(client(fake), "com.discord");
    assert.equal(result, null);
  });

  test("returns null when the matching candidate's source is not github (e.g. hn)", async () => {
    const fake = new FakeSupabase();
    fake.play_import_proposals.push({
      id: "proposal-1",
      package_name: "com.example.hn",
      proposal_type: "new_app",
      status: "applied",
      applied_at: "2026-09-05T00:00:00Z",
    });
    fake.play_discovery_candidates.push({
      id: "cand-1",
      source: "hn",
      source_ref: "12345",
      proposal_id: "proposal-1",
    });
    const result = await resolveAppGithubSource(client(fake), "com.example.hn");
    assert.equal(result, null);
  });

  test("returns null when the candidate's source_ref is malformed, rather than passing it through", async () => {
    const fake = new FakeSupabase();
    fake.play_import_proposals.push({
      id: "proposal-1",
      package_name: "com.example.bad",
      proposal_type: "new_app",
      status: "applied",
      applied_at: "2026-09-05T00:00:00Z",
    });
    fake.play_discovery_candidates.push({
      id: "cand-1",
      source: "github",
      source_ref: "not-a-valid-ref",
      proposal_id: "proposal-1",
    });
    const result = await resolveAppGithubSource(client(fake), "com.example.bad");
    assert.equal(result, null);
  });

  test("picks the most recently applied proposal when more than one exists for the same package", async () => {
    const fake = new FakeSupabase();
    fake.play_import_proposals.push(
      {
        id: "proposal-old",
        package_name: "com.example.multi",
        proposal_type: "new_app",
        status: "applied",
        applied_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "proposal-new",
        package_name: "com.example.multi",
        proposal_type: "new_app",
        status: "applied",
        applied_at: "2026-09-01T00:00:00Z",
      },
    );
    fake.play_discovery_candidates.push({
      id: "cand-new",
      source: "github",
      source_ref: "someone/newest",
      proposal_id: "proposal-new",
    });
    const result = await resolveAppGithubSource(client(fake), "com.example.multi");
    assert.equal(result, "someone/newest");
  });
});
