import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the AdSense/CSP audit's one confirmed
 * finding: app/layout.tsx's raw AdSense site-verification <script> loaded
 * unconditionally, so once NEXT_PUBLIC_ADSENSE_CLIENT is actually set,
 * <AdSense/> (components/Analytics.tsx) would load the identical
 * adsbygoogle.js src a second time. Fixed by gating the raw script on
 * `!adsEnabled` — today (adsEnabled === false, per lib/site-config.ts's own
 * doc comment) this changes nothing about what's rendered; it only prevents
 * the duplicate once ads are genuinely turned on.
 *
 * Also covers the new, unplaced AdSlot infrastructure component. Same
 * import-time constraint as every other *.tsx test in this project.
 */

const layoutSrc = readFileSync(fileURLToPath(new URL("../app/layout.tsx", import.meta.url)), "utf8");
const adSlotSrc = readFileSync(fileURLToPath(new URL("../components/AdSlot.tsx", import.meta.url)), "utf8");
const configSrc = readFileSync(fileURLToPath(new URL("../next.config.ts", import.meta.url)), "utf8");
const siteConfigSrc = readFileSync(fileURLToPath(new URL("./site-config.ts", import.meta.url)), "utf8");

group("the raw AdSense verification script no longer duplicates the env-gated loader", () => {
  test("app/layout.tsx imports adsEnabled from lib/site-config", () => {
    assert.match(layoutSrc, /import \{ adsEnabled \} from "@\/lib\/site-config";/);
  });

  test("the raw <script> is now conditional on !adsEnabled, not rendered unconditionally", () => {
    assert.match(layoutSrc, /\{!adsEnabled && \(\s*\n\s*<script/);
  });

  test("the script's src/client id and crossOrigin attribute are unchanged — only its condition changed", () => {
    assert.match(
      layoutSrc,
      /src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-8955448631957200"/,
    );
    assert.match(layoutSrc, /crossOrigin="anonymous"/);
  });

  test("<AdSense /> itself (components/Analytics.tsx) is still rendered unconditionally in the tree — it self-gates on adsEnabled internally, unchanged by this fix", () => {
    assert.match(layoutSrc, /<AdSense \/>/);
  });
});

group("adsEnabled's meaning for the privacy policy disclosure is untouched", () => {
  test("ADSENSE_CLIENT still comes only from the real env var — no fallback/default value was introduced that would make adsEnabled falsely true", () => {
    assert.match(siteConfigSrc, /export const ADSENSE_CLIENT = process\.env\.NEXT_PUBLIC_ADSENSE_CLIENT \?\? "";/);
  });
});

group("AdSlot is new, reusable infrastructure — not placed on any page yet", () => {
  test("renders nothing at all when ads aren't configured — no placeholder box reserved", () => {
    assert.match(adSlotSrc, /if \(!adsEnabled\) return null;/);
  });

  test("pushes to window.adsbygoogle at most once per mount, guarded by a ref, and never throws past a failed push", () => {
    assert.match(adSlotSrc, /if \(!adsEnabled \|\| pushed\.current\) return;/);
    assert.match(adSlotSrc, /pushed\.current = true;/);
    assert.match(adSlotSrc, /catch \(caught\) \{/);
  });

  test("carries an accessible label on its container, distinct from decorative markup", () => {
    assert.match(adSlotSrc, /aria-label=\{label\}/);
  });

  test("is not yet imported by any page or component — infrastructure only, no speculative placement", () => {
    const consumers = [
      "app/page.tsx",
      "app/blog/page.tsx",
      "app/app/[slug]/page.tsx",
      "app/blog/[slug]/page.tsx",
      "components/HomeSections.tsx",
    ].map((p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8"));
    for (const src of consumers) {
      assert.doesNotMatch(src, /AdSlot/);
    }
  });
});

group("CSP is unchanged — no speculative origin/directive broadening", () => {
  test("script-src/connect-src already list pagead2.googlesyndication.com, which is all the loader itself needs; no new origins were added", () => {
    assert.match(configSrc, /script-src 'self' 'unsafe-inline' https:\/\/www\.googletagmanager\.com https:\/\/pagead2\.googlesyndication\.com/);
    assert.match(configSrc, /"https:\/\/pagead2\.googlesyndication\.com",/);
  });

  test("still Report-Only, still no bare wildcard directive", () => {
    assert.match(configSrc, /Content-Security-Policy-Report-Only/);
    assert.doesNotMatch(configSrc, /"\*"/);
  });

  test("frame-src remains 'none' — no ad-iframe origin was speculatively opened without an actual ad unit ever being placed", () => {
    assert.match(configSrc, /"frame-src 'none'",/);
  });
});
