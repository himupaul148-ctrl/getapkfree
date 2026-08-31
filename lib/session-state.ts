/**
 * The session/admin state machine, kept pure so it can be tested without React.
 *
 * The bug this exists to prevent: the previous hook had two concurrent writers
 * (a `getUser()` promise and an `onAuthStateChange` subscription) racing to set
 * one piece of state, with no ordering guard. The "no user" path wrote
 * synchronously while the "signed in" path awaited a database round-trip, so a
 * stale null result routinely landed *after* a correct admin result and
 * silently demoted the UI to a regular-user view.
 *
 * Two rules fix that, and both are enforced here rather than in the component:
 *
 *   1. Every resolution carries a sequence number. Anything that is not the
 *      newest request is discarded, whatever order it arrives in.
 *   2. Admin status is tri-state. A failed or in-flight check is `unknown`,
 *      never `user` — so "we could not check" can never be rendered as
 *      "you are not an admin".
 */

export type AdminStatus = "admin" | "user" | "unknown";

export type SessionSnapshot = {
  status: AdminStatus;
  username: string | null;
  userId: string | null;
  /** Set when a check failed. The previous status is retained alongside it. */
  error: string | null;
  /** True once the session is known to have ended, as opposed to never existing. */
  expired: boolean;
};

export const INITIAL: SessionSnapshot = {
  status: "unknown",
  username: null,
  userId: null,
  error: null,
  expired: false,
};

export type SessionEvent =
  /** A completed check: this is who the visitor is. */
  | { type: "resolved"; userId: string; username: string | null; isAdmin: boolean }
  /** No session at all — signed out, or never signed in. */
  | { type: "anonymous" }
  /** The session existed and has now ended. */
  | { type: "expired" }
  /** The check itself failed. Status must not change. */
  | { type: "failed"; message: string };

export function reduce(
  previous: SessionSnapshot,
  event: SessionEvent,
): SessionSnapshot {
  switch (event.type) {
    case "resolved":
      return {
        status: event.isAdmin ? "admin" : "user",
        username: event.username,
        userId: event.userId,
        error: null,
        expired: false,
      };

    case "anonymous":
      return { ...INITIAL, status: "user" };

    case "expired":
      // Distinct from `anonymous`: the UI can say "your session expired"
      // rather than silently rendering a logged-out header.
      return { ...INITIAL, status: "unknown", expired: true };

    case "failed":
      // Deliberately keeps `status`. Treating a network failure as "not an
      // admin" is what made the original bug invisible — the UI looked
      // settled when it had simply failed to find out.
      return { ...previous, error: event.message };
  }
}

/**
 * Hands out sequence numbers and reports whether a given one is still current.
 *
 * Separate from `reduce` because the ordering guard is the half that the React
 * hook gets wrong under load, and it is the half worth testing directly.
 */
export class Sequencer {
  private latest = 0;

  /** Claim a slot for a check that is about to start. */
  begin(): number {
    this.latest += 1;
    return this.latest;
  }

  /** True only for the most recently started check. */
  isCurrent(id: number): boolean {
    return id === this.latest;
  }
}

/**
 * Applies an event only if it belongs to the newest in-flight check.
 *
 * This is the single line that fixes the race: a response from an older
 * request returns the previous state untouched, no matter how late it lands.
 */
export function applyIfCurrent(
  sequencer: Sequencer,
  id: number,
  previous: SessionSnapshot,
  event: SessionEvent,
): SessionSnapshot {
  if (!sequencer.isCurrent(id)) return previous;
  return reduce(previous, event);
}

/** What the badge shows. Kept here so the UI cannot invent its own wording. */
export function describe(snapshot: SessionSnapshot): {
  label: string;
  tone: "admin" | "user" | "warn";
} {
  if (snapshot.expired) {
    return { label: "Session expired", tone: "warn" };
  }
  if (snapshot.error) {
    // Never silently downgrade: say the check failed.
    return { label: "Admin status unknown", tone: "warn" };
  }
  if (snapshot.status === "admin") return { label: "Admin", tone: "admin" };
  if (snapshot.status === "user") return { label: "Signed in", tone: "user" };
  return { label: "Checking…", tone: "warn" };
}
