import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { spdxLicenseUrl } from "./spdx-license.ts";

group("spdxLicenseUrl", () => {
  test("MIT -> its canonical SPDX page", () => {
    assert.equal(spdxLicenseUrl("MIT"), "https://spdx.org/licenses/MIT.html");
  });

  test("Apache-2.0 -> its canonical SPDX page", () => {
    assert.equal(spdxLicenseUrl("Apache-2.0"), "https://spdx.org/licenses/Apache-2.0.html");
  });

  test("GPL-3.0-only -> its canonical SPDX page", () => {
    assert.equal(spdxLicenseUrl("GPL-3.0-only"), "https://spdx.org/licenses/GPL-3.0-only.html");
  });

  test("every SPDX identifier observed in the live catalogue maps correctly", () => {
    // Matches the exact license distribution found in P2-1's audit (section 4).
    const observed = [
      "GPL-3.0-only", "MIT", "GPL-3.0-or-later", "Apache-2.0",
      "AGPL-3.0-only", "AGPL-3.0-or-later", "GPL-2.0-or-later",
      "ISC", "BSD-2-Clause", "BSD-3-Clause", "Unlicense", "MPL-2.0",
    ];
    for (const id of observed) {
      assert.equal(spdxLicenseUrl(id), `https://spdx.org/licenses/${id}.html`);
    }
  });

  test("an identifier starting with a digit (e.g. 0BSD) is still valid", () => {
    assert.equal(spdxLicenseUrl("0BSD"), "https://spdx.org/licenses/0BSD.html");
  });

  test("null, undefined, empty, and whitespace-only all fail closed to null", () => {
    assert.equal(spdxLicenseUrl(null), null);
    assert.equal(spdxLicenseUrl(undefined), null);
    assert.equal(spdxLicenseUrl(""), null);
    assert.equal(spdxLicenseUrl("   "), null);
  });

  test("a compound SPDX expression fails closed rather than linking a made-up page", () => {
    assert.equal(spdxLicenseUrl("MIT OR Apache-2.0"), null);
    assert.equal(spdxLicenseUrl("GPL-2.0-only WITH Classpath-exception-2.0"), null);
    assert.equal(spdxLicenseUrl("MIT AND Apache-2.0"), null);
  });

  test("values containing unsafe or unexpected characters fail closed", () => {
    assert.equal(spdxLicenseUrl("MIT; DROP TABLE apps"), null);
    assert.equal(spdxLicenseUrl("<script>alert(1)</script>"), null);
    assert.equal(spdxLicenseUrl("MIT/Apache-2.0"), null);
    assert.equal(spdxLicenseUrl("a b"), null);
  });

  test("surrounding whitespace on an otherwise valid id is trimmed, not rejected", () => {
    assert.equal(spdxLicenseUrl("  MIT  "), "https://spdx.org/licenses/MIT.html");
  });

  test("the id is percent-encoded into the URL, defence in depth even though the charset is already restricted", () => {
    const url = spdxLicenseUrl("Apache-2.0");
    assert.equal(url, encodeURI(url!));
  });
});
