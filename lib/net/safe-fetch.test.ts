import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { access } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  DEFAULT_MAX_REDIRECTS,
  UnsafeUrlError,
  assertHttpsUrl,
  downloadSafely,
  isBlockedAddress,
  resolvePinnedAddress,
  validateUrlForFetch,
  type LookupFn,
  type Transport,
} from "./safe-fetch.ts";

/**
 * Run with: npm test
 *
 * Everything here runs against the real validation code — the same
 * `assertHttpsUrl` / `resolvePinnedAddress` / `validateUrlForFetch` that
 * production traffic goes through — with only DNS (`lookup`) and the wire
 * transport swapped for fakes. No real network or DNS is touched, and
 * nothing here can reach an actual internal address even if a bug let it
 * try, because the fakes never make a real connection at all.
 */

group("assertHttpsUrl — scheme and credentials", () => {
  test("accepts a plain https URL", () => {
    const url = assertHttpsUrl("https://example.com/app.apk");
    assert.equal(url.hostname, "example.com");
  });

  for (const scheme of ["http", "ftp", "file", "data", "javascript"]) {
    test(`rejects ${scheme}:`, () => {
      const raw =
        scheme === "data"
          ? "data:text/plain;base64,aGVsbG8="
          : scheme === "javascript"
            ? "javascript:alert(1)"
            : scheme === "file"
              ? "file:///etc/passwd"
              : `${scheme}://example.com/app.apk`;
      assert.throws(() => assertHttpsUrl(raw), UnsafeUrlError);
    });
  }

  test("rejects a malformed URL string", () => {
    assert.throws(() => assertHttpsUrl("not a url"), UnsafeUrlError);
  });

  test("rejects embedded credentials", () => {
    assert.throws(
      () => assertHttpsUrl("https://user:pass@example.com/app.apk"),
      UnsafeUrlError,
    );
  });
});

group("isBlockedAddress — the block-list itself", () => {
  const blockedIpv4 = [
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.5",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
  ];
  for (const ip of blockedIpv4) {
    test(`blocks IPv4 ${ip}`, () => assert.equal(isBlockedAddress(ip, 4), true));
  }

  const blockedIpv6 = [
    "::1",
    "::",
    "fe80::1", // link-local
    "fd00::1", // unique local (covers fd00:ec2::254-style cloud metadata)
    "fc00::1",
    "ff02::1", // multicast
  ];
  for (const ip of blockedIpv6) {
    test(`blocks IPv6 ${ip}`, () => assert.equal(isBlockedAddress(ip, 6), true));
  }

  test("blocks an IPv4-mapped-IPv6 loopback", () => {
    assert.equal(isBlockedAddress("::ffff:127.0.0.1", 6), true);
  });

  test("allows a real public IPv4 address", () => {
    assert.equal(isBlockedAddress("8.8.8.8", 4), false);
  });

  test("allows a real public IPv6 address", () => {
    assert.equal(isBlockedAddress("2001:4860:4860::8888", 6), false);
  });
});

group("resolvePinnedAddress — hostname rules and DNS validation", () => {
  const unreachableLookup: LookupFn = async () => {
    throw new Error("lookup should not have been called for a pre-blocked hostname");
  };

  for (const host of [
    "localhost",
    "LOCALHOST",
    "foo.localhost",
    "printer.local",
    "app.internal",
    "metadata.google.internal",
  ]) {
    test(`rejects "${host}" without ever calling DNS`, async () => {
      await assert.rejects(
        resolvePinnedAddress(host, unreachableLookup),
        UnsafeUrlError,
      );
    });
  }

  for (const ip of ["127.0.0.1", "169.254.169.254", "10.0.0.5", "::1"]) {
    test(`rejects the IP literal ${ip} directly, without DNS`, async () => {
      await assert.rejects(resolvePinnedAddress(ip, unreachableLookup), UnsafeUrlError);
    });
  }

  test("allows a public IP literal directly, without DNS", async () => {
    const pinned = await resolvePinnedAddress("8.8.8.8", unreachableLookup);
    assert.equal(pinned.address, "8.8.8.8");
  });

  test("a hostname resolving to a public address is allowed", async () => {
    const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    const pinned = await resolvePinnedAddress("good.example", lookup);
    assert.equal(pinned.address, "93.184.216.34");
  });

  test("a hostname resolving to a private address is rejected", async () => {
    const lookup: LookupFn = async () => [{ address: "10.0.0.9", family: 4 }];
    await assert.rejects(resolvePinnedAddress("evil.example", lookup), UnsafeUrlError);
  });

  test("a hostname resolving to multiple addresses, one private, is rejected", async () => {
    const lookup: LookupFn = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    await assert.rejects(
      resolvePinnedAddress("mixed.example", lookup),
      UnsafeUrlError,
      "one unsafe address must reject the whole resolution, not just be skipped",
    );
  });

  test("a hostname that fails to resolve at all is rejected", async () => {
    const lookup: LookupFn = async () => [];
    await assert.rejects(resolvePinnedAddress("nowhere.example", lookup), UnsafeUrlError);
  });
});

group("validateUrlForFetch — the composed per-hop check", () => {
  test("rejects http even when the host would resolve safely", async () => {
    const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    await assert.rejects(
      validateUrlForFetch("http://good.example/app.apk", lookup),
      UnsafeUrlError,
    );
  });

  test("accepts https with a safely-resolving host", async () => {
    const lookup: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
    const { url, pinned } = await validateUrlForFetch(
      "https://good.example/app.apk",
      lookup,
    );
    assert.equal(url.hostname, "good.example");
    assert.equal(pinned.address, "93.184.216.34");
  });
});

/* -------------------------------------------------- downloadSafely tests */

type Route =
  | { type: "redirect"; location: string }
  | { type: "body"; status?: number; headers?: Record<string, string>; chunks: Buffer[] };

function fakeTransport(routes: Map<string, Route>, calls?: { count: number }): Transport {
  return async (url) => {
    if (calls) calls.count++;
    const route = routes.get(url.href);
    if (!route) throw new Error(`no fake route registered for ${url.href}`);
    if (route.type === "redirect") return { kind: "redirect", location: route.location };

    const body = Readable.from(route.chunks);
    return {
      kind: "body",
      statusCode: route.status ?? 200,
      headers: route.headers ?? {},
      body,
      destroy: () => body.destroy(),
    };
  };
}

const PUBLIC_LOOKUP: LookupFn = async () => [{ address: "93.184.216.34", family: 4 }];

group("downloadSafely — redirect handling", () => {
  test("follows a safe redirect to a safe destination", async () => {
    const routes = new Map<string, Route>([
      [
        "https://start.example/a",
        { type: "redirect", location: "https://start.example/b" },
      ],
      [
        "https://start.example/b",
        { type: "body", chunks: [Buffer.from("apk-bytes")] },
      ],
    ]);

    const result = await downloadSafely("https://start.example/a", {
      lookup: PUBLIC_LOOKUP,
      transport: fakeTransport(routes),
    });

    assert.equal(result.size, Buffer.from("apk-bytes").length);
    await result.cleanup();
  });

  test("rejects a redirect to localhost", async () => {
    const routes = new Map<string, Route>([
      [
        "https://start.example/a",
        { type: "redirect", location: "https://localhost/steal" },
      ],
    ]);
    await assert.rejects(
      downloadSafely("https://start.example/a", {
        lookup: PUBLIC_LOOKUP,
        transport: fakeTransport(routes),
      }),
      UnsafeUrlError,
    );
  });

  test("rejects a redirect to a private IP literal", async () => {
    const routes = new Map<string, Route>([
      [
        "https://start.example/a",
        { type: "redirect", location: "https://10.0.0.5/steal" },
      ],
    ]);
    await assert.rejects(
      downloadSafely("https://start.example/a", {
        lookup: PUBLIC_LOOKUP,
        transport: fakeTransport(routes),
      }),
      UnsafeUrlError,
    );
  });

  test("rejects a redirect downgrading to http", async () => {
    const routes = new Map<string, Route>([
      [
        "https://start.example/a",
        { type: "redirect", location: "http://start.example/b" },
      ],
    ]);
    await assert.rejects(
      downloadSafely("https://start.example/a", {
        lookup: PUBLIC_LOOKUP,
        transport: fakeTransport(routes),
      }),
      UnsafeUrlError,
    );
  });

  test("rejects more than the configured redirect limit", async () => {
    const routes = new Map<string, Route>();
    const hops = DEFAULT_MAX_REDIRECTS + 3;
    for (let i = 0; i < hops; i++) {
      routes.set(`https://chain.example/${i}`, {
        type: "redirect",
        location: `https://chain.example/${i + 1}`,
      });
    }
    routes.set(`https://chain.example/${hops}`, {
      type: "body",
      chunks: [Buffer.from("x")],
    });

    await assert.rejects(
      downloadSafely("https://chain.example/0", {
        lookup: PUBLIC_LOOKUP,
        transport: fakeTransport(routes),
      }),
      /Too many redirects/,
    );
  });
});

group("downloadSafely — size limits", () => {
  test("rejects a declared Content-Length over the limit without reading the body", async () => {
    const routes = new Map<string, Route>([
      [
        "https://start.example/big",
        {
          type: "body",
          headers: { "content-length": String(200 * 1024 * 1024) },
          chunks: [Buffer.from("irrelevant")],
        },
      ],
    ]);
    await assert.rejects(
      downloadSafely("https://start.example/big", {
        lookup: PUBLIC_LOOKUP,
        transport: fakeTransport(routes),
        maxBytes: 100 * 1024 * 1024,
      }),
      UnsafeUrlError,
    );
  });

  test("aborts a stream that exceeds the limit even without Content-Length", async () => {
    const routes = new Map<string, Route>([
      [
        "https://start.example/stream",
        {
          type: "body",
          chunks: [Buffer.alloc(6, 1), Buffer.alloc(6, 2)], // 12 bytes total
        },
      ],
    ]);
    await assert.rejects(
      downloadSafely("https://start.example/stream", {
        lookup: PUBLIC_LOOKUP,
        transport: fakeTransport(routes),
        maxBytes: 10, // smaller than the 12 bytes the fake body sends
      }),
      UnsafeUrlError,
    );
  });

  test("accepts a body under the limit and cleans up after itself", async () => {
    const routes = new Map<string, Route>([
      [
        "https://start.example/ok",
        { type: "body", chunks: [Buffer.from("a small valid apk")] },
      ],
    ]);
    const result = await downloadSafely("https://start.example/ok", {
      lookup: PUBLIC_LOOKUP,
      transport: fakeTransport(routes),
      maxBytes: 1024,
    });

    assert.equal(result.size, Buffer.from("a small valid apk").length);
    await access(result.path); // file exists before cleanup

    await result.cleanup();
    await assert.rejects(access(result.path), "temp file must be removed after cleanup");
  });
});

group("downloadSafely — timeout", () => {
  test("rejects immediately once the deadline has already passed", async () => {
    let transportCalled = false;
    const transport: Transport = async () => {
      transportCalled = true;
      throw new Error("transport should never be invoked past the deadline");
    };

    await assert.rejects(
      downloadSafely("https://start.example/whatever", {
        lookup: PUBLIC_LOOKUP,
        transport,
        timeoutMs: -1,
      }),
      /took too long/,
    );
    assert.equal(transportCalled, false);
  });
});
