import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { releaseFromApiLevel } from "@/lib/android";

// The parser needs Node built-ins (Buffer, zlib), so this cannot run on edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the upload form needs back. Everything is best-effort. */
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

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  let fileUrl: string;
  try {
    const body = await request.json();
    fileUrl = String(body.fileUrl ?? "");
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // Only ever fetch from this project's own storage — never an arbitrary URL
  // handed in by the caller, which would make this a proxy for scanning.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!base || !fileUrl.startsWith(`${base}/storage/v1/object/public/apks/`)) {
    return NextResponse.json(
      { error: "That file is not in this project's APK storage." },
      { status: 400 },
    );
  }

  let dir: string | null = null;
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      return NextResponse.json(
        { error: `Could not read the uploaded file (${response.status}).` },
        { status: 502 },
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    // app-info-parser takes a path in Node, so stage the bytes on disk.
    dir = await mkdtemp(join(tmpdir(), "apk-"));
    const path = join(dir, "upload.apk");
    await writeFile(path, buffer);

    const { default: AppInfoParser } = await import("app-info-parser");
    const parsed = (await new AppInfoParser(path).parse()) as Record<string, unknown>;

    const application = (parsed.application ?? {}) as Record<string, unknown>;
    const usesSdk = (parsed.usesSdk ?? {}) as Record<string, unknown>;
    const permissions = Array.isArray(parsed.usesPermissions)
      ? (parsed.usesPermissions as Record<string, unknown>[])
          .map((p) => firstString(p?.name))
          .filter((p): p is string => Boolean(p))
      : [];

    const metadata: ApkMetadata = {
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

    return NextResponse.json({ metadata });
  } catch (caught) {
    // A malformed or unusual APK should not take the form down — the client
    // falls back to manual entry.
    const message =
      caught instanceof Error ? caught.message : "Could not read that APK.";
    return NextResponse.json(
      { error: `Could not read metadata from that file: ${message}` },
      { status: 422 },
    );
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
