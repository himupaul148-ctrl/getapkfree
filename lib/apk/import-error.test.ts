import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { classifyImportError, validateUrlClientSide } from "./import-error.ts";

/**
 * Run with: npm test
 *
 * This repo has no React component-testing framework, so
 * ImportApkUrlForm.tsx itself is not directly tested — these are the two
 * pure functions it delegates its meaningful logic to: the client-side URL
 * pre-check, and safely turning a server error response into on-screen
 * text without ever rendering raw/unexpected content.
 */

group("validateUrlClientSide", () => {
  test("accepts a plain https URL", () => {
    assert.equal(validateUrlClientSide("https://example.com/app.apk"), null);
  });

  test("rejects an empty string", () => {
    assert.match(validateUrlClientSide(""), /enter/i);
  });

  test("rejects whitespace only", () => {
    assert.match(validateUrlClientSide("   "), /enter/i);
  });

  test("rejects an http URL", () => {
    assert.match(validateUrlClientSide("http://example.com/app.apk"), /https/i);
  });

  test("rejects a non-URL string", () => {
    assert.match(validateUrlClientSide("not a url"), /valid url/i);
  });

  test("rejects other schemes (ftp, data, javascript)", () => {
    assert.match(validateUrlClientSide("ftp://example.com/app.apk"), /https/i);
    assert.match(validateUrlClientSide("data:text/plain;base64,aGVsbG8="), /https/i);
    assert.match(validateUrlClientSide("javascript:alert(1)"), /https/i);
  });

  test("trims surrounding whitespace before checking", () => {
    assert.equal(validateUrlClientSide("  https://example.com/app.apk  "), null);
  });
});

group("classifyImportError", () => {
  test("uses the server's own error message when present", () => {
    const result = classifyImportError(400, { error: "That host is not reachable from here." });
    assert.equal(result.message, "That host is not reachable from here.");
  });

  test("labels 400 as Blocked", () => {
    assert.equal(classifyImportError(400, { error: "x" }).label, "Blocked");
  });

  test("labels 409 as Already imported", () => {
    assert.equal(classifyImportError(409, { error: "x" }).label, "Already imported");
  });

  test("labels 502 as Download failed", () => {
    assert.equal(classifyImportError(502, { error: "x" }).label, "Download failed");
  });

  test("labels 403 as Not authorized", () => {
    assert.equal(classifyImportError(403, { error: "x" }).label, "Not authorized");
  });

  test("labels 500 as Server error", () => {
    assert.equal(classifyImportError(500, { error: "x" }).label, "Server error");
  });

  test("falls back to a generic label for an unrecognized status", () => {
    assert.equal(classifyImportError(418, { error: "x" }).label, "Error");
  });

  test("falls back to a generic message when the body has no error field", () => {
    const result = classifyImportError(500, {});
    assert.match(result.message, /something went wrong/i);
  });

  test("falls back to a generic message when the body is null", () => {
    const result = classifyImportError(502, null);
    assert.match(result.message, /something went wrong/i);
  });

  test("falls back to a generic message when the body isn't JSON at all", () => {
    const result = classifyImportError(500, undefined);
    assert.match(result.message, /something went wrong/i);
  });

  test("never renders a non-string error field verbatim (no object dump)", () => {
    const result = classifyImportError(500, { error: { stack: "at Object.<anonymous> (/app/lib/x.ts:42:9)" } });
    assert.match(result.message, /something went wrong/i);
    assert.doesNotMatch(result.message, /\/app\/lib/);
  });

  test("an empty-string error field is treated as no message", () => {
    const result = classifyImportError(400, { error: "" });
    assert.match(result.message, /something went wrong/i);
  });
});
