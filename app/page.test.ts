import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * app/page.tsx imports next/server-adjacent App Router APIs (generateMetadata's
 * Metadata type, etc.) and cannot be rendered under plain `node --test` — same
 * constraint documented throughout this project. Static, source-level
 * assertions proving: the homepage's plain title changed to the new text;
 * openGraph/twitter were given a homepage-only override (not a layout-level
 * change) with every other field restated so nothing is silently dropped by
 * Next's shallow metadata merge; and the category/search branches of the same
 * generateMetadata() are untouched.
 */
const src = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

const OLD_TITLE = "GetApkFree — Free, Open-Source Android APK Downloads";

group("homepage title", () => {
  test("the homepage branch's plain title is the new text", () => {
    assert.match(src, /const HOME_TITLE = "GetApkFree - free android apk download";/);
    assert.match(src, /title: HOME_TITLE,/);
  });

  test("the old title string no longer appears anywhere in this file", () => {
    assert.doesNotMatch(src, new RegExp(OLD_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

group("homepage openGraph/twitter override", () => {
  test("openGraph.title and twitter.title both use the same HOME_TITLE constant", () => {
    assert.match(src, /openGraph: \{[\s\S]*?title: HOME_TITLE,[\s\S]*?\},\s*twitter: \{/);
    assert.match(src, /twitter: \{[\s\S]*?title: HOME_TITLE,/);
  });

  test("openGraph restates type/siteName/locale/url/description — nothing is silently dropped by the shallow merge", () => {
    const ogMatch = src.match(/openGraph: \{[\s\S]*?\n\s*\},/);
    assert.ok(ogMatch, "openGraph block not found");
    const og = ogMatch![0];
    assert.match(og, /type: "website"/);
    assert.match(og, /siteName: SITE_NAME/);
    assert.match(og, /locale: "en_GB"/);
    assert.match(og, /url: SITE_URL/);
    assert.match(og, /description: SITE_DESCRIPTION/);
  });

  test("twitter restates card/description alongside the new title", () => {
    const twMatch = src.match(/twitter: \{[\s\S]*?\n\s*\},/);
    assert.ok(twMatch, "twitter block not found");
    assert.match(twMatch![0], /card: "summary_large_image"/);
    assert.match(twMatch![0], /description: SITE_DESCRIPTION/);
  });
});

group("scope: category and search branches are untouched", () => {
  test("category branch still sets its own distinct title, unrelated to HOME_TITLE", () => {
    assert.match(src, /\$\{category\} Apps — Page \$\{page\} \| Free Open-Source APKs/);
    assert.match(src, /\$\{category\} Apps — Free Open-Source APKs/);
  });

  test("search branch still sets its own distinct title", () => {
    assert.match(src, /title: `Search: \$\{search\}`,/);
  });

  test("category and search branches do not set openGraph/twitter (so they still inherit the layout's, unaffected by this change)", () => {
    const categoryBlock = src.slice(src.indexOf("if (category) {"), src.indexOf("if (search) {"));
    const searchBlock = src.slice(src.indexOf("if (search) {"), src.indexOf("return {\n    title: HOME_TITLE"));
    assert.doesNotMatch(categoryBlock, /openGraph:/);
    assert.doesNotMatch(categoryBlock, /twitter:/);
    assert.doesNotMatch(searchBlock, /openGraph:/);
    assert.doesNotMatch(searchBlock, /twitter:/);
  });

  test("canonical and robots logic for the homepage branch are unchanged", () => {
    assert.match(src, /alternates: \{ canonical: absolute\("\/"\) \},/);
    assert.match(src, /robots: \{ index: !filtered, follow: true \},/);
  });
});

group("app/layout.tsx is untouched by this change", () => {
  const layoutSrc = readFileSync(fileURLToPath(new URL("./layout.tsx", import.meta.url)), "utf8");

  test("the root layout's title.default and openGraph/twitter still hold the original text", () => {
    assert.match(layoutSrc, /default: "GetApkFree — Free, Open-Source Android APK Downloads",/);
    assert.match(layoutSrc, /openGraph: \{[\s\S]*?title: "GetApkFree — Free, Open-Source Android APK Downloads",/);
    assert.match(layoutSrc, /twitter: \{[\s\S]*?title: "GetApkFree — Free, Open-Source Android APK Downloads",/);
  });
});
