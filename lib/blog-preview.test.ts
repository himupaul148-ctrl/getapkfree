import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { buildPreviewHref } from "./blog-preview.ts";

/**
 * Pins the one detail that matters: the preview link is built from a
 * database id, under /admin/blog/, never from a slug and never a bare
 * top-level path — the admin isAdmin() gate on app/admin/layout.tsx only
 * protects routes actually nested under /admin.
 */

group("buildPreviewHref", () => {
  test("builds the /admin/blog/{id}/preview path for a given post id", () => {
    assert.equal(
      buildPreviewHref("3f6a1b2c-1111-4a2b-9c3d-abcdef012345"),
      "/admin/blog/3f6a1b2c-1111-4a2b-9c3d-abcdef012345/preview",
    );
  });

  test("is nested under /admin, not the public /blog tree", () => {
    const href = buildPreviewHref("some-id");
    assert.equal(href.startsWith("/admin/"), true);
    assert.equal(href.startsWith("/blog/"), false);
  });

  test("uses the id verbatim rather than a slug-style transform", () => {
    // A real id can contain characters slugify() would strip or lowercase —
    // the href must carry it through unchanged.
    const id = "Mixed-Case_ID.123";
    assert.equal(buildPreviewHref(id), `/admin/blog/${id}/preview`);
  });
});
