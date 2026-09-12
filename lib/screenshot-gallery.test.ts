import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * P3-5: the ScreenshotGallery lightbox's plain <img> had no intrinsic
 * width/height, so the browser reserved no space for it before it loaded —
 * a pop-in on open. Fixed by adding width/height HTML *attributes* (not a
 * fixed CSS size) as a 9:16 placeholder aspect ratio, matching the grid
 * thumbnails' own existing assumption a few lines above. This is safe
 * specifically because HTML width/height attributes only seed the browser's
 * pre-load aspect-ratio guess — once the real image loads, its own natural
 * dimensions govern final layout as long as no CSS fixes both width and
 * height at once, which this component still doesn't (width stays `w-auto`,
 * height stays capped by `max-h-[85vh]`, both unchanged here).
 *
 * components/ScreenshotGallery.tsx is a "use client" component that imports
 * next/image — this project's plain `node --test` runner has no JSX
 * transform and no bundler, so it can't be imported directly (the same
 * constraint documented in lib/catalogue-select.test.ts and
 * lib/next-config.test.ts for their respective non-importable targets).
 * These are therefore static, source-level assertions against the
 * component's actual text.
 */

const src = readFileSync(
  fileURLToPath(new URL("../components/ScreenshotGallery.tsx", import.meta.url)),
  "utf8",
);

function extractLightboxImg(fileSrc: string): string {
  // The lightbox <img> is the one right after the eslint-disable comment
  // that permits it — isolates it from the grid's <Image> above so these
  // assertions can't accidentally pass by matching the wrong element.
  const marker = "eslint-disable-next-line @next/next/no-img-element";
  const markerIndex = fileSrc.indexOf(marker);
  assert.notEqual(markerIndex, -1, "no-img-element eslint-disable comment not found");
  const tagStart = fileSrc.indexOf("<img", markerIndex);
  const tagEnd = fileSrc.indexOf("/>", tagStart);
  return fileSrc.slice(tagStart, tagEnd + 2);
}

group("ScreenshotGallery lightbox — stable intrinsic sizing", () => {
  test("the lightbox <img> declares width and height attributes", () => {
    const img = extractLightboxImg(src);
    assert.match(img, /\bwidth=\{270\}/);
    assert.match(img, /\bheight=\{480\}/);
  });

  test("the placeholder ratio matches the grid thumbnails' own 270x480 (9:16) assumption", () => {
    // Not a coincidence this project should keep in sync deliberately — pin
    // both call sites to the same numbers rather than letting them drift.
    const gridImgMatch = src.match(/<Image[\s\S]*?width=\{(\d+)\}\s*\n\s*height=\{(\d+)\}/);
    assert.ok(gridImgMatch, "grid <Image> width/height not found");
    const lightboxImg = extractLightboxImg(src);
    const lightboxWidth = lightboxImg.match(/width=\{(\d+)\}/)?.[1];
    const lightboxHeight = lightboxImg.match(/height=\{(\d+)\}/)?.[1];
    assert.equal(lightboxWidth, gridImgMatch![1]);
    assert.equal(lightboxHeight, gridImgMatch![2]);
  });

  test("width stays auto and height stays capped by max-h-[85vh] — no fixed width+height combination that would distort the loaded image", () => {
    const img = extractLightboxImg(src);
    const classMatch = img.match(/className="([^"]*)"/);
    assert.ok(classMatch, "lightbox <img> has no className");
    const classes = classMatch![1].split(/\s+/);

    assert.ok(classes.includes("w-auto"), "expected w-auto to remain on the lightbox img");
    assert.ok(
      classes.includes("max-h-[85vh]"),
      "expected max-h-[85vh] to remain on the lightbox img",
    );
    // A fixed pixel height class here (e.g. h-[480px]) combined with the
    // width/height attributes above would force every screenshot into the
    // same box regardless of its real shape — exactly the distortion this
    // change must not introduce.
    assert.ok(
      !classes.some((c) => /^h-\[/.test(c)),
      "a fixed-height class was introduced on the lightbox img — this would distort non-9:16 screenshots",
    );
    assert.ok(
      !classes.some((c) => /^w-\[/.test(c) || c === "w-full"),
      "a fixed/forced-width class was introduced on the lightbox img",
    );
  });

  test("no object-fit class was added to the lightbox img (it was never cropped, and still isn't)", () => {
    const img = extractLightboxImg(src);
    assert.doesNotMatch(img, /object-(cover|contain|fill|none|scale-down)/);
  });
});

group("ScreenshotGallery — unchanged behavior elsewhere", () => {
  test("the grid <Image> still uses aspect-[9/16] object-cover, 270x480, and per-index priority/loading", () => {
    assert.match(
      src,
      /<Image[\s\S]*?width=\{270\}[\s\S]*?height=\{480\}[\s\S]*?priority=\{index === 0\}[\s\S]*?loading=\{index < 4 \? "eager" : "lazy"\}[\s\S]*?className="aspect-\[9\/16\] w-full object-cover/,
    );
  });

  test("exactly one plain <img> remains in the file — no new plain-img usage was introduced", () => {
    const occurrences = src.match(/<img\b/g) ?? [];
    assert.equal(occurrences.length, 1);
  });

  test("the eslint-disable for no-img-element is still present and still directly precedes the one <img>", () => {
    assert.match(
      src,
      /eslint-disable-next-line @next\/next\/no-img-element[\s\S]{0,20}<img/,
    );
  });

  test("the overlay dialog and its interaction handlers are untouched", () => {
    assert.match(src, /role="dialog"/);
    assert.match(src, /aria-modal="true"/);
    assert.match(src, /onClick=\{close\}/);
    assert.match(src, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });
});
