"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared confirmation/result dialog shell, extracted from AppsManager.tsx
 * so GithubApkImportAction.tsx (and any future admin action component) can
 * reuse the exact same modal without importing AppsManager.tsx itself —
 * which would create a circular module dependency, since AppsManager.tsx
 * renders GithubApkImportAction.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Keyboard focus was on whatever triggered the modal (e.g. an "Import"
    // button) — restored there on close so focus doesn't silently fall back
    // to <body> and strand a keyboard user at the top of the page.
    const trigger = document.activeElement as HTMLElement | null;

    function focusable(): HTMLElement[] {
      return Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      );
    }

    // Moves focus into the dialog itself rather than leaving it on the
    // now-hidden trigger behind the overlay.
    (focusable()[0] ?? dialogRef.current)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Focus trap: Tab/Shift+Tab cycle within the dialog only, so a
      // keyboard user can never tab past it into the (still-mounted, only
      // visually covered) background page while the overlay is open.
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      trigger?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-base-700 bg-base-900 p-6 outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-base-700 p-3.5 text-fg-muted hover:text-fg focus:border-brand-500 focus:outline-none"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
