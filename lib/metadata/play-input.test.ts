import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { parseInputLines } from "./play-input.ts";

group("parseInputLines", () => {
  test("blank lines are dropped", () => {
    const text = "a\n\n\nb\n";
    assert.deepEqual(parseInputLines(text), ["a", "b"]);
  });

  test("lines starting with # are dropped as comments", () => {
    const text = "# a comment\nreal-line\n# another\n";
    assert.deepEqual(parseInputLines(text), ["real-line"]);
  });

  test("whitespace-only lines are dropped, and real lines are trimmed", () => {
    const text = "   \n  https://play.google.com/x  \n\t\n";
    assert.deepEqual(parseInputLines(text), ["https://play.google.com/x"]);
  });

  test("a leading # after whitespace is still treated as a comment", () => {
    const text = "  # indented comment\nkeep-me\n";
    assert.deepEqual(parseInputLines(text), ["keep-me"]);
  });

  test("CRLF line endings are handled the same as LF", () => {
    const text = "one\r\ntwo\r\n\r\n# skip\r\nthree\r\n";
    assert.deepEqual(parseInputLines(text), ["one", "two", "three"]);
  });

  test("an empty file yields an empty list", () => {
    assert.deepEqual(parseInputLines(""), []);
  });
});
