"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES } from "@/lib/types";

const MAX_BYTES = 100 * 1024 * 1024; // matches the bucket's file_size_limit

type Metadata = {
  packageName: string | null;
  versionName: string | null;
  versionCode: number | null;
  minAndroidVersion: string | null;
  label: string | null;
  permissions: string[];
  icon: string | null;
};

type Stage = "idle" | "uploading" | "parsing" | "saving";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function UploadForm() {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ slug: string; name: string } | null>(null);

  // Auto-filled from the APK, all still editable.
  const [name, setName] = useState("");
  const [packageName, setPackageName] = useState("");
  const [versionName, setVersionName] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [minAndroid, setMinAndroid] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [icon, setIcon] = useState<string | null>(null);

  // Entered by hand.
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [developer, setDeveloper] = useState("");
  const [markScanned, setMarkScanned] = useState(false);

  function applyMetadata(meta: Metadata) {
    if (meta.label) setName(meta.label);
    if (meta.packageName) setPackageName(meta.packageName);
    if (meta.versionName) setVersionName(meta.versionName);
    if (meta.versionCode !== null) setVersionCode(String(meta.versionCode));
    if (meta.minAndroidVersion) setMinAndroid(meta.minAndroidVersion);
    if (meta.permissions.length) setPermissions(meta.permissions);
    if (meta.icon) setIcon(meta.icon);
  }

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    setError(null);
    setNotice(null);
    setSuccess(null);
    if (!picked) return;

    if (!picked.name.toLowerCase().endsWith(".apk")) {
      setError("That is not an APK. Pick a file ending in .apk.");
      return;
    }
    if (picked.size > MAX_BYTES) {
      setError(
        `That file is ${(picked.size / 1024 ** 2).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 ** 2} MB.`,
      );
      return;
    }

    setFile(picked);
    const supabase = createClient();

    // Straight from the browser to Supabase Storage: routing it through our own
    // server would hit the platform's request body limit on anything sizeable.
    setStage("uploading");
    const path = `builds/${crypto.randomUUID()}.apk`;
    const { error: uploadError } = await supabase.storage
      .from("apks")
      .upload(path, picked, {
        contentType: "application/vnd.android.package-archive",
        upsert: false,
      });

    if (uploadError) {
      setStage("idle");
      setError(`Upload failed: ${uploadError.message}`);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("apks").getPublicUrl(path);
    setStoragePath(path);
    setFileUrl(publicUrl);

    setStage("parsing");
    try {
      const response = await fetch("/api/admin/parse-apk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // publicUrl, not the state value — setState has not applied yet.
        body: JSON.stringify({ fileUrl: publicUrl }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Parse failed.");
      applyMetadata(payload.metadata as Metadata);
      setNotice("Metadata read from the APK. Check it before publishing.");
    } catch (caught) {
      setNotice(
        `The file uploaded, but its metadata could not be read (${
          caught instanceof Error ? caught.message : "unknown error"
        }). Fill the fields in by hand.`,
      );
    } finally {
      setStage("idle");
    }
  }

  async function save(publish: boolean) {
    setError(null);
    if (!fileUrl || !file) {
      setError("Pick an APK first.");
      return;
    }
    if (!name.trim() || !packageName.trim() || !versionName.trim()) {
      setError("Name, package name and version are all required.");
      return;
    }
    const code = Number(versionCode);
    if (!Number.isFinite(code) || code <= 0) {
      setError("Version code must be a positive whole number.");
      return;
    }
    if (publish && !markScanned) {
      setError(
        "A build can only be published once it is marked scanned and safe.",
      );
      return;
    }

    setStage("saving");
    const supabase = createClient();

    try {
      // Reuse the app row if this package is already in the catalogue, so a new
      // build lands as another version rather than a duplicate listing.
      const { data: existing } = await supabase
        .from("apps")
        .select("id, slug")
        .eq("package_name", packageName.trim())
        .maybeSingle<{ id: string; slug: string }>();

      let appId = existing?.id;
      let slug = existing?.slug;

      if (!appId) {
        const base = slugify(name) || slugify(packageName) || "app";
        // Slug is unique; fall back to a suffixed one rather than failing.
        const { data: clash } = await supabase
          .from("apps")
          .select("id")
          .eq("slug", base)
          .maybeSingle();
        slug = clash ? `${base}-${Date.now().toString(36).slice(-4)}` : base;

        const { data: created, error: appError } = await supabase
          .from("apps")
          .insert({
            name: name.trim(),
            slug,
            package_name: packageName.trim(),
            category,
            description: description.trim() || null,
            developer_name: developer.trim() || null,
            icon_url: icon,
          })
          .select("id, slug")
          .single<{ id: string; slug: string }>();

        if (appError) throw appError;
        appId = created.id;
        slug = created.slug;
      } else {
        // Refresh the editable details on an existing listing.
        const { error: updateError } = await supabase
          .from("apps")
          .update({
            category,
            description: description.trim() || null,
            developer_name: developer.trim() || null,
            ...(icon ? { icon_url: icon } : {}),
          })
          .eq("id", appId);
        if (updateError) throw updateError;
      }

      const { error: versionError } = await supabase.from("versions").insert({
        app_id: appId,
        version_name: versionName.trim(),
        version_code: code,
        file_url: fileUrl,
        file_size: file.size,
        min_android_version: minAndroid.trim() || null,
        permissions,
        scan_status: markScanned ? "clean" : "pending",
        scanned_at: markScanned ? new Date().toISOString() : null,
        published: publish,
      });

      if (versionError) throw versionError;

      setSuccess({ slug: slug!, name: name.trim() });
      setNotice(null);
      router.refresh();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not save the build.";
      setError(
        message.includes("versions_app_id_version_code_key")
          ? `Version code ${code} already exists for this app. Bump it and try again.`
          : message,
      );
    } finally {
      setStage("idle");
    }
  }

  async function discardUpload() {
    if (storagePath) {
      const supabase = createClient();
      await supabase.storage.from("apks").remove([storagePath]);
    }
    setFile(null);
    setStoragePath(null);
    setFileUrl(null);
    setName("");
    setPackageName("");
    setVersionName("");
    setVersionCode("");
    setMinAndroid("");
    setPermissions([]);
    setIcon(null);
    setDescription("");
    setDeveloper("");
    setMarkScanned(false);
    setSuccess(null);
    setNotice(null);
    setError(null);
  }

  const busy = stage !== "idle";

  if (success) {
    return (
      <div className="rounded-2xl border border-brand-500/30 bg-brand-500/5 p-6">
        <h2 className="text-lg font-semibold text-brand-300">
          {success.name} saved
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          The build is in the catalogue. Published builds appear on the public
          site immediately; drafts stay hidden until you publish them.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/app/${success.slug}`}
            className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-base-950 hover:bg-brand-400"
          >
            View app page
          </Link>
          <button
            type="button"
            onClick={discardUpload}
            className="rounded-xl border border-base-700 px-4 py-2.5 text-sm text-fg-muted hover:text-fg"
          >
            Upload another
          </button>
          <Link
            href="/admin/apps"
            className="rounded-xl border border-base-700 px-4 py-2.5 text-sm text-fg-muted hover:text-fg"
          >
            Manage apps
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-base-700 bg-base-850 px-4 py-3 text-sm text-fg-muted">
          {notice}
        </p>
      )}

      {/* ---- File ---- */}
      <section className="rounded-2xl border border-base-800 bg-base-900 p-6">
        <h2 className="font-semibold text-fg">APK file</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Uploads straight to storage, then its manifest is read for the fields
          below. Maximum {MAX_BYTES / 1024 ** 2} MB.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <input
            id="apk"
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            onChange={onPickFile}
            disabled={busy}
            className="block w-full text-sm text-fg-muted file:mr-4 file:rounded-xl file:border-0 file:bg-brand-500 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-base-950 hover:file:bg-brand-400 disabled:opacity-60"
          />
        </div>

        {stage === "uploading" && (
          <p className="mt-3 text-sm text-azure-400">Uploading…</p>
        )}
        {stage === "parsing" && (
          <p className="mt-3 text-sm text-azure-400">Reading the manifest…</p>
        )}
        {file && !busy && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-fg">{file.name}</span>
            <span className="text-fg-dim">
              {(file.size / 1024 ** 2).toFixed(1)} MB
            </span>
            <button
              type="button"
              onClick={discardUpload}
              className="text-brand-400 hover:underline"
            >
              Remove
            </button>
          </div>
        )}
      </section>

      {/* ---- Read from the APK ---- */}
      <section className="rounded-2xl border border-base-800 bg-base-900 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-fg">From the manifest</h2>
            <p className="mt-1 text-sm text-fg-muted">
              Auto-filled where possible. Everything stays editable.
            </p>
          </div>
          {icon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={icon}
              alt=""
              width={56}
              height={56}
              className="shrink-0 rounded-xl border border-base-700"
            />
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="App name" value={name} onChange={setName} required />
          <Field
            label="Package name"
            value={packageName}
            onChange={setPackageName}
            mono
            required
          />
          <Field
            label="Version name"
            value={versionName}
            onChange={setVersionName}
            placeholder="1.2.3"
            required
          />
          <Field
            label="Version code"
            value={versionCode}
            onChange={setVersionCode}
            placeholder="10203"
            required
          />
          <Field
            label="Minimum Android"
            value={minAndroid}
            onChange={setMinAndroid}
            placeholder="9.0"
          />
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-fg-dim">
            Permissions ({permissions.length})
          </p>
          {permissions.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">
              None found. They are stored per build, so this can stay empty.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {permissions.map((permission) => (
                <li
                  key={permission}
                  className="rounded-full border border-base-700 px-2 py-0.5 font-mono text-[11px] text-fg-muted"
                >
                  {permission.split(".").pop()}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---- Entered by hand ---- */}
      <section className="rounded-2xl border border-base-800 bg-base-900 p-6">
        <h2 className="font-semibold text-fg">Listing details</h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="category"
              className="mb-1.5 block text-xs font-medium text-fg-dim"
            >
              Category
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-base-700 bg-base-850 px-3.5 py-2.5 text-sm text-fg focus:border-brand-500 focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} className="bg-base-850">
                  {c}
                </option>
              ))}
            </select>
          </div>
          <Field label="Developer name" value={developer} onChange={setDeveloper} />
        </div>

        <div className="mt-4">
          <label
            htmlFor="description"
            className="mb-1.5 block text-xs font-medium text-fg-dim"
          >
            Description
          </label>
          <textarea
            id="description"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the app does, in a sentence or two."
            className="w-full rounded-xl border border-base-700 bg-base-850 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-dim focus:border-brand-500 focus:outline-none"
          />
        </div>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-base-700 bg-base-850 p-4">
          <input
            type="checkbox"
            checked={markScanned}
            onChange={(e) => setMarkScanned(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span className="text-sm">
            <span className="font-medium text-fg">Mark as scanned &amp; safe</span>
            <span className="mt-0.5 block text-fg-muted">
              Sets the build to <code className="font-mono">clean</code> and
              stamps the scan date. Required before publishing — a draft can be
              saved without it.
            </span>
          </span>
        </label>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => save(true)}
          disabled={busy || !fileUrl}
          className="rounded-xl bg-brand-500 px-6 py-3 font-semibold text-base-950 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {stage === "saving" ? "Saving…" : "Publish"}
        </button>
        <button
          type="button"
          onClick={() => save(false)}
          disabled={busy || !fileUrl}
          className="rounded-xl border border-base-700 px-6 py-3 text-fg-muted transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save as draft
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-fg-dim">
        {label}
        {required && <span className="ml-1 text-brand-400">*</span>}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl border border-base-700 bg-base-850 px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-dim focus:border-brand-500 focus:outline-none ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
