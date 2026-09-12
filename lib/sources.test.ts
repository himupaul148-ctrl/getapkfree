import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { safetyMethodologyPath } from "./sources.ts";

/**
 * P2-4: the app page's Safety badge links to whichever page actually
 * explains that source type's trust model — the install guide's badge
 * section for a build we scanned ourselves, /about's Safety section for an
 * external listing we send elsewhere and never scanned.
 */
group("safetyMethodologyPath", () => {
  test("an fdroid app links to the badge-meaning section of the install guide", () => {
    assert.equal(safetyMethodologyPath("fdroid"), "/how-to-install#badges");
  });

  test("an external app links to the safety section of /about instead", () => {
    assert.equal(safetyMethodologyPath("external"), "/about#safety");
  });
});
