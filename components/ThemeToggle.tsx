"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Theme = "dark" | "light" | "system";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

function resolve(theme: Theme): "dark" | "light" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function apply(theme: Theme) {
  const resolved = resolve(theme);
  const root = document.documentElement;
  if (resolved === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

export default function ThemeToggle({
  initial = "dark",
  persist = false,
}: {
  initial?: Theme;
  persist?: boolean;
}) {
  const [theme, setTheme] = useState<Theme>(initial);
  // Guards the mount-time correction below so it can run at most once. Not a
  // dependency-array job: the correction has to happen before the very first
  // apply()/persist() pass, which a `useEffect(..., [])` cannot do — that
  // effect body already needs to run its own setState, exactly the
  // react-hooks/set-state-in-effect pattern this file used to trip.
  const corrected = useRef(false);

  useEffect(() => {
    /*
     * Trust localStorage over the server value on the very first run: it is
     * what the pre-paint script already applied, so anything else would flip
     * the page after hydration. This has to happen inside the same effect
     * that applies/persists theme, and before it does either — a separate
     * "just correct state" effect would still run its sibling (apply+persist)
     * once with the stale `initial` value in the same commit flush, which
     * would overwrite a real stored preference with the server default before
     * the correction ever got a chance to take effect. Confirmed live: an
     * earlier version of this fix used useSyncExternalStore to read the
     * stored value instead, on the reasoning that its hydration-safe resync
     * happens before passive effects — measured wrong. It did not run in time
     * here, and a stored "light" was silently clobbered back to "dark" on
     * every load.
     */
    if (!corrected.current) {
      corrected.current = true;
      let stored: Theme | null = null;
      try {
        stored = localStorage.getItem("gaf-theme") as Theme | null;
      } catch {
        /* private mode or storage disabled; fall through to the default */
      }
      if (stored && stored !== theme) {
        setTheme(stored);
        return; // this same effect re-runs once the corrected state commits
      }
    }

    apply(theme);
    localStorage.setItem("gaf-theme", theme);

    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  async function choose(next: Theme) {
    setTheme(next);
    if (!persist) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("users").update({ theme: next }).eq("id", user.id);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-xl border border-base-700 bg-base-850 p-1"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          onClick={() => choose(option.value)}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            theme === option.value
              ? "bg-brand-500 font-semibold text-base-950"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
