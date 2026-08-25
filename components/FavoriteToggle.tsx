"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Heart toggle used on cards and on the detail page. `initialFavorite` comes
 * from the server render so the correct state paints immediately instead of
 * flickering empty-then-filled.
 */
export default function FavoriteToggle({
  appId,
  appName,
  signedIn,
  initialFavorite = false,
  variant = "icon",
  onRemoved,
}: {
  appId: string;
  appName: string;
  signedIn: boolean;
  initialFavorite?: boolean;
  variant?: "icon" | "button";
  onRemoved?: () => void;
}) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(initialFavorite);
  const [pending, setPending] = useState(false);
  const [prompt, setPrompt] = useState(false);

  async function toggle(event: React.MouseEvent) {
    // Cards are wrapped in a link; keep the click here.
    event.preventDefault();
    event.stopPropagation();

    if (!signedIn) {
      setPrompt(true);
      setTimeout(() => router.push("/login?next=/"), 900);
      return;
    }
    if (pending) return;

    const next = !favorite;
    setFavorite(next); // optimistic
    setPending(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setFavorite(!next);
      setPending(false);
      router.push("/login?next=/");
      return;
    }

    const { error } = next
      ? await supabase
          .from("favorites")
          .upsert({ user_id: user.id, app_id: appId }, { onConflict: "user_id,app_id" })
      : await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("app_id", appId);

    if (error) {
      setFavorite(!next); // roll the optimistic update back
    } else if (!next) {
      onRemoved?.();
      router.refresh();
    } else {
      router.refresh();
    }
    setPending(false);
  }

  const label = favorite
    ? `Remove ${appName} from favourites`
    : `Save ${appName} to favourites`;

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={toggle}
        title={signedIn ? label : `Sign in to save ${appName}`}
        aria-pressed={favorite}
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
      onClick={toggle}
      title={signedIn ? label : `Sign in to save ${appName}`}
      aria-pressed={favorite}
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
