"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Logo from "@/components/Logo";
import UserMenu from "@/components/UserMenu";
import { useSessionProfile } from "@/lib/useSessionProfile";

const NAV = [
  { href: "/#categories", label: "Categories" },
  { href: "/#recently-updated", label: "Latest" },
  { href: "/how-to-install", label: "How to Install" },
];

export default function SiteHeader() {
  // Read client-side so the root layout stays static and CDN-cacheable.
  const { username, isAdmin, loading } = useSessionProfile();
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const q = term.trim();
    router.push(q ? `/?search=${encodeURIComponent(q)}#catalogue` : "/#catalogue");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-base-800 bg-base-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>

        {/* Centre search — the header entry point; the catalogue below has the
            full filter set. */}
        <form onSubmit={submit} role="search" className="hidden flex-1 justify-center md:flex">
          <div className="relative w-full max-w-md">
            <SearchGlyph />
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search apps, packages, developers…"
              aria-label="Search apps"
              className="w-full rounded-full border border-base-700 bg-base-850 py-2 pr-20 pl-10 text-sm text-fg placeholder:text-fg-dim focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
            />
            <button
              type="submit"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-base-950 transition-colors hover:bg-brand-400"
            >
              Search
            </button>
          </div>
        </form>

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
          ) : username ? (
            <UserMenu username={username} isAdmin={isAdmin} />
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
        <form onSubmit={submit} role="search" className="relative">
          <SearchGlyph />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search apps…"
            aria-label="Search apps"
            className="w-full rounded-full border border-base-700 bg-base-850 py-2 pr-20 pl-10 text-sm text-fg placeholder:text-fg-dim focus:border-brand-500 focus:outline-none"
          />
          <button
            type="submit"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-base-950 transition-colors hover:bg-brand-400"
          >
            Search
          </button>
        </form>
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

function SearchGlyph() {
  return (
    <svg
      className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-dim"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
