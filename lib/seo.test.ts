import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { appDescriptionSuffix } from "./seo.ts";

/**
 * Covers the bug found in the Multimedia content audit: the app detail page's
 * meta description used to append "Free, open-source, malware-scanned." to
 * every app regardless of source, which is false for an external listing
 * (Netflix, Spotify, MX Player, and the like) — GetApkFree neither built it
 * from source nor scanned it, and the page's own body says so.
 */
group("appDescriptionSuffix", () => {
  test("an F-Droid app keeps the open-source/malware-scanned claim", () => {
    assert.equal(
      appDescriptionSuffix("fdroid"),
      "Free, open-source, malware-scanned.",
    );
  });

  test("an external app makes no open-source or malware-scanned claim", () => {
    const suffix = appDescriptionSuffix("external");
    assert.doesNotMatch(suffix, /open-source/i);
    assert.doesNotMatch(suffix, /malware-scanned/i);
    assert.doesNotMatch(suffix, /scanned/i);
  });

  test("an external app's suffix is still accurate, not just empty", () => {
    assert.equal(
      appDescriptionSuffix("external"),
      "Free download, linked to its official source.",
    );
  });
});
