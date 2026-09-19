"use client";

import Link from "next/link";
import { useMobileUi } from "@/components/MobileUiProvider";
import { useSession } from "@/components/SessionProvider";

/**
 * The bottom nav's "More" tab: a bottom-sheet listing secondary destinations
 * that already exist elsewhere in the app (no new routes) — same pattern as
 * the catalogue's mobile filter drawer (fixed overlay, slide-up sheet,
 * backdrop click to close).
 */
const LINKS = [
  { href: "/#categories", label: "Categories", icon: CategoriesIcon },
  { href: "/how-to-install", label: "How to Install", icon: InstallIcon },
  { href: "/about", label: "About", icon: AboutIcon },
];

export default function MobileMoreMenu() {
  const { overlay, close } = useMobileUi();
  const session = useSession();
  const open = overlay === "more";

  if (!open) return null;

  const signedIn = Boolean(session.username);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60 md:hidden"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-base-700 bg-base-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">More</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="rounded-lg border border-base-700 p-2 text-fg-muted"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav aria-label="More" className="mt-4 space-y-1.5">
          {signedIn && (
            <>
              <MenuLink href="/profile?tab=favorites" label="Favorites" icon={HeartIcon} onClick={close} />
              <MenuLink href="/profile?tab=downloads" label="Downloads" icon={DownloadIcon} onClick={close} />
            </>
          )}
          {LINKS.map((item) => (
            <MenuLink key={item.href} href={item.href} label={item.label} icon={item.icon} onClick={close} />
          ))}
          {signedIn ? (
            <MenuLink href="/profile" label="Account" icon={AccountIcon} onClick={close} />
          ) : (
            <MenuLink href="/login" label="Log in / Sign up" icon={AccountIcon} onClick={close} accent />
          )}
        </nav>
      </div>
    </div>
  );
}

function MenuLink({
  href,
  label,
  icon: Icon,
  onClick,
  accent = false,
}: {
  href: string;
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors hover:bg-base-850 ${
        accent ? "text-brand-400" : "text-fg"
      }`}
    >
      <Icon className={accent ? "text-brand-400" : "text-fg-dim"} />
      {label}
    </Link>
  );
}

function iconProps(className?: string) {
  return {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

function CategoriesIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function InstallIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M10.5 18.5h3" />
      <path d="m9.5 10 2.5 2.5L14.5 9" />
    </svg>
  );
}

function AboutIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </svg>
  );
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1l8.8 8.8 8.8-8.8a5 5 0 0 0 0-7.1z" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M12 3v12m0 0-4-4m4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function AccountIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps(className)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}
