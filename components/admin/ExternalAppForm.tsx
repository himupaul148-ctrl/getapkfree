"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES } from "@/lib/types";
import { hostOf, providerFromUrl } from "@/lib/sources";
import type { FetchedMetadata } from "@/lib/metadata/fetchers";
import ImageField from "@/components/admin/ImageField";
import { changedFields, type OverridableField } from "@/lib/metadata/provenance";

const MAX_SCREENSHOTS = 4;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

type Stage = "idle" | "fetching" | "saving";

/**
 * Two steps on purpose: fetch, then review, then save. Every fetched field
 * stays editable because none of these sources is authoritative — Play omits
 * the version entirely, GitHub has no package name, and a plain page may only
 * offer a title. Saving what a scrape guessed without a human looking is how
 * a catalogue fills up with wrong data.
 */
export default function ExternalAppForm() {
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [fetchedFrom, setFetchedFrom] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ slug: string; name: string } | null>(
    null,
  );

  const [name, setName] = useState("");
  const [packageName, setPackageName] = useState("");
  const [developer, setDeveloper] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [version, setVersion] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [rating, setRating] = useState("");
  const [ratingCount, setRatingCount] = useState("");
  const [shots, setShots] = useState<string[]>(Array(MAX_SCREENSHOTS).fill(""));
  // What the fetcher returned, kept so the save can work out which fields the
  // admin actually changed rather than marking everything manual.
  const [fetched, setFetched] = useState<FetchedMetadata | null>(null);

  const provider = providerFromUrl(url || null);

  async function onFetch() {
    setError(null);
    setSuccess(null);
    setStage("fetching");

    try {
      const res = await fetch("/api/admin/fetch-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not read that page.");

      const m: FetchedMetadata = body.metadata;
      if (m.name) setName(m.name);
      if (m.packageName) setPackageName(m.packageName);
      if (m.developer) setDeveloper(m.developer);
      if (m.description) setDescription(m.description);
      if (m.category) setCategory(m.category);
      if (m.version) setVersion(m.version);
      if (m.iconUrl) setIconUrl(m.iconUrl);
      if (m.rating !== null) setRating(String(m.rating.toFixed(2)));
      if (m.ratingCount !== null) setRatingCount(String(m.ratingCount));

      if (m.screenshots?.length) {
        setShots([
          ...m.screenshots.slice(0, MAX_SCREENSHOTS),
          ...Array(Math.max(0, MAX_SCREENSHOTS - m.screenshots.length)).fill(""),
        ]);
      }

      setFetched(m);
      setUnavailable(m.unavailable);
      setFetchedFrom(m.source);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not read that page.",
      );
    } finally {
      setStage("idle");
    }
  }

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!url.trim() || !name.trim()) {
      setError("A source URL and an app name are both required.");
      return;
    }

    // package_name is NOT NULL and unique. GitHub and plain pages do not have
    // one, so fall back to something stable and obviously synthetic rather
    // than inventing a plausible-looking Android package id.
    const pkg =
      packageName.trim() ||
      `external.${slugify(hostOf(url) ?? "site").replace(/-/g, ".")}.${slugify(name)}`;

    const cleanShots = shots.map((s) => s.trim()).filter(Boolean);

    // Only the fields that differ from what the fetcher returned count as
    // manual. Anything the source never provided and the admin typed in also
    // lands here, which is exactly the case Part 2 is about.
    const manual: OverridableField[] = changedFields(
      {
        name: fetched?.name ?? null,
        description: fetched?.description ?? null,
        icon_url: fetched?.iconUrl ?? null,
        screenshots: fetched?.screenshots ?? [],
        developer_name: fetched?.developer ?? null,
        category: fetched?.category ?? null,
        rating: fetched?.rating ?? null,
        rating_count: fetched?.ratingCount ?? null,
        version_name: fetched?.version ?? null,
      },
      {
        name: name.trim(),
        description: description.trim(),
        icon_url: iconUrl.trim(),
        screenshots: cleanShots,
        developer_name: developer.trim(),
        category,
        rating: rating.trim(),
        rating_count: ratingCount.trim(),
        version_name: version.trim(),
      },
    );

    setStage("saving");
    const supabase = createClient();

    try {
      const base = slugify(name) || slugify(pkg) || "app";
      const { data: clash } = await supabase
        .from("apps")
        .select("id")
        .eq("slug", base)
        .maybeSingle();
      const slug = clash
        ? `${base}-${Date.now().toString(36).slice(-4)}`
        : base;

      const { data: app, error: appError } = await supabase
        .from("apps")
        .insert({
          name: name.trim(),
          slug,
          package_name: pkg,
          category,
          description: description.trim() || null,
          developer_name: developer.trim() || null,
          icon_url: iconUrl.trim() || null,
          rating: rating ? Number(rating) : null,
          rating_count: ratingCount ? Number(ratingCount) : 0,
          screenshots: cleanShots,
          manual_fields: manual,
          source_type: "external",
          external_url: url.trim(),
          hosted_locally: false,
        })
        .select("id, slug")
        .single<{ id: string; slug: string }>();

      if (appError) throw appError;

      // One version row carries the metadata so the detail page, download
      // tracking and profile history all keep working unchanged. file_url is
      // the external link — the button just opens it in a new tab.
      const { error: versionError } = await supabase.from("versions").insert({
        app_id: app.id,
        version_name: version.trim() || "Latest",
        version_code: 1,
        file_url: url.trim(),
        file_size: null,
        min_android_version: null,
        permissions: [],
        scan_status: "external",
        scanned_at: null,
        published: true,
      });
      if (versionError) throw versionError;

      // The catalogue is cached for an hour; drop it so the new listing shows
      // up straight away rather than whenever the window happens to lapse.
      await fetch("/api/admin/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: app.slug }),
      }).catch(() => {
        /* the row is saved either way; a stale list is not worth failing on */
      });

      setSuccess({ slug: app.slug, name: name.trim() });
      setUnavailable([]);
      setFetchedFrom(null);
      setUrl("");
      setName("");
      setPackageName("");
      setDeveloper("");
      setDescription("");
      setVersion("");
      setIconUrl("");
      setRating("");
      setRatingCount("");
      setShots(Array(MAX_SCREENSHOTS).fill(""));
      setFetched(null);
      router.refresh();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not save the app.";
      setError(
        message.includes("apps_package_name_key")
          ? `${pkg} is already in the catalogue.`
          : message,
      );
    } finally {
      setStage("idle");
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-6">
      {/* ---- Step 1: the link ---- */}
      <div className="rounded-2xl border border-base-800 bg-base-900 p-5">
        <label htmlFor="source-url" className="block text-sm font-medium">
          Official source URL
        </label>
        <p className="mt-1 text-xs text-fg-dim">
          Google Play, F-Droid, a GitHub repo, or the developer&rsquo;s own
          page. This is where the download button will send people.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            id="source-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://play.google.com/store/apps/details?id=..."
            className="min-w-0 flex-1 rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
          />
          <button
            type="button"
            onClick={onFetch}
            disabled={!url.trim() || stage !== "idle"}
            className="rounded-xl bg-azure-500 px-5 py-2.5 text-sm font-semibold text-base-950 transition-colors hover:bg-azure-400 disabled:opacity-40"
          >
            {stage === "fetching" ? "Fetching…" : "Fetch details"}
          </button>
        </div>
        {url.trim() && (
          <p className="mt-2 text-xs text-fg-dim">
            Detected source:{" "}
            <span className="text-azure-300">
              {provider === "play"
                ? "Google Play"
                : provider === "fdroid"
                  ? "F-Droid"
                  : provider === "github"
                    ? "GitHub"
                    : "developer site"}
            </span>
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-danger-500/40 bg-danger-500/10 p-4 text-sm text-danger-300">
          {error}
        </p>
      )}

      {success && (
        <p className="rounded-xl border border-brand-500/40 bg-brand-500/10 p-4 text-sm text-brand-300">
          Added {success.name}.{" "}
          <Link href={`/app/${success.slug}`} className="underline">
            View the listing
          </Link>
        </p>
      )}

      {unavailable.length > 0 && (
        <div className="rounded-xl border border-warn-500/40 bg-warn-500/10 p-4 text-sm text-warn-300">
          <p className="font-medium">
            Fetched from {fetchedFrom}. These could not be read automatically:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-warn-300/90">
            {unavailable.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="mt-2 text-warn-300/80">
            Fill anything you need by hand below.
          </p>
        </div>
      )}

      {/* ---- Step 2: review ---- */}
      <div className="grid gap-4 rounded-2xl border border-base-800 bg-base-900 p-5 sm:grid-cols-2">
        <Field label="App name" value={name} onChange={setName} required />
        <Field
          label="Package name"
          value={packageName}
          onChange={setPackageName}
          hint="Left blank, a synthetic id is generated."
        />
        <Field label="Developer" value={developer} onChange={setDeveloper} />
        <div>
          <label className="block text-sm font-medium">Category</label>
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
        <Field
          label="Version"
          value={version}
          onChange={setVersion}
          hint='Shown as "Latest" if empty.'
        />
        <div className="sm:col-span-2">
          <ImageField
            label="Icon"
            value={iconUrl}
            onChange={setIconUrl}
            slug={slugify(name) || "app"}
            kind="icon"
            hint="Auto-fetched where the source has one. Upload or paste to override."
          />
        </div>
        <Field label="Rating" value={rating} onChange={setRating} />
        <Field
          label="Rating count"
          value={ratingCount}
          onChange={setRatingCount}
        />

        <div className="sm:col-span-2">
          <p className="text-sm font-medium">Screenshots</p>
          <p className="mt-1 text-xs text-fg-dim">
            Up to {MAX_SCREENSHOTS}. Play does not expose these, so they are
            usually yours to add.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {shots.map((shot, index) => (
              <ImageField
                key={index}
                label={`Screenshot ${index + 1}`}
                value={shot}
                onChange={(v) =>
                  setShots((cur) => cur.map((s, i) => (i === index ? v : s)))
                }
                slug={slugify(name) || "app"}
                kind="screenshot"
              />
            ))}
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-sm font-medium">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={stage !== "idle" || !name.trim() || !url.trim()}
          className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-bold text-base-950 transition-colors hover:bg-brand-400 disabled:opacity-40"
        >
          {stage === "saving" ? "Saving…" : "Add external app"}
        </button>
        <p className="text-xs text-fg-dim">
          Saved with <code>source_type=external</code>, so nothing is served
          from here.
        </p>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium">
        {label}
        {required && <span className="text-danger-300"> *</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-base-700 bg-base-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
      />
      {hint && <p className="mt-1 text-xs text-fg-dim">{hint}</p>}
    </div>
  );
}
