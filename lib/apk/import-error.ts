/**
 * Pure, framework-agnostic helpers for components/admin/ImportApkUrlForm.tsx.
 * Split out so the URL pre-check and error-display logic can be unit-tested
 * with the project's existing `node --test` setup — there is no React
 * component-testing framework in this repo, so the component itself stays
 * untested; this is the testable core of what it does.
 */

/** Client-side pre-check only — never a substitute for the server's own SSRF validation. */
export function validateUrlClientSide(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter an APK URL first.";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "That doesn't look like a valid URL.";
  }

  if (url.protocol !== "https:") {
    return "Only HTTPS URLs are accepted. Use a link starting with https://.";
  }

  return null;
}

export type ImportErrorDisplay = { label: string; message: string };

const SAFE_FALLBACK = "Something went wrong. Please try again.";

/**
 * Short, human labels per status code — not a re-diagnosis of the failure
 * (the backend's own message already says what actually went wrong; see
 * lib/apk/import-pipeline.ts, which only ever returns hand-written, blank
 * strings for unknown/internal errors — never a raw exception message,
 * stack trace, or file path). This is just a label for the badge next to it.
 */
const STATUS_LABELS: Record<number, string> = {
  400: "Blocked",
  403: "Not authorized",
  409: "Already imported",
  413: "Too large",
  422: "Invalid APK",
  502: "Download failed",
  500: "Server error",
};

/**
 * Extracts a safe, displayable message from a JSON error body. Never
 * returns anything but a plain, previously-known-safe string or the
 * fallback — a missing/malformed/non-string `error` field, or a body that
 * isn't JSON at all, degrades to the generic fallback rather than
 * stringifying whatever came back (which could otherwise render a raw
 * object dump in the UI).
 */
function extractErrorMessage(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const value = (body as { error: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export function classifyImportError(status: number, body: unknown): ImportErrorDisplay {
  return {
    label: STATUS_LABELS[status] ?? "Error",
    message: extractErrorMessage(body) ?? SAFE_FALLBACK,
  };
}
