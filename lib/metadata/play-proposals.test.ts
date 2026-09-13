import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  assertSafeProposalFields,
  buildProposalRow,
  checkApprovalPreconditions,
  classifyProposal,
  DEFAULT_PROPOSAL_TTL_DAYS,
  FORBIDDEN_PROPOSAL_FIELDS,
  isProposalExpired,
  recomputeLiveChanges,
  supersede,
  UnsafeProposalFieldError,
  ProposalMismatchError,
  type CurrentAppRow,
} from "./play-proposals.ts";
import type { FetchedMetadata } from "./fetchers.ts";

/**
 * Pure unit tests only — no Supabase client, no network, no production
 * connection of any kind. Every function under test takes plain data and
 * returns plain data.
 */

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
    unavailable: [],
    ...overrides,
  };
}

function currentApp(overrides: Partial<CurrentAppRow> = {}): CurrentAppRow {
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
    source_type: "external",
    ...overrides,
  };
}

group("classifyProposal — new app", () => {
  test("no current app -> new_app classification", () => {
    const c = classifyProposal(fetched(), null, PLAY_URL);
    assert.equal(c.kind, "new_app");
  });

  test("a zero-version new Play app is still a valid new_app classification", () => {
    // classifyProposal has no notion of versions at all — it only ever
    // sees the apps-table row shape, which is the point: a Play draft is
    // metadata-only by design, and that must not disqualify it here.
    const c = classifyProposal(fetched(), null, PLAY_URL);
    assert.equal(c.kind, "new_app");
    if (c.kind !== "new_app") return;
    assert.equal(c.plan.proposed.name, "Example App");
  });
});

group("classifyProposal — metadata update", () => {
  test("existing external app with a real diff -> metadata_update", () => {
    const c = classifyProposal(fetched({ developer: "New Devs" }), currentApp(), PLAY_URL);
    assert.equal(c.kind, "metadata_update");
  });
});

group("classifyProposal — unchanged", () => {
  test("existing external app, identical fetched values -> unchanged", () => {
    const c = classifyProposal(fetched(), currentApp(), PLAY_URL);
    assert.equal(c.kind, "unchanged");
  });
});

group("classifyProposal — F-Droid ownership", () => {
  test("an F-Droid-sourced current app is classified ineligible, never metadata_update", () => {
    const c = classifyProposal(
      fetched({ developer: "New Devs" }),
      currentApp({ source_type: "fdroid" }),
      PLAY_URL,
    );
    assert.equal(c.kind, "ineligible");
    if (c.kind !== "ineligible") return;
    assert.match(c.reason, /F-Droid/);
  });
});

group("buildProposalRow — new_app", () => {
  test("shapes exactly the expected row fields, nothing else", () => {
    const c = classifyProposal(fetched(), null, PLAY_URL);
    const row = buildProposalRow(c, PLAY_URL);
    assert.ok(row);
    assert.equal(row!.proposal_type, "new_app");
    assert.equal(row!.package_name, "com.example.app");
    assert.equal(row!.play_url, PLAY_URL);
    assert.equal(row!.app_id, null);
    assert.equal(row!.previous_fields, null);
    assert.deepEqual(row!.proposed_fields, {
      name: "Example App",
      description: "An example app.",
      icon_url: "https://example.com/icon.png",
      developer_name: "Example Devs",
      category: "Tools",
      rating: 4.5,
      rating_count: 1000,
    });
  });

  test("does not store source_type/hosted_locally/external_url/scan_status — createExternalAppFromPlay hardcodes those, not this row", () => {
    const c = classifyProposal(fetched(), null, PLAY_URL);
    const row = buildProposalRow(c, PLAY_URL);
    const keys = Object.keys(row!.proposed_fields);
    for (const forbidden of ["source_type", "hosted_locally", "external_url", "scan_status"]) {
      assert.ok(!keys.includes(forbidden), `unexpected field: ${forbidden}`);
    }
  });
});

group("buildProposalRow — metadata_update", () => {
  test("proposed_fields/previous_fields carry only the differing, non-manual fields", () => {
    const c = classifyProposal(fetched({ developer: "New Devs" }), currentApp(), PLAY_URL);
    const row = buildProposalRow(c, PLAY_URL);
    assert.ok(row);
    assert.equal(row!.proposal_type, "metadata_update");
    assert.equal(row!.app_id, "app-1");
    assert.deepEqual(row!.proposed_fields, { developer_name: "New Devs" });
    assert.deepEqual(row!.previous_fields, { developer_name: "Example Devs" });
  });

  test("manually overridden field is excluded from the proposal entirely", () => {
    const c = classifyProposal(
      fetched({ description: "Rewritten by Play." }),
      currentApp({ manual_fields: ["description"] }),
      PLAY_URL,
    );
    // The field is protected, so the plan is "unchanged" from the
    // proposal's point of view — nothing safe to propose.
    assert.equal(c.kind, "unchanged");
    const row = buildProposalRow(c, PLAY_URL);
    assert.equal(row, null);
  });

  test("manually overridden field is excluded even when other fields do change", () => {
    const c = classifyProposal(
      fetched({ description: "Rewritten by Play.", developer: "New Devs" }),
      currentApp({ manual_fields: ["description"] }),
      PLAY_URL,
    );
    assert.equal(c.kind, "metadata_update");
    const row = buildProposalRow(c, PLAY_URL);
    assert.ok(row);
    assert.deepEqual(Object.keys(row!.proposed_fields), ["developer_name"]);
    assert.ok(!("description" in row!.proposed_fields));
  });

  test("a null Play field is never proposed as a change, even though it differs from a real stored value", () => {
    const c = classifyProposal(fetched({ category: null }), currentApp(), PLAY_URL);
    // planImport() itself still calls this a real diff (category:
    // "Tools" -> null); buildProposalRow is where the null gets dropped.
    assert.equal(c.kind, "metadata_update");
    const row = buildProposalRow(c, PLAY_URL);
    // Nothing else differs, so once the null-valued category change is
    // dropped there is genuinely nothing left to propose.
    assert.equal(row, null);
  });

  test("a null Play field is dropped while a real sibling change still survives", () => {
    const c = classifyProposal(
      fetched({ category: null, developer: "New Devs" }),
      currentApp(),
      PLAY_URL,
    );
    const row = buildProposalRow(c, PLAY_URL);
    assert.ok(row);
    assert.deepEqual(row!.proposed_fields, { developer_name: "New Devs" });
    assert.ok(!("category" in row!.proposed_fields));
  });
});

group("buildProposalRow — unchanged/ineligible", () => {
  test("unchanged classification produces no row", () => {
    const c = classifyProposal(fetched(), currentApp(), PLAY_URL);
    assert.equal(buildProposalRow(c, PLAY_URL), null);
  });

  test("ineligible (F-Droid) classification produces no row", () => {
    const c = classifyProposal(fetched({ developer: "New Devs" }), currentApp({ source_type: "fdroid" }), PLAY_URL);
    assert.equal(buildProposalRow(c, PLAY_URL), null);
  });
});

group("recomputeLiveChanges — live re-diff", () => {
  test("recomputes against the current row, not the stale proposed_fields snapshot", () => {
    // Proposal was created proposing developer_name -> "New Devs" while
    // the app's developer_name was still "Example Devs".
    const proposedFields = { developer_name: "New Devs" };
    // By the time this is re-checked, the app's developer_name has ALREADY
    // become "New Devs" some other way (e.g. a later admin edit) — so the
    // live diff must show nothing left to apply.
    const app = currentApp({ developer_name: "New Devs" });
    const { applied } = recomputeLiveChanges(proposedFields, app);
    assert.deepEqual(applied, []);
  });

  test("a field that is NOW manually overridden is protected even though it wasn't when the proposal was created", () => {
    const proposedFields = { description: "Rewritten." };
    const app = currentApp({ manual_fields: ["description"] });
    const { applied, protectedFields } = recomputeLiveChanges(proposedFields, app);
    assert.deepEqual(applied, []);
    assert.equal(protectedFields.length, 1);
    assert.equal(protectedFields[0].field, "description");
  });

  test("a null proposed value is skipped, never applied", () => {
    const proposedFields = { category: null };
    const app = currentApp(); // category: "Tools" currently
    const { applied, skippedNull } = recomputeLiveChanges(proposedFields, app);
    assert.deepEqual(applied, []);
    assert.equal(skippedNull.length, 1);
    assert.equal(skippedNull[0].field, "category");
  });

  test("a genuinely still-applicable change is returned in `applied`", () => {
    const proposedFields = { rating_count: 2000 };
    const app = currentApp(); // rating_count: 1000 currently
    const { applied } = recomputeLiveChanges(proposedFields, app);
    assert.equal(applied.length, 1);
    assert.equal(applied[0].field, "rating_count");
    assert.equal(applied[0].to, 2000);
  });

  test("the returned applied list never contains a forbidden/non-Play field", () => {
    const app = currentApp();
    const { applied } = recomputeLiveChanges({ rating: 4.9 }, app);
    assert.doesNotThrow(() => assertSafeProposalFields(applied));
  });
});

group("assertSafeProposalFields — safety invariant", () => {
  test("throws for every forbidden field, individually", () => {
    for (const field of FORBIDDEN_PROPOSAL_FIELDS) {
      assert.throws(
        () => assertSafeProposalFields([{ field: field as never, from: null, to: "x" }]),
        UnsafeProposalFieldError,
      );
      assert.throws(() => assertSafeProposalFields({ [field]: "x" }), UnsafeProposalFieldError);
    }
  });

  test("accepts every real Play-comparable field", () => {
    assert.doesNotThrow(() =>
      assertSafeProposalFields({
        name: "x",
        description: "x",
        icon_url: "x",
        developer_name: "x",
        category: "x",
        rating: 1,
        rating_count: 1,
      }),
    );
  });

  test("published, version fields, scan/APK fields are all explicitly covered", () => {
    for (const field of [
      "published",
      "version_code",
      "version_name",
      "scan_status",
      "target_sdk",
      "min_android_version",
      "permissions",
      "changelog",
      "file_size",
      "file_url",
    ]) {
      assert.ok((FORBIDDEN_PROPOSAL_FIELDS as readonly string[]).includes(field));
    }
  });
});

group("isProposalExpired — staleness", () => {
  test("a fresh proposal (created now) is not expired", () => {
    assert.equal(isProposalExpired(new Date(), new Date()), false);
  });

  test("a proposal older than the default 30-day TTL is expired", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-02-15T00:00:00Z"); // 45 days later
    assert.equal(isProposalExpired(created, now), true);
  });

  test("a proposal within the default 30-day TTL is not expired", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-20T00:00:00Z"); // 19 days later
    assert.equal(isProposalExpired(created, now), false);
  });

  test("the TTL is configurable — a 7-day TTL expires a 10-day-old proposal", () => {
    const created = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-11T00:00:00Z"); // 10 days later
    assert.equal(isProposalExpired(created, now, 30), false);
    assert.equal(isProposalExpired(created, now, 7), true);
  });

  test("accepts an ISO string for createdAt, not just a Date", () => {
    assert.equal(
      isProposalExpired("2026-01-01T00:00:00Z", new Date("2026-01-02T00:00:00Z")),
      false,
    );
  });

  test("DEFAULT_PROPOSAL_TTL_DAYS is exported and is 30", () => {
    assert.equal(DEFAULT_PROPOSAL_TTL_DAYS, 30);
  });
});

group("supersede — no DB writes, just the intended transition", () => {
  test("returns the old row's transition to 'superseded' and the fresh row to insert", () => {
    const c = classifyProposal(fetched({ developer: "New Devs" }), currentApp(), PLAY_URL);
    const fresh = buildProposalRow(c, PLAY_URL)!;
    const result = supersede(
      { id: "old-proposal-1", package_name: "com.example.app", proposal_type: "metadata_update" },
      fresh,
    );
    assert.deepEqual(result.oldProposalTransition, { id: "old-proposal-1", status: "superseded" });
    assert.equal(result.newProposal, fresh);
  });

  test("refuses to supersede across different packages", () => {
    const c = classifyProposal(fetched({ developer: "New Devs" }), currentApp(), PLAY_URL);
    const fresh = buildProposalRow(c, PLAY_URL)!;
    assert.throws(
      () => supersede({ id: "old-1", package_name: "com.other.app", proposal_type: "metadata_update" }, fresh),
      ProposalMismatchError,
    );
  });

  test("refuses to supersede across different proposal types for the same package", () => {
    const c = classifyProposal(fetched({ developer: "New Devs" }), currentApp(), PLAY_URL);
    const fresh = buildProposalRow(c, PLAY_URL)!;
    assert.throws(
      () => supersede({ id: "old-1", package_name: "com.example.app", proposal_type: "new_app" }, fresh),
      ProposalMismatchError,
    );
  });
});

group("checkApprovalPreconditions — new_app", () => {
  function proposal(overrides: Partial<Parameters<typeof checkApprovalPreconditions>[0]["proposal"]> = {}) {
    return {
      id: "p-1",
      status: "pending" as const,
      proposal_type: "new_app" as const,
      package_name: "com.example.app",
      created_at: new Date(),
      ...overrides,
    };
  }

  test("a genuinely new package (no current app) passes", () => {
    const result = checkApprovalPreconditions({ proposal: proposal(), currentApp: null });
    assert.equal(result.ok, true);
  });

  test("zero-version new Play app remains a valid, approvable proposal — versions never enter this check at all", () => {
    // checkApprovalPreconditions has no versions parameter whatsoever;
    // this test exists to make that omission explicit and intentional.
    const result = checkApprovalPreconditions({ proposal: proposal(), currentApp: null });
    assert.equal(result.ok, true);
  });

  test("rejected once the package already exists as any kind of app", () => {
    const result = checkApprovalPreconditions({ proposal: proposal(), currentApp: currentApp() });
    assert.equal(result.ok, false);
  });

  test("rejected, with a specific reason, once the package is now F-Droid-sourced", () => {
    const result = checkApprovalPreconditions({
      proposal: proposal(),
      currentApp: currentApp({ source_type: "fdroid" }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /F-Droid/);
  });

  test("not pending -> rejected regardless of current app state", () => {
    const result = checkApprovalPreconditions({
      proposal: proposal({ status: "applied" }),
      currentApp: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /not pending/);
  });

  test("expired -> rejected even though otherwise eligible", () => {
    const result = checkApprovalPreconditions({
      proposal: proposal({ created_at: new Date("2020-01-01") }),
      currentApp: null,
      now: new Date("2026-01-01"),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /expired/);
  });

  test("fresh (within TTL) proposal is accepted", () => {
    const result = checkApprovalPreconditions({
      proposal: proposal({ created_at: new Date("2026-01-01") }),
      currentApp: null,
      now: new Date("2026-01-05"),
    });
    assert.equal(result.ok, true);
  });
});

group("checkApprovalPreconditions — metadata_update", () => {
  function proposal(overrides: Partial<Parameters<typeof checkApprovalPreconditions>[0]["proposal"]> = {}) {
    return {
      id: "p-2",
      status: "pending" as const,
      proposal_type: "metadata_update" as const,
      package_name: "com.example.app",
      created_at: new Date(),
      ...overrides,
    };
  }

  test("passes when the app still exists, still external, and package matches", () => {
    const result = checkApprovalPreconditions({ proposal: proposal(), currentApp: currentApp() });
    assert.equal(result.ok, true);
  });

  test("rejected when the app no longer exists", () => {
    const result = checkApprovalPreconditions({ proposal: proposal(), currentApp: null });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /no longer exists/);
  });

  test("rejected on a package_name mismatch (defensive — should not normally happen given lookup-by-package_name)", () => {
    const result = checkApprovalPreconditions({
      proposal: proposal(),
      currentApp: currentApp({ package_name: "com.totally.different" }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /mismatch/);
  });

  test("rejected once the app has since become F-Droid-sourced", () => {
    const result = checkApprovalPreconditions({
      proposal: proposal(),
      currentApp: currentApp({ source_type: "fdroid" }),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /F-Droid/);
  });
});

group("end-to-end: live re-diff changes after the underlying app changes post-proposal", () => {
  test("a proposal generated against one app state re-diffs differently once the app itself has moved on", () => {
    // 1. Proposal created while the app looked like `currentApp()`.
    const classification = classifyProposal(
      fetched({ developer: "New Devs", ratingCount: 2000 }),
      currentApp(),
      PLAY_URL,
    );
    const row = buildProposalRow(classification, PLAY_URL)!;
    assert.deepEqual(row.proposed_fields, { developer_name: "New Devs", rating_count: 2000 });

    // 2. Time passes. An admin manually fixes developer_name by hand
    // (marking it manual) AND the rating_count in the DB has already
    // drifted to something else entirely via a later run.
    const laterApp = currentApp({
      developer_name: "Manually Corrected Devs",
      manual_fields: ["developer_name"],
      rating_count: 2500,
    });

    // 3. Re-diffing live must never use the stale row's numbers.
    const live = recomputeLiveChanges(row.proposed_fields, laterApp);
    // developer_name is now protected (manual) — never applied, regardless
    // of what the stale proposal said.
    assert.ok(!live.applied.some((c) => c.field === "developer_name"));
    assert.ok(live.protectedFields.some((c) => c.field === "developer_name"));
    // rating_count: proposal said 2000, current live value is already
    // 2500 — proposing 2000 now would be a regression, so the diff must
    // show it as still "applied" only if 2000 still differs from live
    // truth, which it does (2500 -> would still change to 2000) — this is
    // exactly why re-diffing at apply time, immediately before writing,
    // matters: a caller reviewing this live output sees that "changing to
    // 2000" is what the STALE proposal says, and can choose to regenerate
    // instead of blindly approving stale data.
    const ratingChange = live.applied.find((c) => c.field === "rating_count");
    assert.ok(ratingChange);
    assert.equal(ratingChange!.from, 2500);
    assert.equal(ratingChange!.to, 2000);
  });
});
