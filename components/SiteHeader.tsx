"use client";

import Link from "next/link";
import { useState } from "react";
import Logo from "@/components/Logo";
import UserMenu from "@/components/UserMenu";
import { useSession } from "@/components/SessionProvider";
import ModeBadge from "@/components/ModeBadge";
import AdminBar from "@/components/AdminBar";
import HeaderSearch from "@/components/HeaderSearch";

const NAV = [
  { href: "/#categories", label: "Categories" },
  { href: "/#recently-updated", label: "Latest" },
  { href: "/how-to-install", label: "How to Install" },
  { href: "/blog", label: "Blog" },
];

export default function SiteHeader() {
  // Read client-side so the root layout stays static and CDN-cacheable.
  const session = useSession();
  const { username } = session;
  const isAdmin = session.status === "admin";
  // "unknown" is a real state now: still checking, or a check that failed.
  const loading = session.status === "unknown" && !session.expired && !session.error;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-base-800 bg-base-950/90 backdrop-blur">
      {/* Renders null for everyone who is not a server-confirmed admin. */}
      <AdminBar />
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>

        {/* Centre search — the header entry point; the catalogue below has the
            full filter set. */}
        <div className="hidden flex-1 justify-center md:flex">
          <HeaderSearch
            idPrefix="header-desktop"
            placeholder="Search apps, packages, developers…"
            className="w-full max-w-md"
          />
        </div>

        <nav className="ml-auto hidden items-center gap-6 text-sm text-fg-muted lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-brand-400"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-4">
          {loading ? (
            <span
              aria-hidden="true"
              className="hidden h-9 w-24 animate-pulse rounded-xl bg-base-850 sm:block"
            />
            ) : username || session.expired || session.error ? (
              <>
                {/* Always on screen once there is anything to say,
                    including on mobile — you should never be in admin
                    mode without seeing it. */}
                <ModeBadge />
                {username && (
                  <UserMenu username={username} isAdmin={isAdmin} />
                )}
              </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-lg px-3 py-2 text-sm text-fg-muted transition-colors hover:text-fg sm:block"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="hidden rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-base-950 transition-colors hover:bg-brand-400 sm:block"
              >
                Sign up
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Toggle menu"
            className="rounded-lg border border-base-700 p-2 text-fg-muted lg:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile: search always reachable, nav behind the toggle. */}
      <div className="border-t border-base-800 px-4 py-2 md:hidden">
        <HeaderSearch idPrefix="header-mobile" placeholder="Search apps…" />
      </div>

      {menuOpen && (
        <nav className="border-t border-base-800 px-4 py-3 lg:hidden">
          <ul className="flex flex-col gap-1 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-2 py-2 text-fg-muted hover:bg-base-850 hover:text-fg"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            {!username && !loading && (
              <li className="sm:hidden">
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-lg px-2 py-2 text-brand-400"
                >
                  Log in / Sign up
                </Link>
              </li>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}
