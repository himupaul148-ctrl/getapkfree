import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORIES } from "@/lib/types";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

/**
 * Renders inside the root layout, so it keeps the header, footer and theme.
 * An app that has been unpublished or removed lands here, so the useful thing
 * to offer is a way back into the catalogue rather than an apology.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <p className="font-mono text-sm text-brand-400">404</p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
        We couldn&rsquo;t find that page
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-fg-muted">
        The link may be out of date, or the app may have been withdrawn — builds
        are unpublished if a scan flags them or a rights holder asks.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-base-950 transition-colors hover:bg-brand-400"
        >
          Browse the catalogue
        </Link>
        <Link
          href="/how-to-install"
          className="rounded-xl border border-base-700 px-5 py-3 text-sm text-fg-muted transition-colors hover:border-base-600 hover:text-fg"
        >
          How to install an APK
        </Link>
      </div>

      <h2 className="mt-14 text-xs font-semibold tracking-wider text-fg-dim uppercase">
        Browse by category
      </h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {CATEGORIES.map((category) => (
          <li key={category}>
            <Link
              href={`/?category=${encodeURIComponent(category)}#catalogue`}
              className="inline-block rounded-full border border-base-700 px-3.5 py-1.5 text-sm text-fg-muted transition-colors hover:border-brand-500/50 hover:text-brand-400"
            >
              {category}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
