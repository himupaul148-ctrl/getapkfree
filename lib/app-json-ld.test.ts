import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { buildAppJsonLdData } from "./app-json-ld.ts";
import type { App, Version } from "./types.ts";

function baseApp(overrides: Partial<App> = {}): App {
  return {
    id: "app-1",
    name: "Tuner",
    slug: "tuner",
    package_name: "com.example.tuner",
    category: "Multimedia",
    description: "A simple, precise chromatic tuner.",
    icon_url: "https://example.com/icon.png",
    developer_name: "Example Dev",
    download_count: 100,
    created_at: "2026-01-01T00:00:00.000Z",
    screenshots: [],
    rating: null,
    rating_count: 0,
    source_type: "fdroid",
    external_url: null,
    hosted_locally: true,
    license: null,
    ...overrides,
  };
}

function baseVersion(overrides: Partial<Version> = {}): Version {
  return {
    id: "v1",
    app_id: "app-1",
    version_name: "1.0.0",
    version_code: 1,
    file_url: "https://example.com/tuner.apk",
    file_size: 1024,
    min_android_version: "9.0",
    changelog: null,
    scan_status: "clean",
    published: true,
    uploaded_at: "2026-01-01T00:00:00.000Z",
    scanned_at: "2026-01-01T00:00:00.000Z",
    permissions: [],
    target_sdk: null,
    ...overrides,
  };
}

group("buildAppJsonLdData — license (P2-1)", () => {
  test("a valid license is included as its canonical SPDX URL", () => {
    const data = buildAppJsonLdData(baseApp({ license: "MIT" }), baseVersion());
    assert.equal(data.license, "https://spdx.org/licenses/MIT.html");
  });

  test("a null license is omitted entirely, not present as null/empty", () => {
    const data = buildAppJsonLdData(baseApp({ license: null }), baseVersion());
    assert.equal("license" in data, true); // key present with value undefined pre-stringify...
    assert.equal(data.license, undefined);
    // ...and JSON.stringify (what actually ships) drops it entirely.
    const json = JSON.parse(JSON.stringify(data));
    assert.equal("license" in json, false);
  });

  test("a malformed/compound license value also fails closed to omitted, never a guessed URL", () => {
    const data = buildAppJsonLdData(baseApp({ license: "MIT OR Apache-2.0" }), baseVersion());
    const json = JSON.parse(JSON.stringify(data));
    assert.equal("license" in json, false);
  });
});

group("buildAppJsonLdData — target_sdk is never included (P2-1)", () => {
  test("target_sdk never appears in the output, present or not, valid or not", () => {
    for (const targetSdk of [null, 34, 0, -1]) {
      const data = buildAppJsonLdData(baseApp(), baseVersion({ target_sdk: targetSdk }));
      const json = JSON.parse(JSON.stringify(data));
      assert.equal("target_sdk" in json, false);
      assert.equal("targetSdk" in json, false);
    }
  });

  test("softwareRequirements is never used as a stand-in for target SDK", () => {
    const data = buildAppJsonLdData(baseApp(), baseVersion({ target_sdk: 34 }));
    assert.equal("softwareRequirements" in data, false);
  });
});

group("buildAppJsonLdData — existing fields unchanged", () => {
  test("every pre-existing field is still produced exactly as before, for an app with no license", () => {
    const app = baseApp({
      license: null,
      rating: 4.5,
      rating_count: 10,
    });
    const latest = baseVersion({
      version_name: "2.3.1",
      file_size: 2048,
      min_android_version: "10.0",
      file_url: "https://example.com/tuner-2.3.1.apk",
      uploaded_at: "2026-02-01T00:00:00.000Z",
    });

    const json = JSON.parse(JSON.stringify(buildAppJsonLdData(app, latest)));

    assert.deepEqual(json, {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Tuner",
      url: "https://getapkfree.vercel.app/app/tuner",
      applicationCategory: "MobileApplication",
      applicationSubCategory: "Multimedia",
      operatingSystem: "Android 10.0+",
      softwareVersion: "2.3.1",
      fileSize: "2048B",
      downloadUrl: "https://example.com/tuner-2.3.1.apk",
      datePublished: "2026-02-01T00:00:00.000Z",
      description: "A simple, precise chromatic tuner.",
      image: "https://example.com/icon.png",
      author: { "@type": "Organization", name: "Example Dev" },
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: 4.5, ratingCount: 10, bestRating: 5, worstRating: 1 },
    });
  });

  test("with a valid license, the output is identical to before plus exactly one new `license` key", () => {
    const app = baseApp({ license: null });
    const latest = baseVersion();

    const without = JSON.parse(JSON.stringify(buildAppJsonLdData(app, latest)));
    const withLicense = JSON.parse(
      JSON.stringify(buildAppJsonLdData({ ...app, license: "Apache-2.0" }, latest)),
    );

    assert.deepEqual(
      { ...withLicense, license: undefined },
      { ...without, license: undefined },
    );
    assert.equal(withLicense.license, "https://spdx.org/licenses/Apache-2.0.html");
    assert.equal("license" in without, false);
  });

  test("no published version at all: still produces a well-formed object with defaults, license unaffected", () => {
    const data = buildAppJsonLdData(baseApp({ license: "MIT" }), undefined);
    const json = JSON.parse(JSON.stringify(data));
    assert.equal(json.operatingSystem, "Android");
    assert.equal(json.license, "https://spdx.org/licenses/MIT.html");
    assert.equal("softwareVersion" in json, false);
  });
});

group("buildAppJsonLdData — permissions (P2-3)", () => {
  test("the latest version's permissions become a comma-joined Text value, using the existing short-label logic", () => {
    const data = buildAppJsonLdData(
      baseApp(),
      baseVersion({ permissions: ["android.permission.CAMERA", "android.permission.POST_NOTIFICATIONS"] }),
    );
    assert.equal(data.permissions, "Camera, Post Notifications");
  });

  test("a single permission still produces a plain Text value, not a one-element array", () => {
    const data = buildAppJsonLdData(baseApp(), baseVersion({ permissions: ["android.permission.INTERNET"] }));
    assert.equal(data.permissions, "Internet");
    assert.equal(typeof data.permissions, "string");
  });

  test("zero permissions on the latest version -> the property is omitted entirely, not an empty string", () => {
    const data = buildAppJsonLdData(baseApp(), baseVersion({ permissions: [] }));
    const json = JSON.parse(JSON.stringify(data));
    assert.equal("permissions" in json, false);
  });

  test("no published version at all -> permissions is omitted, not a crash", () => {
    const data = buildAppJsonLdData(baseApp(), undefined);
    const json = JSON.parse(JSON.stringify(data));
    assert.equal("permissions" in json, false);
  });

  test("historical versions' permissions are never consulted — only the latest/current version's", () => {
    // buildAppJsonLdData only ever receives one Version (the caller's
    // "latest"), so there is no historical-version data path to leak from —
    // this pins that the function signature itself enforces "current only".
    const data = buildAppJsonLdData(baseApp(), baseVersion({ permissions: ["android.permission.CAMERA"] }));
    assert.equal(data.permissions, "Camera");
  });
});

group("buildAppJsonLdData — releaseNotes (P2-3)", () => {
  test("a real, stored changelog on the latest version becomes releaseNotes verbatim", () => {
    const data = buildAppJsonLdData(baseApp(), baseVersion({ changelog: "Fixed a crash on startup." }));
    assert.equal(data.releaseNotes, "Fixed a crash on startup.");
  });

  test("a null changelog -> releaseNotes is omitted, never fabricated", () => {
    const data = buildAppJsonLdData(baseApp(), baseVersion({ changelog: null }));
    const json = JSON.parse(JSON.stringify(data));
    assert.equal("releaseNotes" in json, false);
  });

  test("a whitespace-only changelog counts as absent", () => {
    const data = buildAppJsonLdData(baseApp(), baseVersion({ changelog: "   " }));
    const json = JSON.parse(JSON.stringify(data));
    assert.equal("releaseNotes" in json, false);
  });

  test("surrounding whitespace on a real changelog is trimmed, not altered otherwise", () => {
    const data = buildAppJsonLdData(baseApp(), baseVersion({ changelog: "  Minor fixes.  " }));
    assert.equal(data.releaseNotes, "Minor fixes.");
  });

  test("no published version at all -> releaseNotes is omitted", () => {
    const data = buildAppJsonLdData(baseApp(), undefined);
    const json = JSON.parse(JSON.stringify(data));
    assert.equal("releaseNotes" in json, false);
  });
});
