import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against app/app/[slug]/page.tsx — it
 * can't be imported directly under plain `node --test` (it transitively
 * pulls in lib/catalogue.ts's `next/cache` import, the same constraint
 * documented throughout this project, e.g. lib/search-route.test.ts for the
 * same reason against a different route). This confirms the wiring for the
 * fix: an app with no currently published version (never published yet, or
 * unpublished after the fact — e.g. kinemaster-premium-apk, capcut-premium
 * after the Step 3 catalogue cleanup) must now 404 on its direct URL
 * instead of rendering a normal-looking page with a "no builds yet"
 * message.
 */

const src = readFileSync(
  fileURLToPath(new URL("../app/app/[slug]/page.tsx", import.meta.url)),
  "utf8",
);

function bodyOf(fnName: string): string {
  const match = src.match(new RegExp(`export (?:default )?async function ${fnName}[\\s\\S]*?\\n}`));
  assert.ok(match, `${fnName} not found in app/app/[slug]/page.tsx`);
  return match![0];
}

group("generateMetadata — 404s for an app with no published version", () => {
  const body = bodyOf("generateMetadata");

  test("still 404s (via a not-found metadata response) when the app row itself does not exist", () => {
    assert.match(body, /if \(!app\) return \{ title: "App not found", robots: \{ index: false \} \};/);
  });

  test("calls notFound\\(\\) when there is no published version, after fetching versions", () => {
    const afterFetch = body.slice(body.indexOf("getPublishedVersions(app.id)"));
    assert.match(afterFetch, /if \(versions\.length === 0\) notFound\(\);/);
  });

  test("the notFound() guard runs before `latest` is read, not after", () => {
    const guardIndex = body.indexOf("if (versions.length === 0) notFound();");
    const latestIndex = body.indexOf("const latest = versions[0];");
    assert.ok(guardIndex > -1 && latestIndex > -1, "expected both the guard and `latest` assignment to be present");
    assert.ok(guardIndex < latestIndex, "expected the notFound() guard to run before `latest` is read");
  });
});

group("AppDetailPage (the page body) — 404s for an app with no published version", () => {
  const body = bodyOf("AppDetailPage");

  test("still 404s when the app row itself does not exist", () => {
    assert.match(body, /if \(!app\) notFound\(\);/);
  });

  test("calls notFound\\(\\) when there is no published version, after fetching versions and related apps", () => {
    const afterFetch = body.slice(body.indexOf("getRelatedApps(app.category, app.id, 4)"));
    assert.match(afterFetch, /if \(versions\.length === 0\) notFound\(\);/);
  });

  test("the notFound() guard runs before `latest` is read, not after", () => {
    const guardIndex = body.lastIndexOf("if (versions.length === 0) notFound();");
    const latestIndex = body.indexOf("const latest = versions[0];", guardIndex);
    assert.ok(guardIndex > -1 && latestIndex > -1, "expected both the guard and `latest` assignment to be present");
    assert.ok(guardIndex < latestIndex, "expected the notFound() guard to run before `latest` is read");
  });

  test("versions and related apps are still fetched in parallel, unchanged", () => {
    assert.match(
      body,
      /const \[versions, related\] = await Promise\.all\(\[\s*getPublishedVersions\(app\.id\),\s*getRelatedApps\(app\.category, app\.id, 4\),\s*\]\);/,
    );
  });
});

group("generateStaticParams — still delegates entirely to getPopularSlugs", () => {
  test("no separate published-version filtering was added here — getPopularSlugs (lib/catalogue.ts) already excludes unpublished apps", () => {
    const body = bodyOf("generateStaticParams");
    assert.match(body, /const slugs = await getPopularSlugs\(50\);/);
    assert.match(body, /return slugs\.map\(\(slug\) => \(\{ slug \}\)\);/);
  });
});
