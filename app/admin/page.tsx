import Link from "next/link";
import { getAdminStats } from "@/lib/admin";
import { formatCount, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const { stats, recent } = await getAdminStats();

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-xl font-bold tracking-tight">Overview</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Apps" value={String(stats.apps)} />
          <Stat
            label="Versions"
            value={String(stats.versions)}
            sub={`${stats.publishedVersions} published`}
          />
          <Stat label="Downloads" value={formatCount(stats.downloads)} />
          <Stat
            label="Withheld builds"
            value={String(stats.versions - stats.publishedVersions)}
            sub="not on the public site"
          />
        </dl>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Action
          href="/admin/upload"
          title="Upload a build"
          body="Pick an APK, pull its metadata, and publish it or keep it as a draft."
        />
        <Action
          href="/admin/apps"
          title="Manage apps"
          body="Edit details, unpublish an app from the public site, or delete it."
        />
      </section>

      <section>
        <h2 className="text-xl font-bold tracking-tight">Recent uploads</h2>
        {recent.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-base-800 bg-base-900 p-6 text-fg-muted">
            Nothing uploaded yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-base-800 overflow-hidden rounded-2xl border border-base-800 bg-base-900">
            {recent.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {row.appSlug ? (
                    <Link
                      href={`/app/${row.appSlug}`}
                      className="hover:text-brand-400"
                    >
                      {row.appName}
                    </Link>
                  ) : (
                    row.appName ?? "Unknown app"
                  )}
                </span>
                <span className="font-mono text-sm text-brand-400">
                  v{row.versionName}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    row.published
                      ? "border-brand-500/30 bg-brand-500/10 text-brand-300"
                      : "border-warn-500/30 bg-warn-500/10 text-warn-300"
                  }`}
                >
                  {row.published ? "Published" : "Draft"}
                </span>
                <span className="w-28 text-right text-sm text-fg-muted">
                  {formatRelative(row.uploadedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-base-800 bg-base-900 p-5">
      <dt className="text-xs text-fg-dim">{label}</dt>
      <dd className="mt-1 text-3xl font-bold tracking-tight text-fg">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-fg-dim">{sub}</dd>}
    </div>
  );
}

function Action({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-base-800 bg-base-900 p-6 transition-colors hover:border-brand-500/50 hover:bg-base-850"
    >
      <h3 className="font-semibold text-fg transition-colors group-hover:text-brand-400">
        {title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{body}</p>
    </Link>
  );
}
