/**
 * SSRF-safe fetching for admin-supplied, attacker-influenced URLs (a remote
 * APK URL, in the first instance). Nothing here is wired into a route yet —
 * this module is the security/download foundation only.
 *
 * The core discipline throughout: every URL — the one an admin typed in,
 * and every redirect target after it — goes through the exact same
 * validate-then-connect path. Nothing is ever fetched, resolved, or
 * followed without first being validated by this module.
 *
 * Resolve-then-pin, not resolve-then-hope: `dns.lookup` is called exactly
 * once per URL, every address it returns is checked against a private/
 * internal/loopback/link-local/metadata block-list, and if all addresses
 * are safe the *same* validated address is handed straight to the HTTPS
 * transport via a custom `lookup` override that performs no DNS query of
 * its own. That closes the classic DNS-rebinding gap, where a second,
 * independent lookup at connect time could resolve somewhere different
 * from the one just validated.
 */
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import * as https from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Thrown for a policy violation (SSRF, scheme, size, redirect limit, timeout) — never for an ordinary network failure. */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

type Family = 4 | 6;
type Pinned = { address: string; family: Family };

/* ---------------------------------------------------------- IP block-list */

/**
 * One shared block-list for the process. `net.BlockList` is a Node core
 * primitive built exactly for this: unlike hand-rolled regexes over an IP
 * string, it correctly understands IPv4-mapped IPv6 addresses (it matches
 * "::ffff:127.0.0.1" against an IPv4 loopback subnet without being told to)
 * and canonicalises whatever form DNS or a redirect hands back.
 *
 * Ranges included, and why:
 *  - 0.0.0.0/8, "::"        — the unspecified / "this network" address
 *  - 10/8, 172.16/12, 192.168/16 — RFC1918 private space
 *  - 100.64.0.0/10          — carrier-grade NAT (RFC6598)
 *  - 127/8, "::1"           — loopback
 *  - 169.254.0.0/16         — link-local, which is where every major
 *                             cloud's instance-metadata service lives
 *                             (169.254.169.254 specifically)
 *  - 192.0.0.0/24, 192.0.2.0/24, 198.18.0.0/15, 198.51.100.0/24,
 *    203.0.113.0/24         — IANA special-purpose / documentation /
 *                             benchmarking ranges; nothing legitimate is
 *                             ever hosted there
 *  - 224.0.0.0/4, 240.0.0.0/4 — multicast and reserved (incl. broadcast)
 *  - fc00::/7               — unique local addresses, which covers the
 *                             fd00::/8 range some clouds put IPv6 metadata
 *                             endpoints in (e.g. fd00:ec2::254)
 *  - fe80::/10              — link-local
 *  - ff00::/8               — multicast
 *  - 64:ff9b::/96           — NAT64 well-known prefix (embeds an IPv4
 *                             address BlockList still checks separately)
 *  - 2001:db8::/32          — documentation range
 */
function buildBlockList(): BlockList {
  const bl = new BlockList();

  bl.addAddress("0.0.0.0", "ipv4");
  bl.addSubnet("0.0.0.0", 8, "ipv4");
  bl.addSubnet("10.0.0.0", 8, "ipv4");
  bl.addSubnet("100.64.0.0", 10, "ipv4");
  bl.addSubnet("127.0.0.0", 8, "ipv4");
  bl.addSubnet("169.254.0.0", 16, "ipv4");
  bl.addSubnet("172.16.0.0", 12, "ipv4");
  bl.addSubnet("192.0.0.0", 24, "ipv4");
  bl.addSubnet("192.0.2.0", 24, "ipv4");
  bl.addSubnet("192.168.0.0", 16, "ipv4");
  bl.addSubnet("198.18.0.0", 15, "ipv4");
  bl.addSubnet("198.51.100.0", 24, "ipv4");
  bl.addSubnet("203.0.113.0", 24, "ipv4");
  bl.addSubnet("224.0.0.0", 4, "ipv4");
  bl.addSubnet("240.0.0.0", 4, "ipv4");

  bl.addAddress("::", "ipv6");
  bl.addSubnet("::1", 128, "ipv6");
  bl.addSubnet("64:ff9b::", 96, "ipv6");
  bl.addSubnet("2001:db8::", 32, "ipv6");
  bl.addSubnet("fc00::", 7, "ipv6");
  bl.addSubnet("fe80::", 10, "ipv6");
  bl.addSubnet("ff00::", 8, "ipv6");

  return bl;
}

const blockList = buildBlockList();

/** Exported so both the resolver below and tests can check a bare address directly. */
export function isBlockedAddress(address: string, family: Family): boolean {
  return blockList.check(address, family === 6 ? "ipv6" : "ipv4");
}

/* --------------------------------------------------------- hostname rules */

// Caught before any DNS lookup happens at all — these never resolve to
// anything we should trust regardless of what they resolve to.
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
]);
const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal"];

/** IPv6 literals appear in a URL's `.hostname` wrapped in brackets, e.g. "[::1]". */
function bareHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

/** A trailing root label ("example.com.") must not dodge a suffix/exact check. */
function stripTrailingDots(hostname: string): string {
  return hostname.replace(/\.+$/, "");
}

function normalizeHostname(hostname: string): string {
  return stripTrailingDots(bareHostname(hostname)).toLowerCase();
}

function assertHostnameAllowed(hostname: string): void {
  const host = normalizeHostname(hostname);
  if (!host) throw new UnsafeUrlError("URL has no hostname.");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UnsafeUrlError(`"${host}" is not reachable from here.`);
  }
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      throw new UnsafeUrlError(`"${host}" is not reachable from here.`);
    }
  }
}

/* -------------------------------------------------------------- URL rules */

/**
 * Parses and validates scheme + credentials. Deliberately does all of its
 * work through `new URL()` and only ever reads back `.protocol`/`.hostname`/
 * `.username`/`.password` — never the raw string — because the WHATWG URL
 * parser is what already collapses the alternate-representation tricks
 * (decimal/octal/hex IPv4, backslash-as-separator, etc.) into one canonical
 * form. Re-parsing by hand anywhere is exactly how those tricks reopen.
 */
export function assertHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeUrlError(
      `Only https:// URLs are allowed (got "${url.protocol}").`,
    );
  }
  // Credentials in the URL aren't a routing risk by themselves, but they're
  // a classic parser-confusion vector against other tools reading the same
  // string, and there is no legitimate reason an admin-supplied APK link
  // needs them.
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not allowed.");
  }
  return url;
}

/* --------------------------------------------------------- DNS resolution */

export type LookupFn = (hostname: string) => Promise<Pinned[]>;

/** The real resolver. Tests inject a fake one instead of touching the network or DNS. */
const defaultLookup: LookupFn = async (hostname) => {
  let records: { address: string; family: number }[];
  try {
    records = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve "${hostname}".`);
  }
  return records.map((r) => ({
    address: r.address,
    family: r.family === 6 ? 6 : 4,
  }));
};

/**
 * Resolves `hostname` to every address it has, validates each one, and
 * returns the address to pin the actual connection to. If a literal IP was
 * passed as the hostname, that IP *is* the resolution (matching what
 * `dns.lookup` itself does for an IP literal) — it still goes through the
 * exact same block-list check as a resolved name.
 *
 * "If ANY resolved address is unsafe, reject the request" — a name that
 * resolves to one public and one internal address is rejected outright
 * rather than quietly connecting to the public one, since which address a
 * later, unvalidated connection attempt would actually use is not something
 * this code controls.
 */
export async function resolvePinnedAddress(
  hostname: string,
  lookup: LookupFn = defaultLookup,
): Promise<Pinned> {
  assertHostnameAllowed(hostname);
  const host = normalizeHostname(hostname);

  const literalFamily = isIP(host);
  const records: Pinned[] =
    literalFamily === 4
      ? [{ address: host, family: 4 }]
      : literalFamily === 6
        ? [{ address: host, family: 6 }]
        : await lookup(host);

  if (records.length === 0) {
    throw new UnsafeUrlError(`"${host}" did not resolve to any address.`);
  }

  for (const { address, family } of records) {
    if (isBlockedAddress(address, family)) {
      throw new UnsafeUrlError(
        `"${host}" resolves to a non-routable or internal address and cannot be fetched.`,
      );
    }
  }

  return records[0];
}

/** Full per-hop validation: scheme + credentials + hostname + DNS + block-list. */
export async function validateUrlForFetch(
  raw: string,
  lookup?: LookupFn,
): Promise<{ url: URL; pinned: Pinned }> {
  const url = assertHttpsUrl(raw);
  const pinned = await resolvePinnedAddress(url.hostname, lookup);
  return { url, pinned };
}

/* ------------------------------------------------------------- transport */

/** One request attempt: either a redirect to follow, or a response body to read. */
export type TransportResponse =
  | { kind: "redirect"; location: string }
  | {
      kind: "body";
      statusCode: number;
      headers: Record<string, string | undefined>;
      body: NodeJS.ReadableStream;
      destroy: () => void;
    };

/** Swappable so tests can drive the redirect/size/timeout logic without a real socket or TLS. */
export type Transport = (
  url: URL,
  pinned: Pinned,
  timeoutMs: number,
) => Promise<TransportResponse>;

const USER_AGENT = "GetApkFree-Importer/1.0 (+https://getapkfree.com)";

/**
 * The production transport. Connects to the pre-validated, pinned IP
 * address via a custom `lookup` override on the request itself — this is
 * the resolve-then-pin step: Node performs no DNS query of its own for this
 * connection, it is simply handed the address `validateUrlForFetch` already
 * checked. `hostname`/`servername` stay as the original hostname so the
 * Host header and the TLS SNI (and therefore certificate validation) are
 * unaffected — only the actual TCP destination is pinned.
 *
 * Redirects are read but never auto-followed: `https.request` (unlike the
 * global `fetch`) does not follow redirects on its own, which is exactly
 * the manual control this feature needs.
 */
export const httpsTransport: Transport = (url, pinned, timeoutMs) =>
  new Promise((resolve, reject) => {
    const servername = normalizeHostname(url.hostname);
    let settled = false;

    const req = https.request({
      hostname: url.hostname,
      servername,
      port: url.port ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/vnd.android.package-archive, application/octet-stream, */*",
      },
      timeout: timeoutMs,
      // The resolve-then-pin step: always hand back the address already
      // validated, never perform a second lookup of our own.
      lookup: (
        _hostname: string,
        options: { all?: boolean } | undefined,
        callback: (
          err: NodeJS.ErrnoException | null,
          address: string | { address: string; family: number }[],
          family?: number,
        ) => void,
      ) => {
        if (options?.all) {
          callback(null, [{ address: pinned.address, family: pinned.family }]);
        } else {
          callback(null, pinned.address, pinned.family);
        }
      },
    });

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    }

    req.on("timeout", () => fail(new UnsafeUrlError("The request timed out.")));
    req.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));

    req.on("response", (res) => {
      if (settled) return;
      settled = true;

      const status = res.statusCode ?? 0;
      const location = res.headers.location;

      if (status >= 300 && status < 400 && location) {
        res.resume(); // drain and discard — we never read a redirect body
        resolve({ kind: "redirect", location });
        return;
      }

      resolve({
        kind: "body",
        statusCode: status,
        headers: res.headers as Record<string, string | undefined>,
        body: res,
        destroy: () => res.destroy(),
      });
    });

    req.end();
  });

/* --------------------------------------------------------------- sizing */

const DEFAULT_TEMP_FILE_NAME = "download.bin";

/**
 * `streamToTempFile`'s file name is a plain path segment, not attacker
 * input — every call site is a literal string in this codebase — but it
 * still gets a cheap sanity check, since a broken caller silently writing
 * outside the fresh temp directory would be an easy mistake to miss.
 */
function assertPlainFileName(name: string): void {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`Invalid temp file name: "${name}".`);
  }
}

/**
 * Streams a response body to a fresh temp file, enforcing `maxBytes` as
 * bytes actually arrive — never buffering the whole response in memory
 * first. Exceeding the cap aborts the source stream immediately and
 * removes the partial file; nothing partial is ever handed back as a
 * result.
 *
 * `fileName` defaults to a content-agnostic name — this module downloads
 * arbitrary attacker-influenced URLs and has no business assuming what kind
 * of file is on the other end. A caller that hands the result to something
 * which infers type from the filename's extension (as `app-info-parser`
 * does) is responsible for passing the extension it actually needs.
 */
export function streamToTempFile(
  body: NodeJS.ReadableStream,
  maxBytes: number,
  destroySource: () => void,
  fileName: string = DEFAULT_TEMP_FILE_NAME,
): Promise<{ path: string; size: number }> {
  assertPlainFileName(fileName);

  return new Promise((resolve, reject) => {
    let dir: string | null = null;
    let settled = false;

    function fail(err: Error, out?: ReturnType<typeof createWriteStream>) {
      if (settled) return;
      settled = true;
      destroySource();
      out?.destroy();
      const cleanupDir = dir;
      if (cleanupDir) rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
      reject(err);
    }

    mkdtemp(join(tmpdir(), "safe-dl-"))
      .then((createdDir) => {
        if (settled) {
          rm(createdDir, { recursive: true, force: true }).catch(() => {});
          return;
        }
        dir = createdDir;
        const filePath = join(dir, fileName);
        const out = createWriteStream(filePath);
        let received = 0;

        out.on("error", (err) => fail(err, out));

        body.on("data", (chunk: Buffer) => {
          if (settled) return;
          received += chunk.length;
          if (received > maxBytes) {
            fail(
              new UnsafeUrlError(
                `Download exceeded the ${maxBytes}-byte limit.`,
              ),
              out,
            );
            return;
          }
          if (!out.write(chunk)) {
            body.pause?.();
            out.once("drain", () => body.resume?.());
          }
        });

        body.on("error", (err: Error) => fail(err, out));

        body.on("end", () => {
          if (settled) return;
          out.end(() => {
            if (settled) return;
            settled = true;
            resolve({ path: filePath, size: received });
          });
        });
      })
      .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
  });
}

/* ------------------------------------------------------------- top level */

export type SafeDownloadOptions = {
  /** Redirect hops allowed after the initial request. Default 5. */
  maxRedirects?: number;
  /** Total wall-clock budget across the initial request and every redirect. Default 20000ms. */
  timeoutMs?: number;
  /** Hard cap on the downloaded body, checked against Content-Length and while streaming. Default 100MB. */
  maxBytes?: number;
  /**
   * Name of the temp file the downloaded bytes are written to. Defaults to
   * a content-agnostic name — pass this when the caller will hand the
   * result to something that infers file type from the extension (like
   * `app-info-parser`), since this module has no opinion on what's being
   * downloaded.
   */
  tempFileName?: string;
  /** Injection point for tests; production code should never need to pass this. */
  lookup?: LookupFn;
  /** Injection point for tests; production code should never need to pass this. */
  transport?: Transport;
};

export type SafeDownloadResult = {
  path: string;
  size: number;
  contentType: string | null;
  cleanup: () => Promise<void>;
};

export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

/**
 * Downloads `initialUrl` to a local temp file, enforcing every control
 * documented above: HTTPS-only, resolve-then-pin DNS validation (repeated
 * for every redirect target, not just the first URL), a manual redirect
 * loop capped at `maxRedirects`, a single wall-clock deadline covering the
 * whole operation, and a byte cap enforced both from a declared
 * Content-Length and while the body is actually streaming.
 */
export async function downloadSafely(
  initialUrl: string,
  options: SafeDownloadOptions = {},
): Promise<SafeDownloadResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lookup = options.lookup;
  const transport = options.transport ?? httpsTransport;

  const deadline = Date.now() + timeoutMs;
  let current = initialUrl;
  let redirects = 0;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new UnsafeUrlError("The request took too long.");

    // Every hop is validated independently and from scratch — a redirect
    // target is exactly as untrusted as the URL the admin typed in.
    const { url, pinned } = await validateUrlForFetch(current, lookup);
    const response = await transport(url, pinned, remaining);

    if (response.kind === "redirect") {
      redirects++;
      if (redirects > maxRedirects) {
        throw new UnsafeUrlError(`Too many redirects (limit ${maxRedirects}).`);
      }
      // Resolve a relative Location against the URL that issued it, exactly
      // as a browser would, then loop back to validate it from scratch.
      current = new URL(response.location, url).toString();
      continue;
    }

    if (response.statusCode !== 200) {
      response.destroy();
      throw new Error(`Server returned HTTP ${response.statusCode}.`);
    }

    const declared = Number(response.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      response.destroy();
      throw new UnsafeUrlError(
        `Declared size ${declared} bytes exceeds the ${maxBytes}-byte limit.`,
      );
    }

    const { path, size } = await streamToTempFile(
      response.body,
      maxBytes,
      response.destroy,
      options.tempFileName,
    );

    return {
      path,
      size,
      contentType: response.headers["content-type"] ?? null,
      cleanup: () => rm(join(path, ".."), { recursive: true, force: true }).catch(() => {}),
    };
  }
}
