import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  ACCEPT_ATTR,
  ACCEPTED_MIME,
  isOversized,
  MAX_BYTES,
  rejectUnsupported,
} from "./blog-image-policy.ts";

group("rejectUnsupported", () => {
  test("every accepted MIME type passes", () => {
    for (const mime of ACCEPTED_MIME) {
      assert.equal(rejectUnsupported(mime, "photo.bin"), null);
    }
  });

  test("matching is case-insensitive on the MIME type", () => {
    assert.equal(rejectUnsupported("IMAGE/JPEG", "photo.jpg"), null);
  });

  test("HEIC/HEIF is rejected by MIME type, with a specific, actionable message", () => {
    const msg = rejectUnsupported("image/heic", "photo.heic");
    assert.notEqual(msg, null);
    assert.match(msg!, /HEIC/);
    assert.match(msg!, /HEVC/);
  });

  test("HEIC/HEIF is rejected by filename extension even with a generic/missing MIME type", () => {
    assert.notEqual(rejectUnsupported("application/octet-stream", "IMG_1234.HEIC"), null);
    assert.notEqual(rejectUnsupported("", "photo.heif"), null);
  });

  test("an unsupported, non-HEIC type is rejected with the general message", () => {
    const msg = rejectUnsupported("text/plain", "notes.txt");
    assert.notEqual(msg, null);
    assert.match(msg!, /not a supported image/);
  });

  test("an empty MIME type is reported plainly rather than as an empty string", () => {
    const msg = rejectUnsupported("", "file");
    assert.match(msg!, /That file/);
  });
});

group("isOversized / MAX_BYTES", () => {
  test("a file at exactly the limit is not oversized", () => {
    assert.equal(isOversized(MAX_BYTES), false);
  });

  test("one byte over the limit is oversized", () => {
    assert.equal(isOversized(MAX_BYTES + 1), true);
  });

  test("a small file is not oversized", () => {
    assert.equal(isOversized(1024), false);
  });

  test("MAX_BYTES is the documented 4MB, not an accidental different value", () => {
    assert.equal(MAX_BYTES, 4 * 1024 * 1024);
  });
});

group("ACCEPT_ATTR", () => {
  test("is exactly the accepted MIME list, comma-joined, for use as a file input's accept attribute", () => {
    assert.equal(ACCEPT_ATTR, ACCEPTED_MIME.join(","));
    for (const mime of ACCEPTED_MIME) {
      assert.ok(ACCEPT_ATTR.includes(mime));
    }
  });
});
