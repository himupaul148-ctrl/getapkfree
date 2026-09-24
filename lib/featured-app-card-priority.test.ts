import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the app-detail-page performance audit's
 * one confirmed finding: FeaturedAppCard never passed `priority` through to
 * AppIcon (lib/AppIcon.tsx defaults `priority = false`, i.e. lazy), so even
 * the homepage's first, above-the-fold Featured Apps icon — a realistic LCP
 * candidate — was loaded lazily. Fixed by threading an explicit `priority`
 * prop through, set only on the first carousel card, never on every card.
 * Same *.tsx import-time constraint as every other component test here.
 */

const cardSrc = readFileSync(
  fileURLToPath(new URL("../components/FeaturedAppCard.tsx", import.meta.url)),
  "utf8",
);
const homeSrc = readFileSync(
  fileURLToPath(new URL("../components/HomeSections.tsx", import.meta.url)),
  "utf8",
);

group("FeaturedAppCard accepts and forwards a priority prop", () => {
  test("priority defaults to false, documented as for the first card only", () => {
    assert.match(cardSrc, /priority = false,/);
    assert.match(cardSrc, /Set only on the first card of a row\/carousel/);
  });

  test("both the dense and card variants forward it to their own AppIcon, never hard-coding priority themselves", () => {
    const appIconCalls = [...cardSrc.matchAll(/<AppIcon[^/]*\/>/g)].map((m) => m[0]);
    assert.equal(appIconCalls.length, 2, "expected exactly two AppIcon render sites (dense + card)");
    for (const call of appIconCalls) {
      assert.match(call, /priority=\{priority\}/);
    }
  });
});

group("HomeSections marks only the first Featured Apps carousel card as priority", () => {
  test("passes priority={index === 0} to FeaturedAppCard inside the carousel map", () => {
    assert.match(homeSrc, /\{exploreApps\.map\(\(app, index\) => \(/);
    assert.match(homeSrc, /<FeaturedAppCard app=\{app\} priority=\{index === 0\} \/>/);
  });

  test("Recently Updated's dense row is untouched — no priority prop added there, since it isn't the above-the-fold section", () => {
    const denseSection = homeSrc.slice(
      homeSrc.indexOf('id="recently-updated"'),
      homeSrc.indexOf("</section>", homeSrc.indexOf('id="recently-updated"')),
    );
    assert.doesNotMatch(denseSection, /priority=/);
  });
});
