"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMobileUi } from "@/components/MobileUiProvider";

/**
 * Persistent mobile-only bottom navigation. Home/Apps/Blog are real routes
 * (active state follows the current path); Search and More open the shared
 * full-screen overlays from MobileUiProvider instead of navigating, so
 * there's exactly one state to track for "what's currently open" across
 * SiteHeader's search icon and this bar.
 *
 * `md:hidden` matches SiteHeader's own mobile-only search bar breakpoint —
 * tablets (768px+) already get the centred header search bar and the
 * existing hamburger menu, and don't need a second navigation pattern.
 */
export default function MobileBottomNav() {
  const pathname = usePathname();
  const { overlay, openSearch, openMore, close } = useMobileUi();

  const isHome = pathname === "/";
  const isApps = pathname.startsWith("/apps") || pathname.startsWith("/app/");
  const isBlog = pathname.startsWith("/blog");
  const isSearch = overlay === "search";
  const isMore = overlay === "more";

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-base-800 bg-base-900/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-5">
        <NavItem href="/" label="Home" active={isHome} onNavigate={close} icon={HomeIcon} />
        <NavItem href="/apps" label="Apps" active={isApps} onNavigate={close} icon={AppsIcon} />
        <NavButton label="Search" active={isSearch} onClick={openSearch} icon={SearchIcon} />
        <NavItem href="/blog" label="Blog" active={isBlog} onNavigate={close} icon={BlogIcon} />
        <NavButton label="More" active={isMore} onClick={openMore} icon={MoreIcon} />
      </ul>
    </nav>
  );
}

type IconComponent = (props: { active: boolean }) => React.ReactNode;

function itemClasses(active: boolean): string {
  return `flex flex-col items-center justify-center gap-1 py-3 text-[11px] font-medium transition-colors ${
    active ? "text-brand-500" : "text-fg-dim"
  }`;
}

function NavItem({
  href,
  label,
  active,
  onNavigate,
  icon: Icon,
}: {
  href: string;
  label: string;
  active: boolean;
  onNavigate: () => void;
  icon: IconComponent;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={itemClasses(active)}
      >
        <Icon active={active} />
        {label}
      </Link>
    </li>
  );
}

function NavButton({
  label,
  active,
  onClick,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: IconComponent;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`w-full ${itemClasses(active)}`}
      >
        <Icon active={active} />
        {label}
      </button>
    </li>
  );
}

function iconProps(active: boolean) {
  return {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: active ? "currentColor" : "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="m4 11 8-7 8 7" fill="none" />
      <path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

function AppsIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)} fill="none">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function BlogIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)}>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" fill="none" />
      <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" />
    </svg>
  );
}

function MoreIcon({ active }: { active: boolean }) {
  return (
    <svg {...iconProps(active)} fill="none">
      <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
