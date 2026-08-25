"use client";

import { useEffect, useState } from "react";
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

  // Trust localStorage over the server value: it is what the pre-paint script
  // already applied, so anything else would flip the page after hydration.
  useEffect(() => {
    const stored = localStorage.getItem("gaf-theme") as Theme | null;
    if (stored && stored !== theme) setTheme(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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
