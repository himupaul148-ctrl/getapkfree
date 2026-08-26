"use client";

import { useEffect } from "react";

/**
 * Last resort: catches failures in the root layout itself, so it must supply
 * its own <html> and <body> — the layout that would normally provide them is
 * the thing that broke. That also means no Tailwind classes are guaranteed to
 * be applied, so the styling here is inline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#070a0f",
          color: "#e6edf3",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "32rem" }}>
          <p style={{ color: "#4ade80", fontWeight: 700, margin: 0 }}>
            GetApkFree
          </p>
          <h1 style={{ fontSize: "2rem", margin: "0.75rem 0 0" }}>
            Something went badly wrong
          </h1>
          <p style={{ color: "#97a6b8", lineHeight: 1.6 }}>
            The page could not be rendered at all. Reloading usually clears it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              background: "#22c55e",
              color: "#070a0f",
              border: 0,
              borderRadius: "0.75rem",
              padding: "0.75rem 1.25rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ color: "#6a7a8d", fontSize: "0.75rem", marginTop: "2rem" }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
