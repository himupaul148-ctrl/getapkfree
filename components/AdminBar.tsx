"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/components/SessionProvider";

/**
 * Quick-access strip for admins, rendered on every page.
 *
 * Not a second management UI — /admin remains the full list, filter and
 * bulk-action surface. This is a shortcut layer: jump straight to a create
 * form, or see at a glance that something is sitting unpublished.
 *
 * Gating is the same server-verified check as everything else: `status` comes
 * from SessionProvider, which reads /api/me, which calls the same `isAdmin()`
 * the /admin route gate uses. Nothing here is client-trusted — and every link
 * lands on a route that re-checks server-side anyway, so a forged client state
 * would render a bar whose links all bounce to the homepage.
 */

/** Remembers, per tab, that the last answer was "admin". */
const HINT = "getapkfree:was-admin";

function readHint(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(HINT) === "1";
  } catch {
    return false;
  }
}

function writeHint(isAdmin: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (isAdmin) window.sessionStorage.setItem(HINT, "1");
    else window.sessionStorage.removeItem(HINT);
  } catch {
    /* private mode; the bar just fades in a moment later */
  }
}

export default function AdminBar() {
  const { status, drafts } = useSession();
  const pathname = usePathname();

  const confirmed = status === "admin";

  useEffect(() => {
    // Only a server-confirmed answer ever writes the hint, and a confirmed
    // "not admin" clears it immediately.
    if (status === "admin") writeHint(true);
    else if (status === "user") writeHint(false);
  }, [status]);

  /*
   * The hint exists purely to stop the header changing height a beat after
   * every page load.
   *
   * The bar can only be decided client-side: the root layout is deliberately
   * static so the whole site stays CDN-cacheable, and reading cookies there
   * would make every route dynamic. So on a cold load the bar necessarily
   * appears once /api/me answers. Within a tab, the hint lets it paint
   * immediately instead, and the server answer either confirms it or removes
   * it a moment later.
   *
   * It is a rendering optimisation, never an authorisation one — hence the
   * separate `confirmed` flag below, which is what actually gates the counts.
   */
  const show = confirmed || (status === "unknown" && readHint());

  if (!show) return null;

  const totalDrafts = (drafts?.posts ?? 0) + (drafts?.builds ?? 0);

  return (
    <div className="border-b border-brand-500/25 bg-brand-500/[0.07]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-1.5 text-xs sm:px-6">
        <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-brand-300">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6l7-3Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          Admin
        </span>

        <span aria-hidden="true" className="text-base-600">
          |
        </span>

        <BarLink href="/admin/apps" current={pathname}>
          Manage Apps
        </BarLink>
        <BarLink href="/admin/blog?tab=posts" current={pathname}>
          Manage Posts
        </BarLink>

        <span aria-hidden="true" className="text-base-600">
          |
        </span>

        <BarLink href="/admin/upload" current={pathname}>
          + New App
        </BarLink>
        <BarLink href="/admin/blog?tab=write" current={pathname}>
          + New Post
        </BarLink>

        {/* Counts only render once the server has actually confirmed admin —
            the session hint is never enough to show data. */}
        {confirmed && drafts && (
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {totalDrafts === 0 ? (
              <span className="text-fg-dim">Nothing unpublished</span>
            ) : (
              <>
                {drafts.posts > 0 && (
                  <Link
                    href="/admin/blog?tab=posts&status=draft"
                    className="rounded-full bg-warn-500/15 px-2.5 py-0.5 font-medium text-warn-300 transition-colors hover:bg-warn-500/25"
                  >
                    {drafts.posts} draft{drafts.posts === 1 ? "" : "s"}
                  </Link>
                )}
                {drafts.builds > 0 && (
                  <Link
                    href="/admin/apps?status=unpublished"
                    className="rounded-full bg-warn-500/15 px-2.5 py-0.5 font-medium text-warn-300 transition-colors hover:bg-warn-500/25"
                  >
                    {drafts.builds} unpublished build
                    {drafts.builds === 1 ? "" : "s"}
                  </Link>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BarLink({
  href,
  current,
  children,
}: {
  href: string;
  current: string;
  children: React.ReactNode;
}) {
  // Compare paths only — the query string carries the tab, not the location.
  const active = current === href.split("?")[0];

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 transition-colors hover:text-brand-300 ${
        active ? "font-medium text-brand-300" : "text-fg-muted"
      }`}
    >
      {children}
    </Link>
  );
}
