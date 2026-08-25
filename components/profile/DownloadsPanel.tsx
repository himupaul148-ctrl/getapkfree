import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import DownloadButton from "@/components/DownloadButton";
import { formatBytes, formatDate } from "@/lib/format";

export type DownloadRow = {
  id: string;
  downloaded_at: string;
  versionId: string | null;
  versionName: string | null;
  fileSize: number | null;
  fileUrl: string | null;
  appName: string | null;
  appSlug: string | null;
  appIcon: string | null;
};

export default function DownloadsPanel({ rows }: { rows: DownloadRow[] }) {
  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight">Downloaded apps</h2>
      <p className="mt-1 text-sm text-fg-muted">
        {rows.length === 0
          ? "Nothing yet."
          : `${rows.length} download${rows.length === 1 ? "" : "s"}, newest first.`}
      </p>

      {rows.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-base-800 bg-base-900 p-8 text-center text-fg-muted">
          Downloads you make while signed in show up here.{" "}
          <Link href="/" className="text-brand-400 hover:underline">
            Browse the catalogue
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-base-800 bg-base-900 p-4"
            >
              <AppIcon src={row.appIcon} name={row.appName ?? "?"} size={44} />

              <div className="min-w-0 flex-1">
                {row.appSlug ? (
                  <Link
                    href={`/app/${row.appSlug}`}
                    className="truncate font-medium text-fg hover:text-brand-400"
                  >
                    {row.appName}
                  </Link>
                ) : (
                  <span className="truncate font-medium text-fg-muted">
                    App no longer listed
                  </span>
                )}
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-fg-dim">
                  <span className="font-mono text-brand-400">
                    v{row.versionName ?? "—"}
                  </span>
                  <span>{formatBytes(row.fileSize)}</span>
                  <span>{formatDate(row.downloaded_at)}</span>
                </p>
              </div>

              {row.versionId ? (
                <DownloadButton
                  versionId={row.versionId}
                  versionName={row.versionName ?? ""}
                  fileUrl={row.fileUrl}
                  variant="link"
                >
                  Re-download
                </DownloadButton>
              ) : (
                <span className="text-sm text-fg-dim">Build withdrawn</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
