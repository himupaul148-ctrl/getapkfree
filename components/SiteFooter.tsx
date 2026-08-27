import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { CATEGORIES } from "@/lib/types";

const SITE_LINKS = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/privacy", label: "Privacy" },
  { href: "/dmca", label: "DMCA" },
  { href: "/how-to-install", label: "How to Install" },
  { href: "/blog", label: "Blog" },
];

export default function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-base-800 bg-base-900">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark size={30} />
            <span className="text-lg font-extrabold tracking-tight">
              get<span className="text-brand-500">apk</span>free
              <span className="text-fg-dim">.com</span>
            </span>
          </div>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-fg-muted">
            Free apps, safe downloads. An open-source APK catalogue where every
            build is versioned, scanned, and published with its changelog.
          </p>
        </div>

        <nav aria-label="Site">
          <h2 className="text-xs font-semibold tracking-wider text-fg-dim uppercase">
            Site
          </h2>
          <ul className="mt-4 space-y-2 text-sm">
            {SITE_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-fg-muted transition-colors hover:text-brand-400"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Categories">
          <h2 className="text-xs font-semibold tracking-wider text-fg-dim uppercase">
            Categories
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {CATEGORIES.map((category) => (
              <li key={category}>
                <Link
                  href={`/?category=${encodeURIComponent(category)}#catalogue`}
                  className="text-fg-muted transition-colors hover:text-brand-400"
                >
                  {category}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-base-800">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-fg-dim sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} GetApkFree.com — open source, no tracking.</p>
          <p>
            Demo catalogue: apps are fictional and download links are
            non-functional placeholders.
          </p>
        </div>
      </div>
    </footer>
  );
}
