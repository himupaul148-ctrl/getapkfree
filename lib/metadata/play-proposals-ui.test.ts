import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  describeOutcome,
  fieldLabel,
  filterProposals,
  formatFieldValue,
  type PostActionResult,
} from "./play-proposals-ui.ts";

group("describeOutcome — errors", () => {
  test("a network failure is reported as unreachable, and stays in the list (retryable)", () => {
    const outcome = describeOutcome({ networkError: true });
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.removeFromList, false);
    assert.match(outcome.message, /Could not reach the server/);
  });

  test("401/403 is a permissions message, stays in the list", () => {
    for (const status of [401, 403]) {
      const outcome = describeOutcome({ networkError: false, status, body: { error: "Not authorised." } });
      assert.equal(outcome.kind, "error");
      assert.equal(outcome.removeFromList, false);
      assert.match(outcome.message, /permission/);
    }
  });

  test("404 explains the proposal is gone and removes it from the list", () => {
    const outcome = describeOutcome({ networkError: false, status: 404, body: { error: "No proposal with that id." } });
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.removeFromList, true);
    assert.match(outcome.message, /no longer exists/);
  });

  test("already-handled is explained and removes the proposal from the list", () => {
    const outcome = describeOutcome({
      networkError: false,
      status: 200,
      body: { alreadyHandled: true, status: "applied" },
    });
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.removeFromList, true);
    assert.match(outcome.message, /already applied/);
  });

  test("expired (stale) proposal — explains regeneration, not blind retry, and removes it", () => {
    const outcome = describeOutcome({ networkError: false, status: 409, body: { status: "expired" } });
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.removeFromList, true);
    assert.match(outcome.message, /expired/);
    assert.match(outcome.message, /regenerate/i);
    // Discourages retrying, rather than inviting it — "rather than
    // retrying" is the correct phrasing; "try again" would be the wrong one.
    assert.doesNotMatch(outcome.message, /try again/i);
    assert.match(outcome.message, /rather than retrying/i);
  });

  test("superseded proposal is explained and removed", () => {
    const outcome = describeOutcome({ networkError: false, status: 409, body: { status: "superseded" } });
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.removeFromList, true);
    assert.match(outcome.message, /no longer valid/);
  });

  test("a 5xx server error is a generic retryable message, stays in the list", () => {
    const outcome = describeOutcome({ networkError: false, status: 500, body: null });
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.removeFromList, false);
    assert.match(outcome.message, /went wrong/);
  });

  test("an unrecognized failure shape falls back to the server's own error message when present", () => {
    const outcome = describeOutcome({ networkError: false, status: 422, body: { error: "Something specific." } });
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.message, "Something specific.");
  });

  test("an unrecognized failure shape with no error message falls back to a generic one", () => {
    const outcome = describeOutcome({ networkError: false, status: 422, body: null });
    assert.equal(outcome.kind, "error");
    assert.match(outcome.message, /could not be completed/);
  });
});

group("describeOutcome — success", () => {
  test("200 with success:true is reported as success and removes the proposal", () => {
    const outcome = describeOutcome({ networkError: false, status: 200, body: { success: true, status: "applied" } });
    assert.equal(outcome.kind, "success");
    assert.equal(outcome.removeFromList, true);
  });
});

group("formatFieldValue", () => {
  test("rating_count formats with thousands separators, matching the spec's example exactly", () => {
    assert.equal(formatFieldValue("rating_count", 17199543), "17,199,543");
    assert.equal(formatFieldValue("rating_count", 17227838), "17,227,838");
  });

  test("rating is fixed to two decimal places", () => {
    assert.equal(formatFieldValue("rating", 4.3025898933410645), "4.30");
    assert.equal(formatFieldValue("rating", 3.8), "3.80");
  });

  test("null/undefined/empty-string all render as '(none)'", () => {
    assert.equal(formatFieldValue("category", null), "(none)");
    assert.equal(formatFieldValue("category", undefined), "(none)");
    assert.equal(formatFieldValue("category", ""), "(none)");
  });

  test("a plain string field passes through unchanged", () => {
    assert.equal(formatFieldValue("developer_name", "Discord Inc."), "Discord Inc.");
  });
});

group("fieldLabel", () => {
  test("known Play-comparable fields use the shared FIELD_LABELS from provenance.ts", () => {
    assert.equal(fieldLabel("rating_count"), "Rating count");
    assert.equal(fieldLabel("developer_name"), "Developer");
    assert.equal(fieldLabel("icon_url"), "Icon");
  });

  test("an unknown field falls back to its own raw name rather than throwing", () => {
    assert.equal(fieldLabel("something_unmapped"), "something_unmapped");
  });
});

group("filterProposals", () => {
  const proposals = [
    { id: "1", proposalType: "new_app" as const },
    { id: "2", proposalType: "metadata_update" as const },
    { id: "3", proposalType: "new_app" as const },
  ];

  test("'all' returns every proposal", () => {
    assert.equal(filterProposals(proposals, "all").length, 3);
  });

  test("'new_app' returns only new_app proposals", () => {
    const result = filterProposals(proposals, "new_app");
    assert.deepEqual(result.map((p) => p.id), ["1", "3"]);
  });

  test("'metadata_update' returns only metadata_update proposals", () => {
    const result = filterProposals(proposals, "metadata_update");
    assert.deepEqual(result.map((p) => p.id), ["2"]);
  });

  test("an empty list filters to an empty list, not an error", () => {
    assert.deepEqual(filterProposals([], "all"), []);
  });
});

group("PostActionResult — type-level sanity", () => {
  test("a network-error result and a real response result are both valid inputs to describeOutcome", () => {
    const a: PostActionResult = { networkError: true };
    const b: PostActionResult = { networkError: false, status: 200, body: { success: true } };
    assert.doesNotThrow(() => describeOutcome(a));
    assert.doesNotThrow(() => describeOutcome(b));
  });
});
