"use client";

import { useState } from "react";
import { Modal } from "@/components/admin/Modal";

/**
 * The one admin action for the GitHub Release APK enrichment flow: import
 * the latest GitHub Release's APK for an approved, zero-version,
 * GitHub-discovered app. All the actual work happens server-side in
 * POST /api/admin/apps/[id]/import-from-github (backed by
 * lib/apk/github-release-import.ts) — this component only renders the
 * button, a confirmation, an asset picker for the rare multi-APK case, and
 * the result. It never publishes anything: a successful import always
 * leaves the new build as an unpublished draft for a separate, deliberate
 * Publish click in the version list below.
 */

type AssetSummary = { name: string; browserDownloadUrl: string; size: number };

type ImportApiResult =
  | { status: "no_github_source" }
  | { status: "github_repo_not_found"; ownerRepo: string }
  | { status: "no_release"; ownerRepo: string }
  | { status: "no_apk_asset"; ownerRepo: string; tagName: string }
  | { status: "multiple_apk_assets"; ownerRepo: string; tagName: string; assets: AssetSummary[] }
  | { status: "package_mismatch"; ownerRepo: string; tagName: string; expectedPackageName: string; actualPackageName: string | null }
  | { status: "already_has_version"; ownerRepo: string | null }
  | {
      status: "imported_unpublished";
      ownerRepo: string;
      tagName: string;
      versionName: string;
      versionCode: number;
      scanStatus: string;
    }
  | { status: "import_failed"; message?: string }
  | { error: string };

type EligibleApp = { id: string; name: string; versionCount: number; githubSourceRepo: string | null };

type Phase =
  | { kind: "confirm" }
  | { kind: "working" }
  | { kind: "choose-asset"; ownerRepo: string; tagName: string; assets: AssetSummary[] }
  | { kind: "result"; result: ImportApiResult };

function resultMessage(result: ImportApiResult): string {
  if ("error" in result) return result.error;
  switch (result.status) {
    case "no_github_source":
      return "No GitHub source is linked to this app.";
    case "github_repo_not_found":
      return `The linked GitHub repository (${result.ownerRepo}) could not be found.`;
    case "no_release":
      return `No GitHub Release is currently available for ${result.ownerRepo}.`;
    case "no_apk_asset":
      return "No APK release asset is currently available for this repository.";
    case "package_mismatch":
      return "The GitHub APK package does not match this app and was not imported.";
    case "already_has_version":
      return "This app already has a version — nothing was imported.";
    case "imported_unpublished":
      return "APK imported as an unpublished version. Review and publish it manually.";
    case "import_failed":
      return result.message || "The import failed.";
    default:
      return "Something unexpected happened.";
  }
}

export default function GithubApkImportAction({
  app,
  onImported,
}: {
  app: EligibleApp;
  onImported: () => void;
}) {
  const [phase, setPhase] = useState<Phase | null>(null);

  // Only shown for an app this flow actually applies to: zero builds so
  // far, and a GitHub repository its own Play-discovery approval traces
  // back to (resolved read-only, DB-only, at page-load — never F-Droid,
  // never an app with no discovery history, never an app that already has
  // a build).
  if (app.versionCount > 0 || !app.githubSourceRepo) return null;

  async function runImport(selectedAssetUrl?: string) {
    setPhase({ kind: "working" });
    try {
      const res = await fetch(`/api/admin/apps/${app.id}/import-from-github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedAssetUrl ? { selectedAssetUrl } : {}),
      });
      const result: ImportApiResult = await res.json().catch(() => ({ error: "The server returned an invalid response." }));

      if (!("error" in result) && result.status === "multiple_apk_assets") {
        setPhase({ kind: "choose-asset", ownerRepo: result.ownerRepo, tagName: result.tagName, assets: result.assets });
        return;
      }

      setPhase({ kind: "result", result });
      if (!("error" in result) && result.status === "imported_unpublished") {
        onImported();
      }
    } catch {
      setPhase({ kind: "result", result: { error: "Could not reach the server." } });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setPhase({ kind: "confirm" })}
        className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
      >
        Import GitHub APK
      </button>

      {phase?.kind === "confirm" && (
        <Modal title={`Import the latest GitHub Release APK for ${app.name}?`} onClose={() => setPhase(null)}>
          <p className="text-sm leading-relaxed text-fg-muted">
            This downloads the latest APK release asset from{" "}
            <span className="font-mono text-fg">{app.githubSourceRepo}</span> — the GitHub repository this
            app&rsquo;s approval was traced back to — validates it, and confirms its package name matches this
            app before saving anything. The resulting build is created <strong>unpublished</strong>; nothing
            becomes downloadable until you publish it separately below.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => void runImport()}
              className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-base-950 hover:bg-brand-400"
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => setPhase(null)}
              className="rounded-xl border border-base-700 px-4 py-2.5 text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {phase?.kind === "working" && (
        <Modal title={`Importing ${app.name}…`} onClose={() => {}}>
          <p className="text-sm text-fg-muted">Downloading and validating the release APK…</p>
        </Modal>
      )}

      {phase?.kind === "choose-asset" && (
        <Modal title={`Multiple APK assets found in ${phase.tagName}`} onClose={() => setPhase(null)}>
          <p className="text-sm leading-relaxed text-fg-muted">
            This release has more than one APK asset. Choose exactly one to import — nothing is guessed
            automatically.
          </p>
          <ul className="mt-4 space-y-2">
            {phase.assets.map((asset) => (
              <li key={asset.browserDownloadUrl}>
                <button
                  type="button"
                  onClick={() => void runImport(asset.browserDownloadUrl)}
                  className="w-full rounded-xl border border-base-700 px-3 py-2.5 text-left text-sm text-fg hover:border-brand-500"
                >
                  <span className="font-mono">{asset.name}</span>{" "}
                  <span className="text-fg-dim">({Math.round(asset.size / 1024)} KB)</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setPhase(null)}
              className="rounded-xl border border-base-700 px-4 py-2.5 text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {phase?.kind === "result" && (
        <Modal title={app.name} onClose={() => setPhase(null)}>
          <p
            role="status"
            className={`text-sm leading-relaxed ${
              !("error" in phase.result) && phase.result.status === "imported_unpublished"
                ? "text-fg"
                : "text-fg-muted"
            }`}
          >
            {resultMessage(phase.result)}
          </p>
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setPhase(null)}
              className="rounded-xl border border-base-700 px-4 py-2.5 text-sm text-fg-muted hover:text-fg"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
