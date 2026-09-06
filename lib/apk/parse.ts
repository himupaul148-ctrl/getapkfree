/**
 * Runs app-info-parser against an APK that already exists as a local file.
 * Extracted from the Supabase-storage `parse-apk` route so a future
 * remote-URL import pipeline can reuse the exact same extraction logic
 * instead of re-implementing it. This module does not download, validate,
 * or clean anything up — callers own the file's lifecycle before and after
 * calling it, exactly as the original route did inline.
 */
// Relative, not the usual "@/lib/..." alias: this module is exercised
// directly by the plain `node --test` runner (see parse.test.ts), which
// resolves specifiers itself and has no knowledge of tsconfig's bundler-only
// path aliases.
import { releaseFromApiLevel } from "../android.ts";

/** What the upload form (and any future importer) needs back. Everything is best-effort. */
export type ApkMetadata = {
  packageName: string | null;
  versionName: string | null;
  versionCode: number | null;
  minAndroidVersion: string | null;
  label: string | null;
  permissions: string[];
  icon: string | null;
};

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const found = value.find((v) => typeof v === "string");
    return typeof found === "string" ? found : null;
  }
  return null;
}

/**
 * Parses the APK at `path` and returns its manifest metadata. Throws on a
 * malformed or unreadable file — callers are expected to catch this and
 * degrade to manual entry, exactly as the existing route does.
 */
export async function parseApkFile(path: string): Promise<ApkMetadata> {
  const { default: AppInfoParser } = await import("app-info-parser");
  const parsed = (await new AppInfoParser(path).parse()) as Record<string, unknown>;

  const application = (parsed.application ?? {}) as Record<string, unknown>;
  const usesSdk = (parsed.usesSdk ?? {}) as Record<string, unknown>;
  const permissions = Array.isArray(parsed.usesPermissions)
    ? (parsed.usesPermissions as Record<string, unknown>[])
        .map((p) => firstString(p?.name))
        .filter((p): p is string => Boolean(p))
    : [];

  return {
    packageName: firstString(parsed.package),
    versionName: firstString(parsed.versionName),
    versionCode: Number.isFinite(Number(parsed.versionCode))
      ? Number(parsed.versionCode)
      : null,
    minAndroidVersion: releaseFromApiLevel(usesSdk.minSdkVersion),
    label: firstString(application.label) ?? firstString(parsed.label),
    permissions: [...new Set(permissions)].sort(),
    icon: typeof parsed.icon === "string" ? parsed.icon : null,
  };
}
