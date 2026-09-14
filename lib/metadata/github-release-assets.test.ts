import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  fetchLatestReleaseAssets,
  findApkAssets,
  isApkAsset,
  type GithubFetchFn,
  type GithubFetchResponse,
  type GithubReleaseAsset,
} from "./github-discovery.ts";

/**
 * Run with: npm test — a fake, fixture-driven GithubFetchFn throughout,
 * never a real network call. Mirrors github-discovery.test.ts's own
 * fakeFetch()/jsonResponse() pattern.
 */

function jsonResponse(status: number, body: unknown): GithubFetchResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function fakeFetch(routes: { match: string; response: GithubFetchResponse }[]): GithubFetchFn {
  return async (url: string) => {
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`no fixture route for ${url}`);
    return route.response;
  };
}

function rawAsset(overrides: Record<string, unknown> = {}) {
  return {
    name: "app-release.apk",
    browser_download_url: "https://github.com/owner/repo/releases/download/1.0/app-release.apk",
    content_type: "application/vnd.android.package-archive",
    size: 12_345,
    ...overrides,
  };
}

function asset(overrides: Partial<GithubReleaseAsset> = {}): GithubReleaseAsset {
  return {
    name: "app-release.apk",
    browserDownloadUrl: "https://github.com/owner/repo/releases/download/1.0/app-release.apk",
    contentType: "application/vnd.android.package-archive",
    size: 12_345,
    ...overrides,
  };
}

/* --------------------------------------------------------------- isApkAsset */

group("isApkAsset", () => {
  test("identifies an APK by content type", () => {
    assert.equal(isApkAsset(asset({ contentType: "application/vnd.android.package-archive", name: "x.bin" })), true);
  });

  test("identifies an APK by filename fallback when content type is generic", () => {
    assert.equal(isApkAsset(asset({ contentType: "application/octet-stream", name: "release.apk" })), true);
    assert.equal(isApkAsset(asset({ contentType: "application/octet-stream", name: "RELEASE.APK" })), true);
  });

  test("does not treat an arbitrary ZIP or source archive as an APK", () => {
    assert.equal(isApkAsset(asset({ contentType: "application/zip", name: "source-code.zip" })), false);
    assert.equal(isApkAsset(asset({ contentType: "application/octet-stream", name: "checksums.txt" })), false);
    assert.equal(isApkAsset(asset({ contentType: null, name: "app.apk.zip" })), false);
  });
});

group("findApkAssets", () => {
  test("filters a release's assets down to APK-shaped ones only, preserving order", () => {
    const assets = [
      asset({ name: "checksums.txt", contentType: "text/plain" }),
      asset({ name: "app-arm64.apk", contentType: "application/octet-stream" }),
      asset({ name: "source.zip", contentType: "application/zip" }),
      asset({ name: "app-armeabi.apk", contentType: "application/vnd.android.package-archive" }),
    ];
    const found = findApkAssets(assets);
    assert.deepEqual(found.map((a) => a.name), ["app-arm64.apk", "app-armeabi.apk"]);
  });

  test("an empty assets array yields an empty result, not an error", () => {
    assert.deepEqual(findApkAssets([]), []);
  });
});

/* ------------------------------------------------------- fetchLatestReleaseAssets */

group("fetchLatestReleaseAssets", () => {
  test("a repository with no releases (404 on /releases/latest) resolves to a normal null, not an error", async () => {
    const fetchFn = fakeFetch([{ match: "/releases/latest", response: jsonResponse(404, { message: "Not Found" }) }]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value, null);
  });

  test("a release with no assets at all still resolves, with an empty assets array", async () => {
    const fetchFn = fakeFetch([
      { match: "/releases/latest", response: jsonResponse(200, { tag_name: "1.0", assets: [] }) },
    ]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, { tagName: "1.0", assets: [] });
  });

  test("a release with assets but no APK still resolves — findApkAssets() is the caller's job to filter", async () => {
    const fetchFn = fakeFetch([
      {
        match: "/releases/latest",
        response: jsonResponse(200, { tag_name: "1.0", assets: [rawAsset({ name: "notes.txt", content_type: "text/plain" })] }),
      },
    ]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.value);
      assert.equal(findApkAssets(result.value!.assets).length, 0);
    }
  });

  test("one APK asset is parsed with all fields intact", async () => {
    const fetchFn = fakeFetch([
      { match: "/releases/latest", response: jsonResponse(200, { tag_name: "3.3.0", assets: [rawAsset()] }) },
    ]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value?.tagName, "3.3.0");
      assert.deepEqual(result.value?.assets, [
        {
          name: "app-release.apk",
          browserDownloadUrl: "https://github.com/owner/repo/releases/download/1.0/app-release.apk",
          contentType: "application/vnd.android.package-archive",
          size: 12_345,
        },
      ]);
    }
  });

  test("multiple APK assets are all returned — this function never picks one", async () => {
    const fetchFn = fakeFetch([
      {
        match: "/releases/latest",
        response: jsonResponse(200, {
          tag_name: "2.0",
          assets: [
            rawAsset({ name: "app-arm64-v8a.apk" }),
            rawAsset({ name: "app-armeabi-v7a.apk" }),
          ],
        }),
      },
    ]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value?.assets.length, 2);
      assert.equal(findApkAssets(result.value!.assets).length, 2);
    }
  });

  test("an asset identified only by filename (generic content type) is still returned intact", async () => {
    const fetchFn = fakeFetch([
      {
        match: "/releases/latest",
        response: jsonResponse(200, {
          tag_name: "1.0",
          assets: [rawAsset({ name: "app.apk", content_type: "application/octet-stream" })],
        }),
      },
    ]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, true);
    if (result.ok) {
      const apk = findApkAssets(result.value!.assets);
      assert.equal(apk.length, 1);
      assert.equal(apk[0].name, "app.apk");
    }
  });

  test("an asset missing a name or download URL is silently dropped, not thrown", async () => {
    const fetchFn = fakeFetch([
      {
        match: "/releases/latest",
        response: jsonResponse(200, {
          tag_name: "1.0",
          assets: [{ content_type: "application/vnd.android.package-archive", size: 10 }, rawAsset()],
        }),
      },
    ]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value?.assets.length, 1);
  });

  test("a non-404 HTTP error is a real DiscoveryError, not a silent null", async () => {
    const fetchFn = fakeFetch([{ match: "/releases/latest", response: jsonResponse(500, { message: "server error" }) }]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "http_error");
  });

  test("rate limiting is reported distinctly", async () => {
    const fetchFn = fakeFetch([
      { match: "/releases/latest", response: jsonResponse(403, { message: "API rate limit exceeded" }) },
    ]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "rate_limited");
  });

  test("a response with no `assets` array at all is a malformed_response error", async () => {
    const fetchFn = fakeFetch([{ match: "/releases/latest", response: jsonResponse(200, { tag_name: "1.0" }) }]);
    const result = await fetchLatestReleaseAssets(fetchFn, "owner/repo");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "malformed_response");
  });
});
