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

  const useDirectImage =
    src.includes("/storage/v1/object/public/") ||
    src.includes("f-droid.org") ||
    !isOptimisable(src);

  if (useDirectImage) {
    // External catalogue icons are served directly. This avoids the
    // Next.js optimizer entirely, which can fail on third-party image hosts.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading={priority ? "eager" : "lazy"}
        onError={() => setFailed(true)}
        className="shrink-0 rounded-xl bg-base-800 object-cover"
      />
    );
  }

  return (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      loading={priority ? undefined : "lazy"}
      priority={priority}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-xl bg-base-800 object-cover"
    />
  );
}
