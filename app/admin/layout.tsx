import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/upload", label: "Upload" },
  { href: "/admin/apps", label: "Apps" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Non-admins go to the homepage rather than a 403, so the panel's existence
  // is not advertised. RLS is the real guard; this only shapes the UI.
  if (!(await isAdmin())) redirect("/");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Upload builds and manage the catalogue.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg border border-base-700 px-3 py-2 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          View site
        </Link>
      </header>

      <nav className="mt-6 flex gap-2 overflow-x-auto border-b border-base-800 pb-px">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded-t-lg px-4 py-2.5 text-sm whitespace-nowrap text-fg-muted transition-colors hover:bg-base-850 hover:text-fg"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-8">{children}</div>
    </div>
  );
}
