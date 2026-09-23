"use client";

import { useEffect, useRef } from "react";
import HeaderSearch from "@/components/HeaderSearch";
import { useMobileUi } from "@/components/MobileUiProvider";

/**
 * Full-screen search, opened from the bottom nav's Search tab or the mobile
 * header's search icon — both are entry points to this one experience, not
 * two different search UIs. Wraps HeaderSearch as-is: same debounced
 * /api/search calls, same suggestions list, same "view all results" link
 * that falls back to the existing full-catalogue search
 * (/?search=<q>#catalogue) — nothing about search itself changes here.
 */
export default function MobileSearchOverlay() {
  const { overlay, close } = useMobileUi();
  const open = overlay === "search";
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Autofocus the input once the overlay has mounted.
    const input = containerRef.current?.querySelector("input");
    input?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-50 bg-base-950 md:hidden"
    >
      <div className="flex items-center gap-3 border-b border-base-800 px-4 py-3">
        <div className="min-w-0 flex-1">
          <HeaderSearch
            idPrefix="mobile-overlay"
            placeholder="Search apps, packages, developers…"
            scrollableResults
          />
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close search"
          className="shrink-0 rounded-lg border border-base-700 p-2 text-fg-muted"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
