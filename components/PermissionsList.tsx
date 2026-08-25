import Disclosure from "@/components/Disclosure";
import { describePermissions } from "@/lib/permissions";

export default function PermissionsList({
  permissions,
  versionName,
}: {
  permissions: string[];
  versionName: string | null;
}) {
  const described = describePermissions(permissions);
  const sensitiveCount = described.filter((p) => p.sensitive).length;

  return (
    <Disclosure
      title="Permissions"
      hint={
        described.length === 0
          ? "none requested"
          : `${described.length} requested${sensitiveCount ? ` · ${sensitiveCount} worth reviewing` : ""}`
      }
    >
      {described.length === 0 ? (
        <p className="text-sm text-fg-muted">
          This build requests no permissions at all.
        </p>
      ) : (
        <>
          <p className="text-sm text-fg-muted">
            What version {versionName} is allowed to do once installed.
            Highlighted entries reach outside the app&rsquo;s own sandbox and are
            worth a second look.
          </p>
          <ul className="mt-4 space-y-3">
            {described.map((permission) => (
              <li key={permission.raw} className="flex gap-3">
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    permission.sensitive ? "bg-amber-400" : "bg-base-600"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                    {permission.label}
                    {permission.sensitive && (
                      <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-normal text-amber-300">
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
        </>
      )}
    </Disclosure>
  );
}
