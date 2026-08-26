"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

/**
 * One image slot: paste a URL or upload a file.
 *
 * Uploads go straight to the public `app-images` bucket from the browser, the
 * same route the APK upload takes, so a large file never has to round-trip
 * through a serverless function with its own body-size ceiling.
 *
 * The preview deliberately uses a plain <img> rather than next/image: an admin
 * can paste a URL from any host, and next/image only renders hosts listed in
 * remotePatterns — it would fail on exactly the arbitrary URLs this field
 * exists to accept.
 */
export default function ImageField({
  label,
  value,
  onChange,
  slug,
  kind,
  hint,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  /** Used to namespace the storage path so an app's images stay together. */
  slug: string;
  kind: "icon" | "screenshot";
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    if (!ACCEPTED.includes(file.type)) {
      setError("PNG, JPEG, WebP, GIF or SVG only.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is 5MB.`,
      );
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
      // Timestamped so replacing an image never collides with a cached URL.
      const path = `${slug || "app"}/${kind}-${Date.now().toString(36)}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("app-images")
        .upload(path, file, { cacheControl: "31536000", upsert: false });
      if (upErr) throw upErr;

      const {
        data: { publicUrl },
      } = supabase.storage.from("app-images").getPublicUrl(path);
      onChange(publicUrl);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not upload that file.",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      {hint && <p className="mt-1 text-xs text-fg-dim">{hint}</p>}

      <div className="mt-2 flex items-start gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-base-700 bg-base-950">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt=""
              className="size-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = "0.15";
              }}
            />
          ) : (
            <span className="text-[10px] text-fg-dim">none</span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://… or upload"
            className="w-full rounded-xl border border-base-700 bg-base-950 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400 disabled:opacity-40"
            >
              {busy ? "Uploading…" : "Upload image"}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange("")}
                className="rounded-lg border border-base-700 px-3 py-1.5 text-xs text-fg-dim transition-colors hover:border-danger-500/50 hover:text-danger-300"
              >
                Clear
              </button>
            )}
          </div>
          {error && <p className="text-xs text-danger-300">{error}</p>}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
