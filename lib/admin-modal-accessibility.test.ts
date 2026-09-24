import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions for the accessibility/keyboard-interaction
 * hardening task: focus containment/restoration in the shared admin Modal,
 * BlogPostsTable's delete-confirm dialog reusing that shared Modal instead of
 * its own ad-hoc, Escape-less div, the mobile search overlay's focus
 * restoration, and the one control (the article Markdown textarea) that had
 * no visible focus indicator at all. Same import-time constraint as every
 * other *.tsx test in this project — these are Client Components, not
 * importable under plain `node --test`.
 */

const modalSrc = readFileSync(
  fileURLToPath(new URL("../components/admin/Modal.tsx", import.meta.url)),
  "utf8",
);
const blogPostsTableSrc = readFileSync(
  fileURLToPath(new URL("../components/admin/BlogPostsTable.tsx", import.meta.url)),
  "utf8",
);
const searchOverlaySrc = readFileSync(
  fileURLToPath(new URL("../components/MobileSearchOverlay.tsx", import.meta.url)),
  "utf8",
);
const markdownEditorSrc = readFileSync(
  fileURLToPath(new URL("../components/admin/MarkdownEditor.tsx", import.meta.url)),
  "utf8",
);

group("shared Modal traps focus and restores it on close", () => {
  test("captures document.activeElement as the trigger before opening", () => {
    assert.match(modalSrc, /const trigger = document\.activeElement as HTMLElement \| null;/);
  });

  test("moves focus into the dialog (its first focusable element, or the dialog container itself) on mount", () => {
    assert.match(modalSrc, /\(focusable\(\)\[0\] \?\? dialogRef\.current\)\?\.focus\(\);/);
  });

  test("Tab/Shift+Tab wrap within the dialog's own focusable elements rather than escaping to the page behind it", () => {
    assert.match(modalSrc, /if \(event\.key !== "Tab"\) return;/);
    assert.match(modalSrc, /event\.shiftKey && active === first/);
    assert.match(modalSrc, /!event\.shiftKey && active === last/);
  });

  test("restores focus to the trigger in the cleanup function, still handles Escape", () => {
    assert.match(modalSrc, /trigger\?\.focus\(\);/);
    assert.match(modalSrc, /if \(event\.key === "Escape"\) \{\s*\n\s*onClose\(\);/);
  });

  test("the dialog container is a real, unstyled-outline focus target (tabIndex=-1) — a safe fallback when a dialog body has no focusable child", () => {
    assert.match(modalSrc, /tabIndex=\{-1\}/);
  });

  test("the close button now meets an ~44px touch target (p-3.5) and keeps a visible focus state", () => {
    assert.match(modalSrc, /rounded-lg border border-base-700 p-3\.5 text-fg-muted hover:text-fg focus:border-brand-500 focus:outline-none/);
  });
});

group("BlogPostsTable's delete-confirm dialog reuses the shared Modal instead of a second, ad-hoc implementation", () => {
  test("imports Modal from components/admin/Modal", () => {
    assert.match(blogPostsTableSrc, /import \{ Modal \} from "@\/components\/admin\/Modal";/);
  });

  test("renders <Modal title=... onClose=...> for confirmDelete, not its own <div role=\"dialog\">", () => {
    assert.match(
      blogPostsTableSrc,
      /\{confirmDelete && \(\s*\n\s*<Modal\s*\n\s*title=\{`Delete \$\{confirmDelete\.length\} post\$\{confirmDelete\.length === 1 \? "" : "s"\}\?`\}\s*\n\s*onClose=\{\(\) => setConfirmDelete\(null\)\}/,
    );
    assert.doesNotMatch(blogPostsTableSrc, /role="dialog"/);
  });

  test("Delete/Cancel actions and their copy are unchanged, just moved inside the shared Modal's children", () => {
    assert.match(blogPostsTableSrc, /\{busy \? "Deleting…" : "Delete"\}/);
    assert.match(blogPostsTableSrc, /onClick=\{\(\) => void run\(confirmDelete, "delete"\)\}/);
    assert.match(blogPostsTableSrc, /start returning 404\./);
  });
});

group("mobile search overlay restores focus to its trigger on close", () => {
  test("captures the trigger before the overlay's own effects run", () => {
    assert.match(searchOverlaySrc, /const trigger = document\.activeElement as HTMLElement \| null;/);
  });

  test("restores it in the cleanup function, alongside the existing scroll-lock restore", () => {
    assert.match(
      searchOverlaySrc,
      /document\.body\.style\.overflow = previous;\s*\n\s*trigger\?\.focus\(\);/,
    );
  });

  test("Escape-to-close and autofocus-on-open are both still present, unchanged", () => {
    assert.match(searchOverlaySrc, /if \(event\.key === "Escape"\) close\(\);/);
    assert.match(searchOverlaySrc, /input\?\.focus\(\);/);
  });

  test("close button now meets an ~44px touch target and has a visible focus state", () => {
    assert.match(
      searchOverlaySrc,
      /shrink-0 rounded-lg border border-base-700 p-3\.5 text-fg-muted focus:border-brand-500 focus:outline-none/,
    );
  });
});

group("the article Markdown textarea has a visible keyboard focus indicator", () => {
  test("no longer bare outline-none with nothing replacing it", () => {
    assert.match(
      markdownEditorSrc,
      /outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500\/60/,
    );
  });
});
