"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const ITEMS = [
  { href: "/profile", label: "Profile" },
  { href: "/profile?tab=settings", label: "Settings" },
];

export default function UserMenu({
  username,
  isAdmin = false,
}: {
  username: string;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-xl border border-base-700 py-1.5 pr-2.5 pl-1.5 text-sm text-fg transition-colors hover:border-base-600"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-xs font-bold text-base-950">
          {username.slice(0, 2).toUpperCase()}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{username}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`text-fg-dim transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-xl border border-base-700 bg-base-900 shadow-xl shadow-black/40"
        >
          <p className="border-b border-base-800 px-4 py-3 text-xs text-fg-dim">
            Signed in as <span className="block truncate text-fg">{username}</span>
          </p>
          {(isAdmin ? [...ITEMS, { href: "/admin", label: "Admin" }] : ITEMS).map((item) => (
            <Link
              key={item.label}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-fg-muted transition-colors hover:bg-base-850 hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
          {/* POST so a prefetch or a crawler can never sign the user out. */}
          <form action="/auth/signout" method="post" className="border-t border-base-800">
            <button
              type="submit"
              role="menuitem"
              className="w-full px-4 py-2.5 text-left text-sm text-danger-300 transition-colors hover:bg-base-850"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
