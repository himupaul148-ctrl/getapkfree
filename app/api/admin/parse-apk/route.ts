import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { parseApkFile, type ApkMetadata } from "@/lib/apk/parse";

// The parser needs Node built-ins (Buffer, zlib), so this cannot run on edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-exported so nothing that imported the type from this route breaks —
// the shape itself now lives in lib/apk/parse.ts, shared with any future
// remote-URL import pipeline.
export type { ApkMetadata };

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

    const metadata = await parseApkFile(path);

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
