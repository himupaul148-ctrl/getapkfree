"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCount, formatDate } from "@/lib/format";
import SourceBadge from "@/components/SourceBadge";
import ScanBadge from "@/components/ScanBadge";
import EditMetadataModal from "@/components/admin/EditMetadataModal";
import {
  canPublishVersion,
  setVersionPublished,
  type ManagedVersion,
} from "@/lib/admin/version-publish";
import type { SourceType } from "@/lib/sources";

export type ManagedApp = {
  id: string;
  name: string;
  slug: string;
  packageName: string;
  category: string | null;
  description: string | null;
  developer: string | null;
  createdAt: string;
  downloadCount: number;
  versionCount: number;
  publishedCount: number;
  sourceType: SourceType;
  externalUrl: string | null;
  iconUrl: string | null;
  screenshots: string[];
  rating: number | null;
  ratingCount: number;
  manualFields: string[];
  latestVersionId: string | null;
  latestVersionName: string | null;
  /** Every build, newest first — publish/unpublish now targets one of these, never the app as a whole. */
  versions: ManagedVersion[];
};

type ConfirmVersionAction = {
  app: ManagedApp;
  version: ManagedVersion;
  nextPublished: boolean;
};

export default function AppsManager({ apps }: { apps: ManagedApp[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  /*
   * There was no publish filter here at all. The admin bar links to
   * ?status=unpublished, so one had to exist for that chip to mean anything.
   * "unpublished" is an app with no live build — which is what the dashboard
   * already calls a withheld build.
   */
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"all" | "unpublished">(
    searchParams.get("status") === "unpublished" ? "unpublished" : "all",
  );
  const [editing, setEditing] = useState<ManagedApp | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManagedApp | null>(null);
  const [confirmVersion, setConfirmVersion] = useState<ConfirmVersionAction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      apps.filter((app) => {
        // An app with no live build is what the dashboard calls withheld.
        if (status === "unpublished" && app.publishedCount > 0) return false;
        if (!needle) return true;
        return (
          app.name.toLowerCase().includes(needle) ||
          app.packageName.toLowerCase().includes(needle) ||
          (app.developer?.toLowerCase().includes(needle) ?? false)
        );
      }),
    [apps, needle, status],
  );

  /**
   * The catalogue is cached for an hour and the detail page is ISR, so a
   * publish, unpublish or delete is invisible to visitors until both are
   * dropped — a deleted app would otherwise keep serving a 200 from the edge.
   * Never allowed to fail the action: the write has already landed.
   */
  async function revalidate(slug: string) {
    await fetch("/api/admin/revalidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    }).catch(() => {
      /* a stale list is not worth failing a completed write on */
    });
  }

  /**
   * Publishes or unpublishes exactly the one build the admin picked —
   * `setVersionPublished` filters by that version's own id, never by
   * app_id, so a sibling build (a still-pending import sitting next to an
   * already-published one, say) is never touched.
   */
  async function applyVersionPublish(action: ConfirmVersionAction) {
    setError(null);
    setBusyVersionId(action.version.id);
    try {
      const supabase = createClient();
      await setVersionPublished(supabase, action.version.id, action.nextPublished);
      await revalidate(action.app.slug);
      setConfirmVersion(null);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update that build.",
      );
    } finally {
      setBusyVersionId(null);
    }
  }

  /**
   * Re-checks one pending/failed build's scan status via the admin verify
   * endpoint (a VirusTotal hash lookup of the stored file). This only ever
   * updates that build's scan_status/scanned_at server-side — it never
   * publishes anything itself. A build that comes back "clean" becomes
   * *eligible* for the existing Publish button (canPublishVersion, below,
   * is unchanged), which still requires a separate, deliberate click.
   *
   * No cache to drop here: verify never changes `published`, and an
   * unpublished build's scan status is never rendered on the public site
   * (getPublishedVersions only ever returns published builds) — so nothing
   * revalidate() would invalidate has actually changed for a visitor.
   */
  async function verifyVersion(version: ManagedVersion) {
    setError(null);
    setBusyVersionId(version.id);
    try {
      const res = await fetch(`/api/admin/versions/${version.id}/verify`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body && typeof body.error === "string" && body.error) ||
            "Could not verify that build.",
        );
      }
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not verify that build.",
      );
    } finally {
      setBusyVersionId(null);
    }
  }

  async function remove(app: ManagedApp) {
    setError(null);
    setBusyId(app.id);
    const supabase = createClient();
    // versions, downloads and favourites all cascade from the app row.
    const { error: deleteError } = await supabase
      .from("apps")
      .delete()
      .eq("id", app.id);
    setBusyId(null);
    setConfirmDelete(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await revalidate(app.slug);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      <div className="relative max-w-md">
        <label htmlFor="admin-search" className="sr-only">
          Filter apps
        </label>
        <input
          id="admin-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, package or developer…"
          className="w-full rounded-xl border border-base-700 bg-base-850 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-dim focus:border-brand-500 focus:outline-none"
        />

          {/* Visible control for the same filter the admin bar links to, so
              arriving via ?status=unpublished is explicable rather than
              looking like half the catalogue vanished. */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              aria-label="Filter by publish status"
              className="rounded-xl border border-base-700 bg-base-850 px-3.5 py-2 text-sm text-fg focus:border-brand-500 focus:outline-none"
            >
              <option value="all">All apps</option>
              <option value="unpublished">Unpublished only</option>
            </select>
            <span className="text-xs text-fg-dim">
              Showing {rows.length} of {apps.length}
            </span>
          </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-base-800 bg-base-900 p-8 text-center text-fg-muted">
          No apps match that filter.
        </p>
      ) : (
        <>
          {/* Table on desktop, stacked cards on mobile. */}
          <div className="hidden overflow-x-auto rounded-2xl border border-base-800 md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-base-850 text-xs text-fg-dim">
                <tr>
                  <Th>App</Th>
                  <Th>Source</Th>
                  <Th>Category</Th>
                  <Th>Versions</Th>
                  <Th>Downloads</Th>
                  <Th>Created</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-800 bg-base-900">
                {rows.map((app) => (
                  <Fragment key={app.id}>
                    <tr>
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/${app.slug}`}
                          className="font-medium text-fg hover:text-brand-400"
                        >
                          {app.name}
                        </Link>
                        <p className="font-mono text-xs text-fg-dim">
                          {app.packageName}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <SourceBadge
                          sourceType={app.sourceType}
                          externalUrl={app.externalUrl}
                        />
                      </td>
                      <td className="px-4 py-3 text-fg-muted">{app.category}</td>
                      <td className="px-4 py-3 text-fg-muted">
                        {app.versionCount}
                        <span className="text-fg-dim">
                          {" "}
                          ({app.publishedCount} live)
                        </span>
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {formatCount(app.downloadCount)}
                      </td>
                      <td className="px-4 py-3 text-fg-muted">
                        {formatDate(app.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Actions
                          busy={busyId === app.id}
                          onEdit={() => setEditing(app)}
                          onDelete={() => setConfirmDelete(app)}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={7} className="border-t border-base-800/60 bg-base-950/40 px-4 py-3">
                        <VersionList
                          app={app}
                          busyVersionId={busyVersionId}
                          onRequestToggle={(version, nextPublished) =>
                            setConfirmVersion({ app, version, nextPublished })
                          }
                          onVerify={verifyVersion}
                        />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden">
            {rows.map((app) => (
              <li
                key={app.id}
                className="rounded-2xl border border-base-800 bg-base-900 p-4"
              >
                <Link
                  href={`/app/${app.slug}`}
                  className="font-medium text-fg hover:text-brand-400"
                >
                  {app.name}
                </Link>
                <p className="font-mono text-xs break-all text-fg-dim">
                  {app.packageName}
                </p>
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                  <div className="mb-1">
                    <SourceBadge
                      sourceType={app.sourceType}
                      externalUrl={app.externalUrl}
                    />
                  </div>
                  <div>{app.category}</div>
                  <div>
                    {app.versionCount} version{app.versionCount === 1 ? "" : "s"} (
                    {app.publishedCount} live)
                  </div>
                  <div>{formatCount(app.downloadCount)} downloads</div>
                  <div>{formatDate(app.createdAt)}</div>
                </dl>
                <div className="mt-3">
                  <Actions
                    busy={busyId === app.id}
                    onEdit={() => setEditing(app)}
                    onDelete={() => setConfirmDelete(app)}
                  />
                </div>
                <div className="mt-3 border-t border-base-800 pt-3">
                  <VersionList
                    app={app}
                    busyVersionId={busyVersionId}
                    onRequestToggle={(version, nextPublished) =>
                      setConfirmVersion({ app, version, nextPublished })
                    }
                    onVerify={verifyVersion}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <EditMetadataModal
          app={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {confirmVersion && (
        <Modal
          title={`${confirmVersion.nextPublished ? "Publish" : "Unpublish"} version ${confirmVersion.version.versionName} (${confirmVersion.version.versionCode})?`}
          onClose={() => setConfirmVersion(null)}
        >
          <p className="text-sm leading-relaxed text-fg-muted">
            {confirmVersion.nextPublished ? (
              <>
                This makes only <strong>this build</strong> of {confirmVersion.app.name}{" "}
                downloadable from the public site. Other builds of this app are not
                affected.
              </>
            ) : (
              <>
                This removes only <strong>this build</strong> ({confirmVersion.version.versionName}) of{" "}
                {confirmVersion.app.name} from the public site. Other builds of this
                app are not affected.
              </>
            )}
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => void applyVersionPublish(confirmVersion)}
              disabled={busyVersionId === confirmVersion.version.id}
              className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-base-950 hover:bg-brand-400 disabled:opacity-60"
            >
              {busyVersionId === confirmVersion.version.id
                ? "Working…"
                : confirmVersion.nextPublished
                  ? "Publish this build"
                  : "Unpublish this build"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmVersion(null)}
              className="rounded-xl border border-base-700 px-4 py-2.5 text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title={`Delete ${confirmDelete.name}?`}
          onClose={() => setConfirmDelete(null)}
        >
          <p className="text-sm leading-relaxed text-fg-muted">
            This removes the app and all {confirmDelete.versionCount} of its
            builds, along with any favourites pointing at it. Download history
            rows are kept but detached. This cannot be undone.
          </p>
          <p className="mt-3 text-sm text-fg-dim">
            To take a specific build off the public site without losing
            anything, use that build&rsquo;s Unpublish button instead.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => remove(confirmDelete)}
              disabled={busyId === confirmDelete.id}
              className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-base-950 hover:bg-rose-400 disabled:opacity-60"
            >
              {busyId === confirmDelete.id ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="rounded-xl border border-base-700 px-4 py-2.5 text-sm text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * One line per build: version, scan status, published state, and the one
 * action that actually applies to it. This is the replacement for the old
 * app-wide Publish/Unpublish toggle — every action here is scoped to a
 * single version id.
 */
function VersionList({
  app,
  busyVersionId,
  onRequestToggle,
  onVerify,
}: {
  app: ManagedApp;
  busyVersionId: string | null;
  onRequestToggle: (version: ManagedVersion, nextPublished: boolean) => void;
  onVerify: (version: ManagedVersion) => void;
}) {
  if (app.versions.length === 0) {
    return <p className="text-xs text-fg-dim">No builds uploaded yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {app.versions.map((version) => {
        const eligible = canPublishVersion(version.scanStatus);
        const busy = busyVersionId === version.id;
        // Verify only ever applies to a build with no usable verdict yet —
        // "clean"/"external" are already eligible to publish, and "flagged"
        // is a terminal result this phase does not attempt to re-open.
        const verifiable =
          version.scanStatus === "pending" || version.scanStatus === "failed";
        return (
          <li
            key={version.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs"
          >
            <span className="font-mono font-medium text-fg">
              v{version.versionName}
            </span>
            <span className="text-fg-dim">build {version.versionCode}</span>
            <ScanBadge status={version.scanStatus} scannedAt={version.scannedAt} showDate={false} />
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                version.published
                  ? "bg-brand-500/10 text-brand-300"
                  : "bg-base-800 text-fg-dim"
              }`}
            >
              {version.published ? "Published" : "Draft"}
            </span>
            <span className="ml-auto flex gap-2">
              {verifiable && (
                <button
                  type="button"
                  disabled={busy}
                  title="Check this build's file hash against VirusTotal. Only updates its scan status — publishing is a separate step."
                  onClick={() => onVerify(version)}
                  className="rounded-lg border border-base-700 px-3 py-1 text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Working…" : "Verify"}
                </button>
              )}
              <button
                type="button"
                disabled={busy || (!version.published && !eligible)}
                title={
                  !version.published && !eligible
                    ? "This build cannot be published until it is verified."
                    : undefined
                }
                onClick={() => onRequestToggle(version, !version.published)}
                className="rounded-lg border border-base-700 px-3 py-1 text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Working…" : version.published ? "Unpublish" : "Publish"}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Actions({
  busy,
  onEdit,
  onDelete,
}: {
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={onEdit}
        className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
      >
        Edit metadata
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="rounded-lg border border-danger-500/40 px-3 py-1.5 text-xs text-danger-300 transition-colors hover:bg-danger-500/10 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-base-700 bg-base-900 p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-base-700 p-2 text-fg-muted hover:text-fg"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th scope="col" className={`px-4 py-3 font-medium ${className}`}>
      {children}
    </th>
  );
}
