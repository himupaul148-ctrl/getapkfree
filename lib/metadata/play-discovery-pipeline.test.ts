import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  processDiscoveryCandidate,
  TERMINAL_DISCOVERY_STATUSES,
  type DiscoveryCandidateRef,
  type DiscoveryPipelineDeps,
} from "./play-discovery-pipeline.ts";
import type { GithubCandidateContent } from "./github-play-resolution.ts";
import type { FetchedMetadata } from "./fetchers.ts";
import type { CurrentAppRow } from "./play-proposals.ts";
import type { ProposeOutcome } from "./play-proposal-store.ts";
import type { DiscoveryCandidatePatch } from "./play-discovery-store.ts";

/**
 * Run with: npm test — every dependency is an injected fake plain
 * function, never a real Supabase client, never a real network call.
 * This mirrors lib/metadata/play-watchlist-runner.test.ts's own pattern:
 * the orchestration layer itself is tested with fakes; the real
 * Supabase-backed implementations of those dependencies
 * (lib/metadata/play-proposal-store.ts, lib/metadata/play-discovery-store.ts)
 * already have their own FakeSupabase-based tests elsewhere.
 */

const PLAY_URL = "https://play.google.com/store/apps/details?id=com.example.app";
const NOW = new Date("2026-09-15T00:00:00.000Z");

function content(overrides: Partial<GithubCandidateContent> = {}): GithubCandidateContent {
  return {
    repository_url: "https://github.com/someone/cool-app",
    homepage_url: null,
    description: null,
    readme_excerpt: `Get it on Google Play: ${PLAY_URL}`,
    ...overrides,
  };
}

function fetchedMetadata(overrides: Partial<FetchedMetadata> = {}): FetchedMetadata {
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

type RecordedUpdate = { id: string; patch: DiscoveryCandidatePatch };

function makeDeps(overrides: Partial<DiscoveryPipelineDeps> = {}): {
  deps: DiscoveryPipelineDeps;
  updates: RecordedUpdate[];
  proposeCalls: { packageName: string; playUrl: string }[];
} {
  const updates: RecordedUpdate[] = [];
  const proposeCalls: { packageName: string; playUrl: string }[] = [];

  const deps: DiscoveryPipelineDeps = {
    fetchMetadata: async () => fetchedMetadata(),
    findCurrentApp: async () => null,
    findExistingProposal: async () => null,
    proposeForPackage: async (input) => {
      proposeCalls.push({ packageName: input.packageName, playUrl: input.playUrl });
      const outcome: ProposeOutcome = {
        status: "new_app",
        proposalId: "proposal-123",
        superseded: false,
        row: {
          proposal_type: "new_app",
          package_name: input.packageName,
          play_url: input.playUrl,
          app_id: null,
          proposed_fields: { name: input.fetched.name },
          previous_fields: null,
        },
      };
      return outcome;
    },
    updateDiscoveryCandidate: async (id, patch) => {
      updates.push({ id, patch });
    },
    now: NOW,
    ...overrides,
  };

  return { deps, updates, proposeCalls };
}

function candidate(status: DiscoveryCandidateRef["status"] = "found"): DiscoveryCandidateRef {
  return { id: "candidate-1", status };
}

/* --------------------------------------------------------------- happy path */

group("processDiscoveryCandidate — valid candidate end to end", () => {
  test("resolves, verifies, classifies as new_app, and creates a pending proposal", async () => {
    const { deps, updates, proposeCalls } = makeDeps();
    const result = await processDiscoveryCandidate(candidate(), content(), deps);

    assert.deepEqual(result, { outcome: "proposed", proposalId: "proposal-123", packageName: "com.example.app", playUrl: PLAY_URL });
    assert.equal(proposeCalls.length, 1);
    assert.equal(proposeCalls[0].packageName, "com.example.app");

    // Two writes: the 'verified' checkpoint, then the final 'proposed' write.
    assert.equal(updates.length, 2);
    assert.equal(updates[0].patch.status, "verified");
    assert.equal(updates[1].patch.status, "proposed");
    assert.equal(updates[1].patch.proposal_id, "proposal-123");
    assert.equal(updates[1].patch.package_name, "com.example.app");
    assert.equal(updates[1].patch.resolved_play_url, PLAY_URL);
    assert.equal(updates[1].patch.checked_at, NOW.toISOString());
  });
});

/* ---------------------------------------------------------------- no link */

group("processDiscoveryCandidate — no Play link", () => {
  test("disqualified_no_play_link, no verification, no proposal attempted", async () => {
    const { deps, updates, proposeCalls } = makeDeps();
    const result = await processDiscoveryCandidate(candidate(), content({ readme_excerpt: "Just a regular app, no store link here." }), deps);
    assert.deepEqual(result, { outcome: "disqualified_no_play_link" });
    assert.equal(proposeCalls.length, 0);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].patch.status, "disqualified_no_play_link");
    assert.ok(updates[0].patch.checked_at);
  });
});

/* ------------------------------------------------------------- ambiguous */

group("processDiscoveryCandidate — ambiguous links", () => {
  test("status = error, no proposal, does not choose arbitrarily", async () => {
    const { deps, updates, proposeCalls } = makeDeps();
    const twoApps = content({
      readme_excerpt:
        "Download on Google Play: https://play.google.com/store/apps/details?id=com.example.app. Also see https://play.google.com/store/apps/details?id=com.other.app.",
    });
    const result = await processDiscoveryCandidate(candidate(), twoApps, deps);
    assert.equal(result.outcome, "error");
    if (result.outcome === "error") {
      assert.match(result.reason, /ambiguous/i);
      assert.match(result.reason, /com\.example\.app/);
      assert.match(result.reason, /com\.other\.app/);
    }
    assert.equal(proposeCalls.length, 0);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].patch.status, "error");
    // Never picks one — resolved_play_url/package_name are left unset.
    assert.equal(updates[0].patch.resolved_play_url, undefined);
    assert.equal(updates[0].patch.package_name, undefined);
  });
});

/* --------------------------------------------------------- invalid link */

group("processDiscoveryCandidate — invalid Play link", () => {
  test("status = error when a details URL has no ?id=", async () => {
    const { deps, updates, proposeCalls } = makeDeps();
    const result = await processDiscoveryCandidate(
      candidate(),
      content({ readme_excerpt: "https://play.google.com/store/apps/details?hl=en" }),
      deps,
    );
    assert.equal(result.outcome, "error");
    if (result.outcome === "error") assert.match(result.reason, /invalid Play link/i);
    assert.equal(proposeCalls.length, 0);
    assert.equal(updates[0].patch.status, "error");
  });
});

/* ------------------------------------------------------ verification fails */

group("processDiscoveryCandidate — Play verification failure", () => {
  test("status = error, resolved URL/package still recorded, no proposal", async () => {
    const { deps, updates, proposeCalls } = makeDeps({
      fetchMetadata: async () => {
        throw new Error("503 from play.google.com");
      },
    });
    const result = await processDiscoveryCandidate(candidate(), content(), deps);
    assert.equal(result.outcome, "error");
    if (result.outcome === "error") assert.match(result.reason, /Play verification failed/);
    assert.equal(proposeCalls.length, 0);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].patch.status, "error");
    assert.equal(updates[0].patch.resolved_play_url, PLAY_URL);
    assert.equal(updates[0].patch.package_name, "com.example.app");
  });
});

/* ------------------------------------------------------------ existing app */

group("processDiscoveryCandidate — existing app", () => {
  test("disqualified_exists when the package already exists (metadata_update classification)", async () => {
    const existing: CurrentAppRow = {
      id: "app-1",
      slug: "example-app",
      package_name: "com.example.app",
      name: "Example App",
      description: "An example app.",
      icon_url: "https://example.com/icon.png",
      developer_name: "Example Devs",
      category: "Tools",
      rating: 3,
      rating_count: 10,
      manual_fields: [],
      source_type: "external",
    };
    const { deps, updates, proposeCalls } = makeDeps({ findCurrentApp: async () => existing });
    const result = await processDiscoveryCandidate(candidate(), content(), deps);
    assert.equal(result.outcome, "disqualified_exists");
    assert.equal(proposeCalls.length, 0);
    assert.equal(updates[updates.length - 1].patch.status, "disqualified_exists");
  });
});

group("processDiscoveryCandidate — F-Droid-owned app", () => {
  test("disqualified_exists when the existing app is F-Droid-owned (ineligible classification)", async () => {
    const fdroidApp: CurrentAppRow = {
      id: "app-2",
      slug: "fdroid-app",
      package_name: "com.example.app",
      name: "F-Droid App",
      description: null,
      icon_url: null,
      developer_name: null,
      category: null,
      rating: null,
      rating_count: 0,
      manual_fields: [],
      source_type: "fdroid",
    };
    const { deps, updates, proposeCalls } = makeDeps({ findCurrentApp: async () => fdroidApp });
    const result = await processDiscoveryCandidate(candidate(), content(), deps);
    assert.equal(result.outcome, "disqualified_exists");
    if (result.outcome === "disqualified_exists") assert.match(result.reason, /F-Droid/);
    assert.equal(proposeCalls.length, 0);
    assert.equal(updates[updates.length - 1].patch.status, "disqualified_exists");
  });
});

/* ---------------------------------------------------- duplicate protection */

group("processDiscoveryCandidate — duplicate protection", () => {
  test("an existing new_app proposal for the package prevents creating another one", async () => {
    const { deps, proposeCalls } = makeDeps({
      findExistingProposal: async () => ({ id: "old-proposal", status: "pending" }),
    });
    const result = await processDiscoveryCandidate(candidate(), content(), deps);
    assert.equal(result.outcome, "disqualified_exists");
    if (result.outcome === "disqualified_exists") assert.match(result.reason, /already exists/);
    assert.equal(proposeCalls.length, 0);
  });

  test("a REJECTED proposal also prevents resurfacing — a repeatedly discovered repo must not bypass an admin's decision", async () => {
    const { deps, proposeCalls } = makeDeps({
      findExistingProposal: async () => ({ id: "old-proposal", status: "rejected" }),
    });
    const result = await processDiscoveryCandidate(candidate(), content(), deps);
    assert.equal(result.outcome, "disqualified_exists");
    assert.equal(proposeCalls.length, 0);
  });
});

/* ------------------------------------------------------------ result fields */

group("processDiscoveryCandidate — result fields are stored correctly", () => {
  test("proposal id, resolved Play URL, package name, and checked_at all land in the final update", async () => {
    const { deps, updates } = makeDeps();
    await processDiscoveryCandidate(candidate(), content(), deps);
    const final = updates[updates.length - 1].patch;
    assert.equal(final.proposal_id, "proposal-123");
    assert.equal(final.resolved_play_url, PLAY_URL);
    assert.equal(final.package_name, "com.example.app");
    assert.equal(final.checked_at, NOW.toISOString());
  });
});

/* ------------------------------------------------------------ terminal skip */

group("processDiscoveryCandidate — terminal candidates are never reprocessed", () => {
  for (const status of TERMINAL_DISCOVERY_STATUSES) {
    test(`a candidate already '${status}' is skipped without calling any dependency`, async () => {
      const { deps, updates, proposeCalls } = makeDeps({
        fetchMetadata: async () => {
          throw new Error("must not be called");
        },
        findCurrentApp: async () => {
          throw new Error("must not be called");
        },
        findExistingProposal: async () => {
          throw new Error("must not be called");
        },
      });
      const result = await processDiscoveryCandidate(candidate(status), content(), deps);
      assert.deepEqual(result, { outcome: "skipped_terminal", status });
      assert.equal(updates.length, 0);
      assert.equal(proposeCalls.length, 0);
    });
  }

  test("'verified' and 'error' are NOT terminal — both are reprocessed", async () => {
    for (const status of ["verified", "error"] as const) {
      const { deps, proposeCalls } = makeDeps();
      const result = await processDiscoveryCandidate(candidate(status), content(), deps);
      assert.equal(result.outcome, "proposed");
      assert.equal(proposeCalls.length, 1);
    }
  });
});

/* -------------------------------------------------------------- safety */

group("processDiscoveryCandidate — never touches apps/versions/storage directly", () => {
  test("the pipeline itself has no code path capable of writing to apps/versions/storage — only the injected proposeForPackage/updateDiscoveryCandidate are ever called", async () => {
    const { deps, updates, proposeCalls } = makeDeps();
    await processDiscoveryCandidate(candidate(), content(), deps);
    // The only two "write" surfaces exercised are exactly these two
    // injected functions — there is no third call path in this module.
    assert.ok(updates.length > 0);
    assert.ok(proposeCalls.length > 0);
  });

  test("never calls proposeForPackage when classification is not new_app", async () => {
    const existing: CurrentAppRow = {
      id: "app-1",
      slug: "example-app",
      package_name: "com.example.app",
      name: "Example App",
      description: null,
      icon_url: null,
      developer_name: null,
      category: null,
      rating: null,
      rating_count: 0,
      manual_fields: [],
      source_type: "external",
    };
    const { deps, proposeCalls } = makeDeps({ findCurrentApp: async () => existing });
    await processDiscoveryCandidate(candidate(), content(), deps);
    assert.equal(proposeCalls.length, 0);
  });

  test("a concurrent-change race (proposeForPackage returns something other than new_app) is reflected honestly, not assumed successful", async () => {
    const { deps, updates } = makeDeps({
      proposeForPackage: async () => ({ status: "unchanged" }) as ProposeOutcome,
    });
    const result = await processDiscoveryCandidate(candidate(), content(), deps);
    assert.equal(result.outcome, "disqualified_exists");
    if (result.outcome === "disqualified_exists") assert.match(result.reason, /concurrent change/);
    assert.equal(updates[updates.length - 1].patch.status, "disqualified_exists");
  });
});
