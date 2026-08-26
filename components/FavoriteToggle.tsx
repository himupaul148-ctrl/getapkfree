"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFavorites } from "@/components/FavoritesProvider";

/**
 * Heart toggle used on cards and on the detail page. State comes from
 * FavoritesProvider rather than server props, so the surrounding page needs no
 * cookies and stays cacheable.
 */
export default function FavoriteToggle({
  appId,
  appName,
  variant = "icon",
}: {
  appId: string;
  appName: string;
  variant?: "icon" | "button";
}) {
  const router = useRouter();
  const { isFavorite, toggle, ready } = useFavorites();
  const [prompt, setPrompt] = useState(false);
  const [pending, setPending] = useState(false);

  const favorite = isFavorite(appId);

  async function onClick(event: React.MouseEvent) {
    // Cards are wrapped in a link; keep the click here.
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;

    setPending(true);
    const result = await toggle(appId);
    setPending(false);

    if (result === "signin-required") {
      setPrompt(true);
      setTimeout(() => router.push("/login?next=/"), 900);
    }
  }

  const label = favorite
    ? `Remove ${appName} from favourites`
    : `Save ${appName} to favourites`;

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-pressed={favorite}
        // Until the session resolves the heart is simply unfilled; no spinner,
        // because a flicker on every card would be worse than a late fill.
        className={`group inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
          favorite
            ? "border-danger-500/50 bg-danger-500/10 text-danger-300"
            : "border-base-700 text-fg-muted hover:border-danger-500/50 hover:text-danger-300"
        }`}
      >
        <Heart filled={favorite} />
        <span className="hidden sm:inline">
          {prompt ? "Sign in first" : favorite ? "Saved" : "Save"}
        </span>
        <span className="sr-only">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-pressed={favorite}
      data-ready={ready}
      className={`absolute top-3 right-3 z-10 rounded-full border p-2 transition-colors ${
        favorite
          ? "border-danger-500/50 bg-danger-500/10 text-danger-300"
          : "border-base-700 bg-base-900/80 text-fg-dim hover:border-danger-500/50 hover:text-danger-300"
      }`}
    >
      <Heart filled={favorite} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z" />
    </svg>
  );
}
