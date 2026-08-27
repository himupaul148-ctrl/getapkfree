import Disclosure from "@/components/Disclosure";
import ScanBadge from "@/components/ScanBadge";
import DownloadButton from "@/components/DownloadButton";
import { formatBytes, formatDate } from "@/lib/format";
import type { Version } from "@/lib/types";

export default function VersionHistory({
  versions,
  appName,
  appCategory = null,
}: {
  versions: Version[];
  /** Analytics only, threaded through to the per-build download links. */
  appName?: string;
  appCategory?: string | null;
}) {
  return (
    <Disclosure
      title="Version history"
      hint={`${versions.length} published build${versions.length === 1 ? "" : "s"}`}
    >
      {versions.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No builds have cleared scanning for this app yet.
        </p>
      ) : (
        <ol className="space-y-5">
          {versions.map((build, index) => (
            <li
              key={build.id}
              className={index > 0 ? "border-t border-base-800 pt-5" : undefined}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-mono font-semibold text-brand-400">
                  v{build.version_name}
                </span>
                {index === 0 && (
                  <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[11px] text-brand-300">
                    Latest
                  </span>
                )}
                <span className="text-xs text-fg-dim">build {build.version_code}</span>
                <ScanBadge
                  status={build.scan_status}
                  scannedAt={build.scanned_at}
                  showDate={false}
                />
              </div>

              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-muted">
                <div className="flex gap-1.5">
                  <dt className="text-fg-dim">Released</dt>
                  <dd>{formatDate(build.uploaded_at)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-fg-dim">Size</dt>
                  <dd>{formatBytes(build.file_size)}</dd>
                </div>
                {build.min_android_version && (
                  <div className="flex gap-1.5">
                    <dt className="text-fg-dim">Requires</dt>
                    <dd>Android {build.min_android_version}+</dd>
                  </div>
                )}
              </dl>

              {build.changelog && (
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                  {build.changelog}
                </p>
              )}

              <DownloadButton
                versionId={build.id}
                versionName={build.version_name}
                fileUrl={build.file_url}
                variant="link"
                appName={appName}
                appCategory={appCategory}
              />
            </li>
          ))}
        </ol>
      )}
    </Disclosure>
  );
}
