"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  INITIAL,
  Sequencer,
  applyIfCurrent,
  type SessionSnapshot,
} from "@/lib/session-state";

type SessionValue = SessionSnapshot & { refresh: () => void };

const SessionContext = createContext<SessionValue | null>(null);

/**
 * One source of session truth for the whole app.
 *
 * Three things this fixes over the hook it replaces:
 *
 *   1. **Ordering.** Every check takes a sequence number and stale responses
 *      are discarded. Previously a `getUser()` promise and an
 *      `onAuthStateChange` callback raced to write the same state, and because
 *      the "no session" path returned synchronously while the signed-in path
 *      awaited a query, the stale answer usually won and demoted the UI.
 *   2. **The server decides.** Admin status comes from /api/me, which runs the
 *      same `isAdmin()` the /admin gate uses. The client no longer re-derives
 *      it from a table read that RLS could answer differently.
 *   3. **One instance.** It was called independently by the header and the
 *      analytics tracker, so every page opened two sessions' worth of auth
 *      traffic and two subscriptions.
 */
export default function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(INITIAL);
  const sequencer = useRef(new Sequencer());
  const hadSession = useRef(false);

  const check = useCallback(async () => {
    const id = sequencer.current.begin();

    try {
      const res = await fetch("/api/me", {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!res.ok) {
        setSnapshot((prev) =>
          applyIfCurrent(sequencer.current, id, prev, {
            type: "failed",
            message: `Could not verify your session (HTTP ${res.status}).`,
          }),
        );
        return;
      }

      const body = await res.json();

      setSnapshot((prev) =>
        applyIfCurrent(sequencer.current, id, prev, {
          type: body.signedIn
            ? "resolved"
            : // Distinguish "signed out just now" from "never signed in", so
              // the badge can say the session expired instead of quietly
              // rendering a logged-out header.
              hadSession.current
              ? "expired"
              : "anonymous",
          ...(body.signedIn
            ? {
                userId: body.userId as string,
                username: (body.username as string | null) ?? null,
                isAdmin: body.isAdmin === true,
                drafts: body.drafts ?? null,
              }
            : {}),
        } as never),
      );

      if (body.signedIn) hadSession.current = true;
    } catch {
      setSnapshot((prev) =>
        applyIfCurrent(sequencer.current, id, prev, {
          type: "failed",
          message: "Could not reach the server to verify your session.",
        }),
      );
    }
  }, []);

  useEffect(() => {
    void check();

    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // The event is only a trigger to re-ask the server — its payload is
      // deliberately ignored. Trusting `session` from this callback is what
      // produced the original race.
      if (event === "SIGNED_OUT") hadSession.current = true;
      void check();
    });

    // Someone can be signed out in another tab, or a token can lapse while a
    // tab sits in the background.
    function onFocus() {
      if (document.visibilityState === "visible") void check();
    }
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [check]);

  const value = useMemo<SessionValue>(
    () => ({ ...snapshot, refresh: () => void check() }),
    [snapshot, check],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
}
