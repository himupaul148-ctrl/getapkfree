import Link from "next/link";
import Disclosure from "@/components/Disclosure";
import PermissionBulletList from "@/components/PermissionBulletList";
import { describePermissions } from "@/lib/permissions";

export default function PermissionsList({
  permissions,
  versionName,
  id,
}: {
  permissions: string[];
  versionName: string | null;
  id?: string;
}) {
  const described = describePermissions(permissions);
  const sensitiveCount = described.filter((p) => p.sensitive).length;

  return (
    <Disclosure
      id={id}
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
            worth a second look. Not sure what a permission actually means?{" "}
            <Link
              href="/blog/what-are-apk-permissions-how-to-check"
              className="text-brand-400 hover:underline"
            >
              Learn how to evaluate app permissions
            </Link>
            .
          </p>
          <div className="mt-4">
            <PermissionBulletList permissions={described} />
          </div>
        </>
      )}
    </Disclosure>
  );
}
