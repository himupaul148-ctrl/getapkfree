import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  INITIAL,
  Sequencer,
  applyIfCurrent,
  describe,
  reduce,
  type SessionSnapshot,
} from "./session-state.ts";

/**
 * Run with: npm test
 *
 * These cover the two failure modes that produced the original bug — a stale
 * response overwriting a fresh one, and a failed check being rendered as a
 * definite "not an admin". Both were invisible in the UI, which is exactly why
 * they need a test rather than a careful reading.
 */

const ADMIN: SessionSnapshot = {
  status: "admin",
  username: "himu",
  userId: "user-1",
  error: null,
  expired: false,
};

group("the race condition", () => {
  test("a stale response cannot overwrite a fresher one", () => {
    const seq = new Sequencer();
    let state = INITIAL;

    // Two checks start. The first is slow (a database round-trip); the second
    // is the fast "no session" path that used to win and demote the user.
    const slow = seq.begin();
    const fast = seq.begin();

    // The newer one lands first and is correct.
    state = applyIfCurrent(seq, fast, state, {
      type: "resolved",
      userId: "user-1",
      username: "himu",
      isAdmin: true,
    });
    assert.equal(state.status, "admin");

    // The older one lands afterwards claiming there is no session. This is the
    // exact sequence that used to flip the header to a logged-out view.
    state = applyIfCurrent(seq, slow, state, { type: "anonymous" });

    assert.equal(state.status, "admin", "stale response must be discarded");
    assert.equal(state.username, "himu");
  });

  test("the newest response always wins, whatever order they arrive in", () => {
    const seq = new Sequencer();
    let state = INITIAL;

    const first = seq.begin();
    const second = seq.begin();
    const third = seq.begin();

    // Deliberately out of order: 1, 3, 2.
    state = applyIfCurrent(seq, first, state, { type: "anonymous" });
    state = applyIfCurrent(seq, third, state, {
      type: "resolved",
      userId: "u3",
      username: "third",
      isAdmin: true,
    });
    state = applyIfCurrent(seq, second, state, {
      type: "resolved",
      userId: "u2",
      username: "second",
      isAdmin: false,
    });

    assert.equal(state.userId, "u3", "only the newest check should be applied");
    assert.equal(state.status, "admin");
  });

  test("a genuinely newer sign-out does take effect", () => {
    const seq = new Sequencer();
    let state = ADMIN;

    // Guarding against staleness must not block real transitions.
    const signOut = seq.begin();
    state = applyIfCurrent(seq, signOut, state, { type: "anonymous" });

    assert.equal(state.status, "user");
    assert.equal(state.userId, null);
  });
});

group("a failed check is never a demotion", () => {
  test("an error keeps the previous status", () => {
    const state = reduce(ADMIN, {
      type: "failed",
      message: "Network request failed",
    });

    assert.equal(state.status, "admin", "a failed check must not demote");
    assert.equal(state.error, "Network request failed");
  });

  test("an error surfaces as 'unknown', never as 'Signed in'", () => {
    const state = reduce(ADMIN, { type: "failed", message: "boom" });
    const shown = describe(state);

    assert.equal(shown.tone, "warn");
    assert.equal(shown.label, "Admin status unknown");
  });

  test("an unresolved check reads as checking, not as a regular user", () => {
    assert.equal(describe(INITIAL).label, "Checking…");
    assert.notEqual(describe(INITIAL).tone, "user");
  });
});

group("session expiry is distinct from being signed out", () => {
  test("expiry is reported, not silently rendered as logged out", () => {
    const state = reduce(ADMIN, { type: "expired" });

    assert.equal(state.expired, true);
    assert.equal(state.status, "unknown", "expiry is not the same as 'user'");
    assert.equal(describe(state).label, "Session expired");
  });

  test("never having signed in is an ordinary user, not an expiry", () => {
    const state = reduce(INITIAL, { type: "anonymous" });

    assert.equal(state.expired, false);
    assert.equal(state.status, "user");
  });
});

group("labels", () => {
  test("admin and user are unambiguous", () => {
    assert.equal(describe(ADMIN).label, "Admin");
    assert.equal(describe({ ...ADMIN, status: "user" }).label, "Signed in");
  });
});
