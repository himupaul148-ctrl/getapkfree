"use client";

import Link from "next/link";
import { useState } from "react";
import { classifyImportError, validateUrlClientSide, type ImportErrorDisplay } from "@/lib/apk/import-error";

type ImportSuccess = {
  app: {
    id: string;
    slug: string;
    name: string;
    packageName: string;
    created: boolean;
  };
  version: {
    id: string;
    versionName: string;
    versionCode: number;
    minAndroidVersion: string | null;
    permissionsCount: number;
    scanStatus: string;
    published: boolean;
  };
};

type Stage = "idle" | "loading";

/**
 * Downloads, validates, and imports an APK from a remote URL via the
 * existing server pipeline (app/api/admin/import-apk-from-url/route.ts).
 * The browser sends nothing but the URL — every other value shown here
 * (package name, version, scan status…) comes back from the server, which
 * derived it from the APK itself. There is no SSRF logic here on purpose:
 * `validateUrlClientSide` only saves a round trip for an obviously bad
 * input, the server remains the actual authority.
 */
export default function ImportApkUrlForm() {
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<ImportErrorDisplay | null>(null);
  const [result, setResult] = useState<ImportSuccess | null>(null);

  const busy = stage === "loading";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const clientError = validateUrlClientSide(url);
    if (clientError) {
      setError({ label: "Check the URL", message: clientError });
      return;
    }

    setStage("loading");
    try {
      const res = await fetch("/api/admin/import-apk-from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the URL is ever sent — package_name, version_code, published,
        // scan_status etc. are not fields this form has, on purpose. The
        // server derives all of that from the downloaded APK itself.
        body: JSON.stringify({ url: url.trim() }),
      });

      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* handled by classifyImportError's fallback below */
      }

      if (!res.ok) {
        setError(classifyImportError(res.status, body));
        return;
      }

      setResult(body as ImportSuccess);
      setUrl("");
    } catch {
      setError({
        label: "Network error",
        message: "Could not reach the server. Check your connection and try again.",
      });
    } finally {
      setStage("idle");
    }
  }

  if (result) {
    return (
      <div className="rounded-2xl border border-brand-500/30 bg-brand-500/5 p-6">
        <h2 className="text-lg font-semibold text-brand-300">
          Imported successfully
        </h2>
        <p className="mt-1 text-sm font-medium text-warn-300">
          Saved as draft — not published.
        </p>

        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Info label="App name" value={result.app.name} />
          <Info label="Package name" value={result.app.packageName} mono />
          <Info label="Version" value={result.version.versionName} />
          <Info label="Version code" value={String(result.version.versionCode)} />
          <Info
            label="Minimum Android"
            value={result.version.minAndroidVersion ?? "Unknown"}
          />
          <Info
            label="Permissions"
            value={`${result.version.permissionsCount} requested`}
          />
          <Info label="Storage" value="Uploaded to GetApkFree storage" />
          <Info label="Published" value="No — draft" />
        </dl>

        <p className="mt-4 rounded-xl border border-base-800 bg-base-950 p-3 text-xs leading-relaxed text-fg-dim">
          {result.version.scanStatus === "clean" ? (
            <>
              This build was downloaded, structurally validated, and
              automatically checked against VirusTotal by its file hash —{" "}
              <span className="font-medium text-fg-muted">clean</span>.
              It still needs to be published from Apps Manager before it is
              downloadable.
            </>
          ) : result.version.scanStatus === "flagged" ? (
            <>
              This build was downloaded, structurally validated, and
              automatically checked against VirusTotal by its file hash — it
              was <span className="font-medium text-fg-muted">flagged</span>.
              It cannot be published until that is resolved.
            </>
          ) : (
            <>
              This build has been downloaded and structurally validated only
              — VirusTotal has not seen this exact file before (or no
              verdict could be obtained), so it has{" "}
              <span className="font-medium text-fg-muted">not</span> been
              malware-scanned. Its scan status is{" "}
              <code className="font-mono">pending</code> until it is
              re-checked or an admin reviews it directly.
            </>
          )}
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/admin/apps?status=unpublished"
            className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-base-950 transition-colors hover:bg-brand-400"
          >
            Review &amp; Publish
          </Link>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="rounded-xl border border-base-700 px-4 py-2.5 text-sm text-fg-muted hover:text-fg"
          >
            Import another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="rounded-2xl border border-base-800 bg-base-900 p-5">
        <label htmlFor="apk-url" className="block text-sm font-medium">
          APK URL
        </label>
        <p className="mt-1 text-xs text-fg-dim">
          A direct, public HTTPS link to the .apk file. The server downloads,
          validates, and hosts a copy — this is not the same as linking out to
          a Play Store or GitHub page.
        </p>
        <input
          id="apk-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/app.apk"
          disabled={busy}
          className="mt-3 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 disabled:opacity-60"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          <span className="font-semibold">{error.label}:</span> {error.message}
        </p>
      )}

      {busy && (
        <p className="rounded-xl border border-base-700 bg-base-850 px-4 py-3 text-sm text-azure-400">
          Downloading and validating APK… This can take a moment — it
          downloads the file, checks it, reads its metadata, and stores it
          before finishing.
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !url.trim()}
        className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-bold text-base-950 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Fetching…" : "Fetch APK"}
      </button>
    </form>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-fg-dim">{label}</dt>
      <dd className={`mt-0.5 text-fg ${mono ? "font-mono text-xs break-all" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
