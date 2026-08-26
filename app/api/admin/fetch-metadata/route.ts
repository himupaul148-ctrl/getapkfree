import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { fetchMetadata } from "@/lib/metadata/fetchers";

// Reaches out to third-party sites, so it needs the Node runtime and must
// never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Only http(s), and only a hostname that resolves publicly. Without this an
 * admin-shaped SSRF could point the server at http://169.254.169.254/ or an
 * internal address and have the response rendered straight back into the form.
 */
function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https URLs are supported.");
  }

  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    // IPv4 literals in the private and link-local ranges
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    // IPv6 loopback / unique-local
    host === "::1" ||
    host.startsWith("fd") ||
    host.startsWith("fe80:");

  if (blocked) throw new Error("That host is not reachable from here.");
  return url;
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorised." }, { status: 403 });
  }

  let url: URL;
  try {
    const body = await request.json();
    url = assertSafeUrl(String(body.url ?? "").trim());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bad request." },
      { status: 400 },
    );
  }

  try {
    const metadata = await fetchMetadata(url.toString());
    return NextResponse.json({ metadata });
  } catch (error) {
    // Surfaced verbatim: when a scrape breaks, the admin needs the real reason
    // (rate limit, 404, timeout) to decide whether to retry or fill it in.
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not read that page.",
      },
      { status: 502 },
    );
  }
}
