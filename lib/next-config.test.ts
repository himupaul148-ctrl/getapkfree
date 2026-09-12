import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * P3-4: next.config.ts's images.formats now enables AVIF (with WebP as the
 * fallback) for Next's image optimizer.
 *
 * This file cannot import next.config.ts directly: it imports "./lib/images"
 * with no file extension, which is a TypeScript-only resolution convention —
 * Node's native ESM loader (no bundler, no path-alias resolution, the same
 * constraint lib/catalogue-select.test.ts already documents for
 * lib/catalogue.ts) fails to resolve it, confirmed directly while building
 * this change. So, as with that file, these are static, source-level
 * assertions against next.config.ts's actual text — proving the intended
 * config is present without needing to execute or bundle the module.
 */

const configSrc = readFileSync(
  fileURLToPath(new URL("../next.config.ts", import.meta.url)),
  "utf8",
);

function extractImagesBlock(src: string): string {
  const start = src.indexOf("images: {");
  assert.notEqual(start, -1, "images: {...} block not found in next.config.ts");
  // Matches the block's own closing brace by depth-counting from the first
  // "{" after "images: {" — simpler than a regex given nested objects aren't
  // expected here, but braces inside string values are, so this walks
  // characters rather than assuming a shape.
  let depth = 0;
  let i = src.indexOf("{", start);
  const blockStart = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(blockStart, i + 1);
}

group("next.config.ts — images.formats enables AVIF and WebP", () => {
  test("formats: [\"image/avif\", \"image/webp\"] is present in the images config", () => {
    const images = extractImagesBlock(configSrc);
    assert.match(images, /formats:\s*\[\s*"image\/avif"\s*,\s*"image\/webp"\s*\]/);
  });

  test("AVIF is listed before WebP (Next tries formats in the given order)", () => {
    const images = extractImagesBlock(configSrc);
    const match = images.match(/formats:\s*\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/);
    assert.ok(match, "formats array not found");
    assert.equal(match![1], "image/avif");
    assert.equal(match![2], "image/webp");
  });
});

group("next.config.ts — pre-existing image config is unchanged", () => {
  test("imageSizes is preserved exactly", () => {
    const images = extractImagesBlock(configSrc);
    assert.match(images, /imageSizes:\s*\[44,\s*56,\s*88,\s*104,\s*128,\s*256\]/);
  });

  test("deviceSizes is preserved exactly", () => {
    const images = extractImagesBlock(configSrc);
    assert.match(images, /deviceSizes:\s*\[640,\s*828,\s*1080,\s*1200,\s*1920\]/);
  });

  test("minimumCacheTTL (30 days) is preserved exactly", () => {
    const images = extractImagesBlock(configSrc);
    assert.match(images, /minimumCacheTTL:\s*60\s*\*\s*60\s*\*\s*24\s*\*\s*30/);
  });

  test("remotePatterns still derives from OPTIMISED_IMAGE_HOSTS — not replaced with a hardcoded list", () => {
    const images = extractImagesBlock(configSrc);
    assert.match(
      images,
      /remotePatterns:\s*OPTIMISED_IMAGE_HOSTS\.map/,
    );
  });

  test("no custom image loader (loader/loaderFile) was introduced, which would bypass Next's own format negotiation", () => {
    const images = extractImagesBlock(configSrc);
    assert.doesNotMatch(images, /\bloader\s*:/);
    assert.doesNotMatch(images, /\bloaderFile\s*:/);
  });
});

group("next.config.ts — unrelated config is untouched", () => {
  test("headers(), redirects(), and the CSP builder are still present", () => {
    assert.match(configSrc, /async headers\(\)/);
    assert.match(configSrc, /async redirects\(\)/);
    assert.match(configSrc, /function contentSecurityPolicy\(\)/);
  });

  test("the two retired-post redirects are unchanged", () => {
    assert.match(
      configSrc,
      /source:\s*"\/blog\/check-apk-permissions-before-install"/,
    );
    assert.match(
      configSrc,
      /source:\s*"\/blog\/best-privacy-apps-android-2026"/,
    );
  });
});
