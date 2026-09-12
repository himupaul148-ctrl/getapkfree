import type { PermissionInfo } from "@/lib/permissions";

/**
 * The actual permission-list markup, pulled out of PermissionsList so
 * VersionHistory can reuse the exact same rendering for a single historical
 * build's permissions without duplicating the label/description/sensitive
 * styling in a second place. PermissionsList keeps its own intro paragraph
 * and blog link around this — those are specific to the "current version"
 * section, not to the list itself.
 */
export default function PermissionBulletList({
  permissions,
}: {
  permissions: PermissionInfo[];
}) {
  return (
    <ul className="space-y-3">
      {permissions.map((permission) => (
        <li key={permission.raw} className="flex gap-3">
          <span
            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
              permission.sensitive ? "bg-warn-500" : "bg-base-600"
            }`}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              {permission.label}
              {permission.sensitive && (
                <span className="rounded-full border border-warn-500/30 bg-warn-500/10 px-2 py-0.5 text-[11px] font-normal text-warn-300">
                  Review
                </span>
              )}
            </p>
            <p className="text-sm text-fg-muted">{permission.description}</p>
            <p className="mt-0.5 font-mono text-xs break-all text-fg-dim">
              {permission.raw}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
