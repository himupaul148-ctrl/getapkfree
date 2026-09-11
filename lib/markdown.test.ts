import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { renderMarkdown } from "./markdown.ts";

/**
 * Covers the P1-1 GEO finding: blog h2/h3 headings had no `id`, so nothing on
 * the site could deep-link or cite a specific section. These pin the exact
 * rehype-slug/github-slugger behavior verified during the audit — including
 * the cases that are easy to get wrong (dedup numbering starts at -1, not
 * -2; punctuation is dropped rather than substituted; the clobber prefix
 * must never be stripped) — so a future change can't silently drift from
 * what was actually checked.
 */

group("renderMarkdown — heading ids", () => {
  test("A. an h2 receives a user-content-prefixed id", () => {
    const html = renderMarkdown("## Overview");
    assert.match(html, /<h2 id="user-content-overview">Overview<\/h2>/);
  });

  test("B. an h3 receives a user-content-prefixed id", () => {
    const html = renderMarkdown("### Details");
    assert.match(html, /<h3 id="user-content-details">Details<\/h3>/);
  });

  test("C. a body-level h1 does not retain an id after sanitization", () => {
    const html = renderMarkdown("# Top Level Title");
    assert.match(html, /<h1>Top Level Title<\/h1>/);
    assert.doesNotMatch(html, /<h1[^>]*\sid=/);
  });

  test("D. duplicate headings use -1 / -2 suffixes, not -2 / -3", () => {
    const html = renderMarkdown("## Overview\n\n## Overview\n\n## Overview\n");
    assert.match(html, /<h2 id="user-content-overview">Overview<\/h2>/);
    assert.match(html, /<h2 id="user-content-overview-1">Overview<\/h2>/);
    assert.match(html, /<h2 id="user-content-overview-2">Overview<\/h2>/);
    assert.doesNotMatch(html, /user-content-overview-3/);
  });

  test("E. punctuation is dropped, not substituted — matches verified github-slugger output", () => {
    const cases: Array<[string, string]> = [
      ["ARM64 vs ARMv7: What's the Difference?", "user-content-arm64-vs-armv7-whats-the-difference"],
      [
        'Can the Wrong Architecture Cause "App Not Installed" or Parsing Errors?',
        "user-content-can-the-wrong-architecture-cause-app-not-installed-or-parsing-errors",
      ],
      ["C++ & C# Basics: 100% Done?", "user-content-c--c-basics-100-done"],
      ["slashes/percent% +plus+", "user-content-slashespercent-plus"],
      ["Games (2026 Edition)", "user-content-games-2026-edition"],
      // Numeric-leading heading: digits pass through unchanged, no escaping needed.
      ["100 Best Apps", "user-content-100-best-apps"],
      // Unicode: case-folded, non-ASCII letters preserved as-is, not transliterated.
      ["Über Cool Ünïcode Headers", "user-content-über-cool-ünïcode-headers"],
    ];

    for (const [heading, expectedId] of cases) {
      const html = renderMarkdown(`## ${heading}`);
      assert.match(
        html,
        new RegExp(`<h2 id="${expectedId}">`),
        `expected "${heading}" to slug to "${expectedId}", got: ${html}`,
      );
    }
  });

  test("F. a heading that is entirely a Markdown link slugs from the visible text, not the href", () => {
    const html = renderMarkdown("### [1Key Password Manager](/app/1key-password-manager)");
    assert.match(html, /<h3 id="user-content-1key-password-manager">/);
    // The link itself must still render inside the heading, untouched.
    assert.match(html, /<a href="\/app\/1key-password-manager">1Key Password Manager<\/a>/);
  });

  test('G. "## location" becomes id="user-content-location", never the bare, clobber-capable id="location"', () => {
    const html = renderMarkdown("## location");
    assert.match(html, /<h2 id="user-content-location">location<\/h2>/);
    assert.doesNotMatch(html, /id="location"/);
  });

  test("H. two separate renderMarkdown() calls each reset the slug sequence independently", () => {
    const first = renderMarkdown("## Overview\n\n## Overview\n");
    const second = renderMarkdown("## Overview\n\n## Overview\n");
    for (const html of [first, second]) {
      assert.match(html, /<h2 id="user-content-overview">Overview<\/h2>/);
      assert.match(html, /<h2 id="user-content-overview-1">Overview<\/h2>/);
    }
  });

  test("I. visible Markdown rendering (paragraphs, lists, bold, links) is unaffected", () => {
    const html = renderMarkdown(
      "## Heading\n\nSome **bold** text with a [link](https://example.com).\n\n- one\n- two\n",
    );
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<a href="https:\/\/example\.com">link<\/a>/);
    assert.match(html, /<li>one<\/li>/);
    assert.match(html, /<li>two<\/li>/);
  });

  test("no id appears on any element other than h2/h3 — not on links, code, or paragraphs", () => {
    const html = renderMarkdown(
      "# Title\n\n## Section\n\nA [link](https://example.com) and `code`.\n\n" +
        "| a | b |\n| - | - |\n| 1 | 2 |\n",
    );
    const idAttrs = [...html.matchAll(/<(\w+)[^>]*\sid="([^"]*)"/g)];
    assert.ok(idAttrs.length > 0, "expected at least the h2's id");
    for (const [, tag] of idAttrs) {
      assert.ok(["h2", "h3"].includes(tag), `unexpected id on <${tag}>: ${html}`);
    }
  });
});
