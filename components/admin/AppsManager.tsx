"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCount, formatDate } from "@/lib/format";
import SourceBadge from "@/components/SourceBadge";
import EditMetadataModal from "@/components/admin/EditMetadataModal";
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
};

export default function AppsManager({ apps }: { apps: ManagedApp[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ManagedApp | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManagedApp | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      needle
        ? apps.filter(
            (app) =>
              app.name.toLowerCase().includes(needle) ||
              app.packageName.toLowerCase().includes(needle) ||
              (app.developer?.toLowerCase().includes(needle) ?? false),
          )
        : apps,
    [apps, needle],
  );

  /** Unpublishing every build is what removes an app from the public site. */
  async function setPublished(app: ManagedApp, published: boolean) {
    setError(null);
    setBusyId(app.id);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("versions")
      .update({ published })
      .eq("app_id", app.id);
    setBusyId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.refresh();
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
                  <tr key={app.id}>
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
                        app={app}
                        busy={busyId === app.id}
                        onEdit={() => setEditing(app)}
                        onToggle={setPublished}
                        onDelete={() => setConfirmDelete(app)}
                      />
                    </td>
                  </tr>
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
                    app={app}
                    busy={busyId === app.id}
                    onEdit={() => setEditing(app)}
                    onToggle={setPublished}
                    onDelete={() => setConfirmDelete(app)}
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
            To take it off the public site without losing anything, use
            Unpublish instead.
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

function Actions({
  app,
  busy,
  onEdit,
  onToggle,
  onDelete,
}: {
  app: ManagedApp;
  busy: boolean;
  onEdit: () => void;
  onToggle: (app: ManagedApp, published: boolean) => void;
  onDelete: () => void;
}) {
  const live = app.publishedCount > 0;
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
        onClick={() => onToggle(app, !live)}
        disabled={busy || app.versionCount === 0}
        className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
      >
        {busy ? "Working…" : live ? "Unpublish" : "Publish"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-lg border border-danger-500/40 px-3 py-1.5 text-xs text-danger-300 transition-colors hover:bg-danger-500/10"
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
