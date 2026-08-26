"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary. Renders inside the root layout, so the header,
 * footer and theme survive a failure.
 *
 * `reset()` re-runs the failed segment, which is genuinely useful here: the
 * common cause is a transient Supabase read, and retrying often just works.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in Vercel's runtime logs, where the digest can be matched up.
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <p className="font-mono text-sm text-danger-300">Something went wrong</p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
        This page failed to load
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-fg-muted">
        Usually a temporary problem reaching the catalogue. Trying again is
        worth a shot before anything else.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-base-950 transition-colors hover:bg-brand-400"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-xl border border-base-700 px-5 py-3 text-sm text-fg-muted transition-colors hover:border-base-600 hover:text-fg"
        >
          Back to the catalogue
        </Link>
      </div>

      {error.digest && (
        <p className="mt-10 font-mono text-xs text-fg-dim">
          Reference: {error.digest}
        </p>
      )}
    </div>
  );
}
