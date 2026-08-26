"use client";

import Image from "next/image";
import { isOptimisable } from "@/lib/images";
import { useState } from "react";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

/**
 * App icon via next/image, so remote icons are resized, converted to
 * AVIF/WebP and cached by the image optimiser rather than shipped at whatever
 * size F-Droid happens to serve (their icons are 640px for a 56px slot).
 *
 * Falls back to an initials badge when the icon is missing or fails to load —
 * imported catalogues always have some broken icon URLs.
 */
export default function AppIcon({
  src,
  name,
  size = 56,
  priority = false,
}: {
  src: string | null;
  name: string;
  size?: number;
  /** Set on the one icon above the fold; everything else stays lazy. */
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-base-700 to-base-600 font-semibold text-fg-muted"
      >
        {initialsOf(name)}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      loading={priority ? undefined : "lazy"}
      priority={priority}
      // An admin can paste an icon from any host; the optimiser only accepts
      // the allowlist, so anything else renders straight through.
      unoptimized={!isOptimisable(src)}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-xl bg-base-800 object-cover"
    />
  );
}
