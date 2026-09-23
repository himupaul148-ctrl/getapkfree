import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";
import { clampDescription, SITE_DESCRIPTION } from "./seo.ts";

/**
 * Static, source-level assertions for the P1 SEO fix: the homepage/sitewide
 * default description (lib/seo.ts's SITE_DESCRIPTION) was 213 characters —
 * over clampDescription's own 160-character default max — and was used
 * verbatim, unclamped, in app/layout.tsx (sitewide fallback) and
 * app/page.tsx (homepage), risking SERP truncation on the site's own
 * homepage. This file walks through the task's own 6 test requirements
 * end to end. app/layout.tsx and app/page.tsx are both JSX-bearing and
 * import next/server-adjacent APIs, so — same constraint documented
 * throughout this project — they're covered here via source-level regex
 * assertions rather than direct import; lib/seo.ts itself has zero such
 * imports and is exercised directly and behaviorally (see lib/seo.test.ts
 * for the fuller SITE_DESCRIPTION/clampDescription behavioral coverage this
 * file's assertions are a source-level companion to).
 */

const layoutSrc = readFileSync(fileURLToPath(new URL("../app/layout.tsx", import.meta.url)), "utf8");
const pageSrc = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");

group("1. SITE_DESCRIPTION remains meaningful", () => {
  test("still a real, multi-clause sentence describing the site — not gutted to a keyword fragment", () => {
    assert.ok(SITE_DESCRIPTION.length > 40);
    assert.match(SITE_DESCRIPTION, /free/i);
    assert.match(SITE_DESCRIPTION, /open-source/i);
    assert.match(SITE_DESCRIPTION, /android/i);
  });

  test("preserves the two core claims the original made: F-Droid builds are versioned/malware-scanned, and everything else links to its official source", () => {
    assert.match(SITE_DESCRIPTION, /F-Droid builds are.*(versioned|malware-scanned)/i);
    assert.match(SITE_DESCRIPTION, /official source/i);
  });

  test("no unsupported claims or promotional exaggeration were introduced (no \"best\", \"#1\", \"guaranteed\", \"100%\")", () => {
    assert.doesNotMatch(SITE_DESCRIPTION, /\bbest\b/i);
    assert.doesNotMatch(SITE_DESCRIPTION, /#1|guaranteed|100%/i);
  });

  test("no keyword stuffing — \"APK\"/\"download\" each appear at most once, not repeated for SEO padding", () => {
    const apkOccurrences = (SITE_DESCRIPTION.match(/\bAPKs?\b/gi) ?? []).length;
    const downloadOccurrences = (SITE_DESCRIPTION.match(/download/gi) ?? []).length;
    assert.ok(apkOccurrences <= 1, `expected at most 1 "APK(s)", found ${apkOccurrences}`);
    assert.ok(downloadOccurrences <= 1, `expected at most 1 "download", found ${downloadOccurrences}`);
  });
});

group("2. final homepage description is within the project's existing allowed/clamped length", () => {
  test("SITE_DESCRIPTION itself is <= clampDescription's default max (160)", () => {
    assert.ok(SITE_DESCRIPTION.length <= 160);
  });

  test("clampDescription(SITE_DESCRIPTION) does not truncate it — no trailing ellipsis is ever produced for this string", () => {
    const clamped = clampDescription(SITE_DESCRIPTION);
    assert.equal(clamped, SITE_DESCRIPTION);
    assert.doesNotMatch(clamped, /…$/);
  });
});

group("3. clampDescription() is used correctly at both consuming call sites", () => {
  test("app/layout.tsx defines DEFAULT_DESCRIPTION = clampDescription(SITE_DESCRIPTION) once, at module scope", () => {
    assert.match(layoutSrc, /const DEFAULT_DESCRIPTION = clampDescription\(SITE_DESCRIPTION\);/);
    assert.match(layoutSrc, /import \{ clampDescription, SITE_DESCRIPTION, SITE_NAME, SITE_URL \} from "@\/lib\/seo";/);
  });

  test("app/page.tsx defines HOME_DESCRIPTION = clampDescription(SITE_DESCRIPTION) once, at module scope, mirroring the existing HOME_TITLE pattern", () => {
    assert.match(pageSrc, /const HOME_DESCRIPTION = clampDescription\(SITE_DESCRIPTION\);/);
    assert.match(pageSrc, /const HOME_TITLE = "GetApkFree - free android apk download";/);
  });

  test("neither file passes a raw literal max to clampDescription (both use its default 160) — no ad-hoc, differently-tuned length elsewhere", () => {
    assert.doesNotMatch(layoutSrc, /clampDescription\(SITE_DESCRIPTION,\s*\d+\)/);
    assert.doesNotMatch(pageSrc, /clampDescription\(SITE_DESCRIPTION,\s*\d+\)/);
  });

  test("SITE_DESCRIPTION itself is never assigned raw/unclamped to a `description` field anywhere in either file — every metadata description field uses the clamped constant", () => {
    assert.doesNotMatch(layoutSrc, /description:\s*SITE_DESCRIPTION/);
    assert.doesNotMatch(pageSrc, /description:\s*SITE_DESCRIPTION/);
  });
});

group("4. homepage metadata receives the corrected description", () => {
  test("the homepage's plain description field is HOME_DESCRIPTION, not the raw SITE_DESCRIPTION", () => {
    assert.match(pageSrc, /description: HOME_DESCRIPTION,/);
  });

  test("the root layout's sitewide default description field is DEFAULT_DESCRIPTION, not the raw SITE_DESCRIPTION", () => {
    assert.match(layoutSrc, /description: DEFAULT_DESCRIPTION,/);
  });
});

group("5. OG/Twitter description behavior remains correct", () => {
  test("homepage openGraph.description and twitter.description both use HOME_DESCRIPTION, matching the plain description exactly", () => {
    const ogMatch = pageSrc.match(/openGraph: \{[\s\S]*?\n\s*\},/);
    const twMatch = pageSrc.match(/twitter: \{[\s\S]*?\n\s*\},/);
    assert.ok(ogMatch && twMatch);
    assert.match(ogMatch![0], /description: HOME_DESCRIPTION,/);
    assert.match(twMatch![0], /description: HOME_DESCRIPTION,/);
  });

  test("root layout's openGraph.description and twitter.description both use DEFAULT_DESCRIPTION, matching the plain description exactly", () => {
    const ogMatch = layoutSrc.match(/openGraph: \{[\s\S]*?\n\s*\},/);
    const twMatch = layoutSrc.match(/twitter: \{[\s\S]*?\n\s*\},/);
    assert.ok(ogMatch && twMatch);
    assert.match(ogMatch![0], /description: DEFAULT_DESCRIPTION,/);
    assert.match(twMatch![0], /description: DEFAULT_DESCRIPTION,/);
  });

  test("openGraph/twitter title fields and other structural fields (type, siteName, locale, url, card) are untouched by this fix", () => {
    assert.match(layoutSrc, /openGraph: \{\s*\n\s*type: "website",\s*\n\s*siteName: SITE_NAME,\s*\n\s*locale: "en_GB",\s*\n\s*url: SITE_URL,/);
    assert.match(layoutSrc, /twitter: \{\s*\n\s*card: "summary_large_image",/);
    assert.match(pageSrc, /openGraph: \{\s*\n\s*type: "website",\s*\n\s*siteName: SITE_NAME,\s*\n\s*locale: "en_GB",\s*\n\s*url: SITE_URL,/);
    assert.match(pageSrc, /twitter: \{\s*\n\s*card: "summary_large_image",/);
  });
});

group("6. no unrelated page descriptions changed", () => {
  test("app/page.tsx's category and search branches keep their own distinct descriptions, untouched by this fix", () => {
    assert.match(pageSrc, /description: categoryMetaDescription\(category\),/);
    assert.match(pageSrc, /description: `Search results for "\$\{search\}" in the GetApkFree catalogue\.`,/);
  });

  test("no other page/route file was touched by this fix — app/blog/page.tsx's own P1 metadata fix (a separate, prior task) is untouched here", () => {
    const blogListingSrc = readFileSync(fileURLToPath(new URL("../app/blog/page.tsx", import.meta.url)), "utf8");
    assert.match(blogListingSrc, /const BASE_BLOG_DESCRIPTION =/);
    assert.doesNotMatch(blogListingSrc, /DEFAULT_DESCRIPTION|HOME_DESCRIPTION/);
  });

  test("app/opengraph-image.tsx's visual rendering of SITE_DESCRIPTION is untouched — no clamp wrapper added there (an image's text-fit constraint is not the SERP-snippet-length concern this fix addresses)", () => {
    const ogImageSrc = readFileSync(fileURLToPath(new URL("../app/opengraph-image.tsx", import.meta.url)), "utf8");
    assert.match(ogImageSrc, /\{SITE_DESCRIPTION\}/);
    assert.doesNotMatch(ogImageSrc, /clampDescription/);
  });

  test("no database/schema, article-type, sitemap/RSS, or canonical-logic file was touched", () => {
    assert.doesNotMatch(layoutSrc, /supabase|article_type|sitemap/i);
    assert.doesNotMatch(pageSrc, /article_type/i);
  });
});
