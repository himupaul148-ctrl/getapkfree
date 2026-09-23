import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against components/admin/TargetAppPicker.tsx,
 * components/admin/RelatedAppPicker.tsx, and components/admin/BlogEditor.tsx —
 * the P0 fix for Enter-in-a-picker-search-box submitting (and publishing)
 * BlogEditor's real <form>. Neither picker nor the editor is importable under
 * plain `node --test` (JSX, no React Testing Library / jsdom in this project),
 * the same constraint documented in BlogEditor.test.ts/BlogPostsTable.test.ts,
 * which this file mirrors. Not covered by the canonical `npm test` script
 * (`node --test lib/**\/*.test.ts` does not glob components/**) — run
 * directly with `node --test components/admin/PickerEnterSubmit.test.ts`.
 */

const targetPickerSrc = readFileSync(
  fileURLToPath(new URL("./TargetAppPicker.tsx", import.meta.url)),
  "utf8",
);
const relatedPickerSrc = readFileSync(
  fileURLToPath(new URL("./RelatedAppPicker.tsx", import.meta.url)),
  "utf8",
);
const editorSrc = readFileSync(
  fileURLToPath(new URL("./BlogEditor.tsx", import.meta.url)),
  "utf8",
);

function searchInputBlockOf(src: string, inputId: string): string {
  const idIndex = src.indexOf(`id="${inputId}"`);
  assert.ok(idIndex > -1, `<input id="${inputId}"> not found`);
  const closeIndex = src.indexOf("/>", idIndex);
  assert.ok(closeIndex > -1, `no closing "/>" found for <input id="${inputId}">`);
  return src.slice(idIndex, closeIndex);
}

group("(1) Enter in TargetAppPicker search does not submit the parent form", () => {
  const inputBlock = searchInputBlockOf(targetPickerSrc, "target-app-search");

  test("the search input has an onKeyDown handler", () => {
    assert.match(inputBlock, /onKeyDown=\{/);
  });

  test("the handler calls preventDefault specifically on Enter", () => {
    assert.match(inputBlock, /if \(e\.key === "Enter"\) e\.preventDefault\(\);/);
  });
});

group("(2) Enter in RelatedAppPicker search does not submit the parent form", () => {
  const inputBlock = searchInputBlockOf(relatedPickerSrc, "related-search");

  test("the search input has an onKeyDown handler", () => {
    assert.match(inputBlock, /onKeyDown=\{/);
  });

  test("the handler calls preventDefault specifically on Enter", () => {
    assert.match(inputBlock, /if \(e\.key === "Enter"\) e\.preventDefault\(\);/);
  });
});

group("(3) normal picker interaction still works — nothing about search/select/remove was touched", () => {
  test("TargetAppPicker: query state, filtering, and select() on a match click are unchanged", () => {
    assert.match(targetPickerSrc, /const \[query, setQuery\] = useState\(""\);/);
    assert.match(targetPickerSrc, /onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/);
    assert.match(targetPickerSrc, /onClick=\{\(\) => select\(app\.id\)\}/);
    assert.match(targetPickerSrc, /function select\(id: string\) \{/);
  });

  test("RelatedAppPicker: query state, filtering, add()/remove chip logic are unchanged", () => {
    assert.match(relatedPickerSrc, /const \[query, setQuery\] = useState\(""\);/);
    assert.match(relatedPickerSrc, /onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/);
    assert.match(relatedPickerSrc, /onClick=\{\(\) => add\(app\.id\)\}/);
    assert.match(relatedPickerSrc, /function add\(id: string\) \{/);
    assert.match(relatedPickerSrc, /onClick=\{\(\) => onChange\(selected\.filter\(\(s\) => s !== id\)\)\}/);
  });

  test("neither picker invented a highlighted-match-index/arrow-key-navigation system as part of this fix — the fix only swallows Enter, per the task's own scope", () => {
    assert.doesNotMatch(targetPickerSrc, /useState.*[Hh]ighlight/);
    assert.doesNotMatch(relatedPickerSrc, /useState.*[Hh]ighlight/);
    assert.doesNotMatch(targetPickerSrc, /ArrowDown|ArrowUp/);
    assert.doesNotMatch(relatedPickerSrc, /ArrowDown|ArrowUp/);
  });
});

group("(4) search input remains keyboard accessible", () => {
  test("TargetAppPicker's input keeps its id/label association, value, onChange and is not disabled/hidden by this fix", () => {
    const inputBlock = searchInputBlockOf(targetPickerSrc, "target-app-search");
    assert.match(inputBlock, /value=\{query\}/);
    assert.match(inputBlock, /onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/);
    assert.doesNotMatch(inputBlock, /disabled/);
    assert.doesNotMatch(inputBlock, /tabIndex=\{?-1\}?/);
    assert.match(targetPickerSrc, /htmlFor="target-app-search"/);
  });

  test("RelatedAppPicker's input keeps its id/label association and value/onChange — its existing disabled-at-max behavior is untouched by this fix", () => {
    const inputBlock = searchInputBlockOf(relatedPickerSrc, "related-search");
    assert.match(inputBlock, /value=\{query\}/);
    assert.match(inputBlock, /onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/);
    assert.match(inputBlock, /disabled=\{selected\.length >= max\}/);
    assert.match(relatedPickerSrc, /htmlFor="related-search"/);
  });

  test("the onKeyDown handler only branches on \"Enter\" — every other key (Tab, typing, arrows) reaches the input's default behavior unimpeded", () => {
    const targetBlock = searchInputBlockOf(targetPickerSrc, "target-app-search");
    const relatedBlock = searchInputBlockOf(relatedPickerSrc, "related-search");
    for (const block of [targetBlock, relatedBlock]) {
      const handlerMatch = block.match(/onKeyDown=\{\(e\) => \{([\s\S]*?)\}\}/);
      assert.ok(handlerMatch, "onKeyDown handler body not found");
      const body = handlerMatch![1];
      // A single conditional statement, no early return/stopPropagation that
      // would swallow any other key or block focus/typing.
      assert.doesNotMatch(body, /stopPropagation/);
      assert.doesNotMatch(body, /return;/);
      assert.match(body.trim(), /^\/\/[\s\S]*if \(e\.key === "Enter"\) e\.preventDefault\(\);$/);
    }
  });
});

group("(5) clicking the existing Publish button still publishes normally — untouched by this fix", () => {
  test("the form's onSubmit still calls save(true) on the Publish path, exactly as before", () => {
    assert.match(
      editorSrc,
      /onSubmit=\{\(e\) => \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*void save\(true\);\s*\n\s*\}\}/,
    );
  });

  test("the submit button is still type=\"submit\" and not disabled/rewired by this fix", () => {
    const formIndex = editorSrc.indexOf("<form");
    const submitButtonIndex = editorSrc.indexOf('type="submit"', formIndex);
    assert.ok(submitButtonIndex > formIndex, "type=\"submit\" button not found inside the form");
  });

  test("save()'s own imageBusy Enter-key note is untouched — this fix did not alter BlogEditor.tsx at all, only the two picker components", () => {
    assert.match(
      editorSrc,
      /an Enter\s*\n\s*\/\/ key in a text field submits the form directly and would skip a\s*\n\s*\/\/ disabled attribute entirely\./,
    );
  });
});

group("(6) Enter on actual publish/submission controls is not accidentally blocked", () => {
  test("the onKeyDown guard is attached to each picker's search <input> only — never to the <form> itself or any button", () => {
    assert.doesNotMatch(editorSrc, /<form[\s\S]{0,400}onKeyDown/);
  });

  test("BlogEditor.tsx's own form/onSubmit wiring has no new keydown interception layered on top of the pickers' fix", () => {
    const formBlock = editorSrc.slice(
      editorSrc.indexOf("<form"),
      editorSrc.indexOf("className=\"space-y-6\""),
    );
    assert.doesNotMatch(formBlock, /onKeyDown/);
  });
});
