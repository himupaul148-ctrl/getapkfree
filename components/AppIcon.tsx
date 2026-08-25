"use client";

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
 * Renders an app icon from a remote URL, falling back to an initials badge if
 * the image is missing or fails to load. A plain <img> avoids having to
 * whitelist every icon host in next.config remotePatterns.
 */
export default function AppIcon({
  src,
  name,
  size = 56,
}: {
  src: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const dimensions = { width: size, height: size };

  if (!src || failed) {
    return (
      <div
        style={dimensions}
        className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-base-700 to-base-600 font-semibold text-fg-muted"
      >
        {initialsOf(name)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      {...dimensions}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-xl bg-base-800 object-cover"
    />
  );
}
