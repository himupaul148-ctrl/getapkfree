import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { parsePlayUrl } from "./play-url.ts";

group("parsePlayUrl — valid Play URLs", () => {
  test("a plain details URL extracts the package id", () => {
    const result = parsePlayUrl(
      "https://play.google.com/store/apps/details?id=com.example.app",
    );
    assert.deepEqual(result, {
      ok: true,
      url: "https://play.google.com/store/apps/details?id=com.example.app",
      packageName: "com.example.app",
    });
  });

  test("extra query params (hl, gl) do not affect extraction", () => {
    const result = parsePlayUrl(
      "https://play.google.com/store/apps/details?id=com.example.app&hl=en&gl=US",
    );
    assert.equal(result.ok, true);
    assert.equal((result as { packageName: string }).packageName, "com.example.app");
  });

  test("a leading www. is tolerated", () => {
    const result = parsePlayUrl(
      "https://www.play.google.com/store/apps/details?id=com.example.app",
    );
    assert.equal(result.ok, true);
  });

  test("a trailing slash on the details path is tolerated", () => {
    const result = parsePlayUrl(
      "https://play.google.com/store/apps/details/?id=com.example.app",
    );
    assert.equal(result.ok, true);
  });
});

group("parsePlayUrl — rejections", () => {
  test("a malformed URL is rejected", () => {
    const result = parsePlayUrl("not a url at all");
    assert.equal(result.ok, false);
  });

  test("a non-Play host is rejected even if it mentions play.google.com in the path", () => {
    const result = parsePlayUrl(
      "https://evil.example/play.google.com/store/apps/details?id=com.example.app",
    );
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /not a play\.google\.com URL/);
  });

  test("a Play host but the wrong path (e.g. the search page) is rejected", () => {
    const result = parsePlayUrl("https://play.google.com/store/search?q=weather");
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /not a Play Store app-details URL/);
  });

  test("a Play details URL with no ?id= is rejected", () => {
    const result = parsePlayUrl("https://play.google.com/store/apps/details");
    assert.equal(result.ok, false);
    assert.match((result as { reason: string }).reason, /no \?id=/);
  });

  test("an F-Droid URL is rejected — this tool is Play-only", () => {
    const result = parsePlayUrl("https://f-droid.org/en/packages/com.example.app/");
    assert.equal(result.ok, false);
  });

  test("a subdomain of play.google.com's own domain family that isn't the real host is rejected", () => {
    const result = parsePlayUrl(
      "https://play.google.com.evil.example/store/apps/details?id=com.example.app",
    );
    assert.equal(result.ok, false);
  });
});
