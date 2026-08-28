"use client";

import { useRef, useState } from "react";

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif";

type Result = {
  url: string;
  thumbUrl: string;
  full: { width: number; height: number; bytes: number };
  thumb: { width: number; height: number; bytes: number };
  originalBytes: number;
  replaced: number;
};

function kb(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.round(bytes / 1024)}KB`;
}

/**
 * Featured image for a blog post.
 *
 * Uploads go to /api/admin/blog/image, which does the resizing and writes to
 * storage with the service role key. The browser never sees a Supabase
 * credential or the CI bearer token — the admin session cookie is the whole
 * authorisation story here, which is why this component sends no headers of
 * its own.
 *
 * XMLHttpRequest rather than fetch: fetch still cannot report upload progress,
 * and a cover photo on a slow connection is exactly where a progress bar earns
 * its place.
 */
export default function FeaturedImageUploader({
  slug,
  value,
  onChange,
}: {
  slug: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const busy = progress !== null || deleting;

  function validate(file: File): string | null {
    if (/\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type)) {
      return (
        "HEIC photos cannot be processed here — the image library ships " +
        "without Apple's HEVC decoder. Export as JPEG first (iPhone: " +
        "Settings → Camera → Formats → Most Compatible)."
      );
    }
    if (!ACCEPT.split(",").includes(file.type)) {
      return `${file.type || "That file"} is not a supported image. Use JPEG, PNG, WebP, GIF or AVIF.`;
    }
    if (file.size > MAX_BYTES) {
      return `That file is ${kb(file.size)}. The limit is 4MB — larger uploads are rejected by the host before they reach the server.`;
    }
    return null;
  }

  function upload(file: File) {
    setError(null);
    setResult(null);

    if (!slug) {
      setError("Give the post a title or slug first — images are filed under it.");
      return;
    }

    const problem = validate(file);
    if (problem) {
      setError(problem);
      return;
    }

    const body = new FormData();
    body.append("file", file);
    body.append("slug", slug);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/blog/image");
    // No Authorization header on purpose: the session cookie carries this,
    // and putting the shared token in client code would expose it.
    xhr.withCredentials = true;

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      setProgress(null);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        setError(`Upload failed (HTTP ${xhr.status}).`);
        return;
      }
      if (xhr.status >= 400) {
        setError(String(payload.error ?? `Upload failed (HTTP ${xhr.status}).`));
        return;
      }
      setResult(payload as unknown as Result);
      onChange(String(payload.url));
    });

    xhr.addEventListener("error", () => {
      setProgress(null);
      setError("Upload failed — the network dropped or the server is unreachable.");
    });

    setProgress(0);
    xhr.send(body);
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/blog/image?slug=${encodeURIComponent(slug)}`,
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onChange("");
      setResult(null);
      setConfirmDelete(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete the image.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-medium">Featured image</p>
      <p className="mt-1 text-xs text-fg-dim">
        Resized to 1200×630 WebP for the OG card, cropped toward the subject.
        EXIF is stripped. JPEG, PNG, WebP, GIF or AVIF, up to 4MB.
      </p>

      {/* ---- Current image ---- */}
      {value && (
        <div className="mt-3 overflow-hidden rounded-xl border border-base-700 bg-base-950">
          {/* A plain img: the URL is a Supabase public object, and next/image
              would need the host allowlisted for what is an admin-only preview. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className="aspect-[1200/630] w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.opacity = "0.2";
            }}
          />
        </div>
      )}

      {/* ---- Drop zone ---- */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        className={`mt-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging
            ? "border-brand-500 bg-brand-500/5"
            : "border-base-700 bg-base-950"
        } ${busy ? "opacity-60" : ""}`}
      >
        {progress !== null ? (
          <div>
            <p className="text-sm text-fg-muted">
              {progress < 100 ? `Uploading… ${progress}%` : "Processing image…"}
            </p>
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-base-800"
            >
              <div
                className="h-full rounded-full bg-brand-500 transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              Drop an image here, or{" "}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-brand-400 underline hover:no-underline"
              >
                choose a file
              </button>
              .
            </p>
            {value && (
              <p className="mt-1 text-xs text-fg-dim">
                Uploading a new one replaces the current image.
              </p>
            )}
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />

      {error && (
        <p className="mt-3 rounded-xl border border-danger-500/40 bg-danger-500/10 p-3 text-sm text-danger-300">
          {error}
        </p>
      )}

      {/* ---- What the processing produced ---- */}
      {result && (
        <div className="mt-3 rounded-xl border border-brand-500/40 bg-brand-500/10 p-3 text-sm text-brand-300">
          <p className="font-medium">Uploaded.</p>
          <ul className="mt-1.5 space-y-0.5 text-xs text-brand-300/90">
            <li>
              Full: {result.full.width}×{result.full.height} ·{" "}
              {kb(result.full.bytes)}
            </li>
            <li>
              Thumbnail: {result.thumb.width}×{result.thumb.height} ·{" "}
              {kb(result.thumb.bytes)}
            </li>
            <li>
              Original was {kb(result.originalBytes)}
              {result.replaced > 0 &&
                ` · replaced ${result.replaced} older file${result.replaced === 1 ? "" : "s"}`}
            </li>
          </ul>
        </div>
      )}

      {/* ---- Delete ---- */}
      {value && (
        <div className="mt-3">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-danger-500/40 bg-danger-500/10 p-3">
              <p className="text-sm text-danger-300">
                Delete this image? It is removed from storage permanently.
              </p>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={deleting}
                className="rounded-lg bg-danger-500 px-3.5 py-1.5 text-xs font-semibold text-base-950 disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-base-700 px-3.5 py-1.5 text-xs text-fg-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="rounded-lg border border-base-700 px-3.5 py-1.5 text-xs text-fg-dim transition-colors hover:border-danger-500/50 hover:text-danger-300 disabled:opacity-40"
            >
              Remove image
            </button>
          )}
        </div>
      )}
    </div>
  );
}
