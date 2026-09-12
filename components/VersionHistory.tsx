import Disclosure from "@/components/Disclosure";
import PermissionBulletList from "@/components/PermissionBulletList";
import ScanBadge from "@/components/ScanBadge";
import DownloadButton from "@/components/DownloadButton";
import { formatBytes, formatDate } from "@/lib/format";
import { hasTargetSdk, summarizeVersionPermissions } from "@/lib/version-history";
import type { Version } from "@/lib/types";

export default function VersionHistory({
  versions,
  appName,
  appCategory = null,
  id,
}: {
  versions: Version[];
  /** Analytics only, threaded through to the per-build download links. */
  appName?: string;
  appCategory?: string | null;
  /** Stable anchor for this section, e.g. "version-history". */
  id?: string;
}) {
  return (
    <Disclosure
      id={id}
      title="Version history"
      hint={`${versions.length} published build${versions.length === 1 ? "" : "s"}`}
    >
      {versions.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No builds have cleared scanning for this app yet.
        </p>
      ) : (
        <ol className="space-y-5">
          {versions.map((build, index) => {
            // Never a placeholder — a build with no target SDK on record
            // simply has no "Target SDK" fact, exactly like min_android_version
            // above it already omits itself when unknown.
            const showTargetSdk = hasTargetSdk(build.target_sdk);
            // Null (not an empty summary) when this build requests nothing —
            // callers render no permissions block at all in that case.
            const permissionsSummary = summarizeVersionPermissions(build.permissions);

            return (
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
                  {showTargetSdk && (
                    <div className="flex gap-1.5">
                      <dt className="text-fg-dim">Target SDK</dt>
                      <dd>{build.target_sdk}</dd>
                    </div>
                  )}
                </dl>

                {build.changelog && (
                  <p className="mt-2 text-sm leading-relaxed text-fg-muted">
                    {build.changelog}
                  </p>
                )}

                {/* A single, lightweight native disclosure per build — not
                    another styled Disclosure card — so N historical builds
                    never stack into a wall of heavy nested accordions. */}
                {permissionsSummary && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-brand-400 hover:underline">
                      {permissionsSummary.summaryText}
                    </summary>
                    <div className="mt-3">
                      <PermissionBulletList permissions={permissionsSummary.described} />
                    </div>
                  </details>
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
            );
          })}
        </ol>
      )}
    </Disclosure>
  );
}
