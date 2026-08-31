"use client";

import Link from "next/link";
import { useSession } from "@/components/SessionProvider";
import { describe } from "@/lib/session-state";

/**
 * Says which mode you are in, on every page.
 *
 * The point is that "we could not determine your status" must look different
 * from "you are a regular user". Those were previously the same rendering,
 * which is why an admin could be silently switched to a user view with nothing
 * on screen to indicate it.
 *
 * It reflects the server's answer from /api/me, not a client guess — so if the
 * badge says Admin, the /admin gate agrees, and if it cannot say, it says so.
 */
export default function ModeBadge({
  className = "",
}: {
  className?: string;
}) {
  const session = useSession();
  const { label, tone } = describe(session);

  // Nothing to announce for a signed-out visitor on a public page.
  if (tone === "user" && !session.userId) return null;

  const styles = {
    admin: "border-brand-500/40 bg-brand-500/10 text-brand-300",
    user: "border-base-700 bg-base-850 text-fg-muted",
    warn: "border-warn-500/40 bg-warn-500/10 text-warn-300",
  }[tone];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${styles} ${className}`}
      // Screen readers should hear a status change, not just sighted users.
      role="status"
      aria-live="polite"
    >
      <Glyph tone={tone} />
      {label}

      {session.expired && (
        <Link href="/login" className="underline underline-offset-2">
          Sign in
        </Link>
      )}

      {session.error && !session.expired && (
        <button
          type="button"
          onClick={session.refresh}
          className="underline underline-offset-2"
        >
          Retry
        </button>
      )}
    </span>
  );
}

function Glyph({ tone }: { tone: "admin" | "user" | "warn" }) {
  if (tone === "admin") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6l7-3Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (tone === "warn") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 8v5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.2" fill="currentColor" />
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M4.5 20a7.5 7.5 0 0 1 15 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
