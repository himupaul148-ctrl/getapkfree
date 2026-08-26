"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES } from "@/lib/types";
import ImageField from "@/components/admin/ImageField";
import {
  FIELD_LABELS,
  changedFields,
  clearManual,
  isManual,
  markManual,
  type OverridableField,
} from "@/lib/metadata/provenance";

export type EditableApp = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  description: string | null;
  developer: string | null;
  iconUrl: string | null;
  screenshots: string[];
  rating: number | null;
  ratingCount: number;
  manualFields: string[];
  sourceType: string;
  externalUrl: string | null;
  latestVersionId: string | null;
  latestVersionName: string | null;
};

const MAX_SCREENSHOTS = 4;

/**
 * Edits one listing's metadata and records which fields a human set.
 *
 * The provenance chip beside each field is the point of the screen: a scraped
 * catalogue is full of values nobody has checked, and an admin needs to see at
 * a glance which ones are theirs. Saving marks changed fields manual, and a
 * later auto-fetch skips anything on that list.
 */
export default function EditMetadataModal({
  app,
  onClose,
  onSaved,
}: {
  app: EditableApp;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description ?? "");
  const [developer, setDeveloper] = useState(app.developer ?? "");
  const [category, setCategory] = useState(app.category ?? CATEGORIES[0]);
  const [iconUrl, setIconUrl] = useState(app.iconUrl ?? "");
  const [rating, setRating] = useState(app.rating != null ? String(app.rating) : "");
  const [ratingCount, setRatingCount] = useState(String(app.ratingCount ?? 0));
  const [versionName, setVersionName] = useState(app.latestVersionName ?? "");
  const [shots, setShots] = useState<string[]>(() => {
    const existing = (app.screenshots ?? []).slice(0, MAX_SCREENSHOTS);
    return [...existing, ...Array(MAX_SCREENSHOTS - existing.length).fill("")];
  });

  const [saving, setSaving] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("An app name is required.");
      return;
    }

    const cleanShots = shots.map((s) => s.trim()).filter(Boolean);

    const before: Partial<Record<OverridableField, unknown>> = {
      name: app.name,
      description: app.description,
      icon_url: app.iconUrl,
      screenshots: app.screenshots ?? [],
      developer_name: app.developer,
      category: app.category,
      rating: app.rating,
      rating_count: app.ratingCount,
      version_name: app.latestVersionName,
    };
    const after: Partial<Record<OverridableField, unknown>> = {
      name: name.trim(),
      description: description.trim(),
      icon_url: iconUrl.trim(),
      screenshots: cleanShots,
      developer_name: developer.trim(),
      category,
      rating: rating.trim(),
      rating_count: ratingCount.trim(),
      version_name: versionName.trim(),
    };

    const touched = changedFields(before, after);

    setSaving(true);
    try {
      const supabase = createClient();

      const { error: appError } = await supabase
        .from("apps")
        .update({
          name: name.trim(),
          description: description.trim() || null,
          developer_name: developer.trim() || null,
          category,
          icon_url: iconUrl.trim() || null,
          screenshots: cleanShots,
          rating: rating.trim() ? Number(rating) : null,
          rating_count: ratingCount.trim() ? Number(ratingCount) : 0,
          manual_fields: markManual(app.manualFields, touched),
        })
        .eq("id", app.id);
      if (appError) throw appError;

      // The version number lives on `versions`, not `apps`, so it needs its
      // own write when the admin has changed it.
      if (
        app.latestVersionId &&
        versionName.trim() &&
        versionName.trim() !== app.latestVersionName
      ) {
        const { error: versionError } = await supabase
          .from("versions")
          .update({ version_name: versionName.trim() })
          .eq("id", app.latestVersionId);
        if (versionError) throw versionError;
      }

      await fetch("/api/admin/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: app.slug }),
      }).catch(() => {
        /* the row is saved either way */
      });

      onSaved();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save changes.",
      );
    } finally {
      setSaving(false);
    }
  }

  /**
   * Pulls the source page again and applies it ONLY to fields nobody has
   * overridden. This is what makes a manual edit permanent — without the
   * guard a re-fetch would quietly undo the admin's work.
   */
  async function refetch() {
    if (!app.externalUrl) return;
    setError(null);
    setNotice(null);
    setRefetching(true);
    try {
      const res = await fetch("/api/admin/fetch-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: app.externalUrl }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not re-read that page.");

      const fresh = body.metadata;
      const skipped: string[] = [];
      const apply = (
        field: OverridableField,
        incoming: unknown,
        setter: (v: string) => void,
      ) => {
        if (incoming === null || incoming === undefined || incoming === "") {
          return;
        }
        if (isManual(app.manualFields, field)) {
          skipped.push(FIELD_LABELS[field]);
          return;
        }
        setter(String(incoming));
      };

      apply("name", fresh.name, setName);
      apply("description", fresh.description, setDescription);
      apply("icon_url", fresh.iconUrl, setIconUrl);
      apply("developer_name", fresh.developer, setDeveloper);
      apply("category", fresh.category, setCategory);
      apply("rating", fresh.rating, setRating);
      apply("rating_count", fresh.ratingCount, setRatingCount);
      apply("version_name", fresh.version, setVersionName);

      setNotice(
        skipped.length
          ? `Refreshed from source. Kept your custom ${skipped.join(", ")}.`
          : "Refreshed from source. Review, then save.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not re-read that page.",
      );
    } finally {
      setRefetching(false);
    }
  }

  async function revertField(field: OverridableField) {
    const supabase = createClient();
    await supabase
      .from("apps")
      .update({ manual_fields: clearManual(app.manualFields, [field]) })
      .eq("id", app.id);
    onSaved();
  }

  function setShot(index: number, url: string) {
    setShots((current) => current.map((s, i) => (i === index ? url : s)));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit metadata for ${app.name}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-3xl rounded-2xl border border-base-700 bg-base-900 p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold tracking-tight">Edit metadata</h3>
            <p className="mt-1 text-sm text-fg-muted">
              {app.name} · {app.sourceType === "external" ? "external listing" : "F-Droid build"}
            </p>
          </div>
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

        <p className="mt-4 rounded-xl border border-base-800 bg-base-950 p-3 text-xs leading-relaxed text-fg-dim">
          Fields marked <Chip manual /> were set by hand and are never
          overwritten by a re-fetch. <Chip /> means the value came from the
          source page.
        </p>

        {error && (
          <p className="mt-4 rounded-xl border border-danger-500/40 bg-danger-500/10 p-3 text-sm text-danger-300">
            {error}
          </p>
        )}

        {notice && (
          <p className="mt-4 rounded-xl border border-azure-500/40 bg-azure-500/10 p-3 text-sm text-azure-300">
            {notice}
          </p>
        )}

        {app.sourceType === "external" && app.externalUrl && (
          <button
            type="button"
            onClick={refetch}
            disabled={refetching}
            className="mt-4 rounded-xl border border-azure-500/40 px-4 py-2 text-xs font-medium text-azure-300 transition-colors hover:bg-azure-500/10 disabled:opacity-40"
          >
            {refetching ? "Re-reading source…" : "Re-fetch from source"}
          </button>
        )}

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Text
            field="name"
            app={app}
            value={name}
            onChange={setName}
            onRevert={revertField}
          />
          <Text
            field="developer_name"
            app={app}
            value={developer}
            onChange={setDeveloper}
            onRevert={revertField}
          />

          <div>
            <FieldLabel field="category" app={app} onRevert={revertField} />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <Text
            field="version_name"
            app={app}
            value={versionName}
            onChange={setVersionName}
            onRevert={revertField}
            disabled={!app.latestVersionId}
            hint={app.latestVersionId ? undefined : "This app has no version row yet."}
          />
          <Text
            field="rating"
            app={app}
            value={rating}
            onChange={setRating}
            onRevert={revertField}
          />
          <Text
            field="rating_count"
            app={app}
            value={ratingCount}
            onChange={setRatingCount}
            onRevert={revertField}
          />

          <div className="sm:col-span-2">
            <FieldLabel field="description" app={app} onRevert={revertField} />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </div>

          <div className="sm:col-span-2">
            <FieldLabel field="icon_url" app={app} onRevert={revertField} />
            <div className="mt-2">
              <ImageField
                label=""
                value={iconUrl}
                onChange={setIconUrl}
                slug={app.slug}
                kind="icon"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <FieldLabel field="screenshots" app={app} onRevert={revertField} />
            <p className="mt-1 text-xs text-fg-dim">
              Up to {MAX_SCREENSHOTS}. Blank slots are dropped on save.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {shots.map((shot, index) => (
                <ImageField
                  key={index}
                  label={`Screenshot ${index + 1}`}
                  value={shot}
                  onChange={(url) => setShot(index, url)}
                  slug={app.slug}
                  kind="screenshot"
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-base-950 transition-colors hover:bg-brand-400 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-base-700 px-5 py-2.5 text-sm text-fg-muted hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Chip({ manual }: { manual?: boolean }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
        manual
          ? "bg-brand-500/15 text-brand-300"
          : "bg-base-800 text-fg-dim"
      }`}
    >
      {manual ? "custom" : "auto-fetched"}
    </span>
  );
}

function FieldLabel({
  field,
  app,
  onRevert,
}: {
  field: OverridableField;
  app: EditableApp;
  onRevert: (field: OverridableField) => void;
}) {
  const manual = isManual(app.manualFields, field);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm font-medium">{FIELD_LABELS[field]}</label>
      <Chip manual={manual} />
      {manual && (
        <button
          type="button"
          onClick={() => onRevert(field)}
          className="text-[10px] text-fg-dim underline hover:text-fg-muted"
        >
          mark auto
        </button>
      )}
    </div>
  );
}

function Text({
  field,
  app,
  value,
  onChange,
  onRevert,
  disabled,
  hint,
}: {
  field: OverridableField;
  app: EditableApp;
  value: string;
  onChange: (v: string) => void;
  onRevert: (field: OverridableField) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <FieldLabel field={field} app={app} onRevert={onRevert} />
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 disabled:opacity-40"
      />
      {hint && <p className="mt-1 text-xs text-fg-dim">{hint}</p>}
    </div>
  );
}
