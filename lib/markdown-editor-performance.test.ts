import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the admin Markdown editor performance
 * fix: the confirmed bottleneck was `renderMarkdown(value)` — the full
 * remark/rehype/sanitize pipeline — running unconditionally on every render
 * (i.e. every keystroke, via the parent's controlled `value` prop), even
 * while the "write" tab hid the preview entirely. Same import-time
 * constraint as every other Client Component test here — not importable
 * under plain `node --test`.
 */

const src = readFileSync(
  fileURLToPath(new URL("../components/admin/MarkdownEditor.tsx", import.meta.url)),
  "utf8",
);

group("the expensive Markdown pipeline is deferred and skipped when not visible", () => {
  test("imports useDeferredValue and useMemo from react", () => {
    assert.match(src, /import \{ useDeferredValue, useMemo, useRef, useState \} from "react";/);
  });

  test("renderMarkdown runs against a useDeferredValue of the editor value, not the raw per-keystroke value directly", () => {
    assert.match(src, /const deferredValue = useDeferredValue\(value\);/);
    assert.match(src, /renderMarkdown\(deferredValue\)/);
  });

  test("the computation is memoized on [tab, deferredValue] — not recomputed on every render for unrelated state changes", () => {
    assert.match(
      src,
      /const html = useMemo\(\s*\n\s*\(\) => \(tab === "write" \? "" : renderMarkdown\(deferredValue\)\),\s*\n\s*\[tab, deferredValue\],\s*\n\s*\);/,
    );
  });

  test("skipped entirely in write-only mode (tab === \"write\") rather than computed and simply not displayed", () => {
    assert.match(src, /tab === "write" \? "" : renderMarkdown\(deferredValue\)/);
  });
});

group("the textarea's own input state is untouched — typing responsiveness is not traded away", () => {
  test("the textarea's value/onChange still bind directly to the raw, undeferred value/onChange props — no debounce on the input itself", () => {
    assert.match(src, /value=\{value\}/);
    assert.match(src, /onChange=\{\(e\) => onChange\(e\.target\.value\)\}/);
  });

  test("no setTimeout/debounce mechanism was introduced for either the input or the preview — useDeferredValue needs neither", () => {
    assert.doesNotMatch(src, /setTimeout/);
    assert.doesNotMatch(src, /debounce/i);
  });
});

group("Markdown syntax, sanitization, and preview architecture are unchanged", () => {
  test("still calls the same renderMarkdown import used by the published page — no parallel/weakened rendering path", () => {
    assert.match(src, /import \{ renderMarkdown \} from "@\/lib\/markdown";/);
  });

  test("preview is still gated on tab !== \"write\", and toolbar/tab-switching logic is untouched", () => {
    assert.match(src, /\{tab !== "write" && \(/);
    assert.match(src, /\{tab !== "preview" && \(/);
  });
});
