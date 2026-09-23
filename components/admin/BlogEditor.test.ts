import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against components/admin/BlogEditor.tsx
 * and components/admin/TargetAppPicker.tsx — the three-type blog system's
 * admin editor UI integration. Neither file is importable under plain
 * `node --test` (JSX, no React Testing Library / jsdom in this project — the
 * same constraint documented throughout this project for other *.tsx admin
 * components; see components/admin/BlogPostsTable.test.ts for the identical
 * approach this file mirrors).
 *
 * Not covered by the canonical `npm test` script (`node --test
 * lib/**\/*.test.ts` does not glob components/**), same as
 * BlogPostsTable.test.ts — run directly with `node --test
 * components/admin/BlogEditor.test.ts`.
 */

const editorSrc = readFileSync(
  fileURLToPath(new URL("./BlogEditor.tsx", import.meta.url)),
  "utf8",
);
const pickerSrc = readFileSync(
  fileURLToPath(new URL("./TargetAppPicker.tsx", import.meta.url)),
  "utf8",
);

group("(1) Article Type selector exists, using the canonical constants", () => {
  test("a <select> with the three canonical article types, imported from @/lib/blog (re-exported from lib/blog-article-types)", () => {
    assert.match(editorSrc, /<select\s*\n\s*id="post-article-type"/);
    assert.match(editorSrc, /\{ARTICLE_TYPES\.map\(\(t\) => \(/);
    assert.match(editorSrc, /\{ARTICLE_TYPE_LABELS\[t\]\}/);
  });

  test("imports ARTICLE_TYPES/ARTICLE_TYPE_LABELS/DEFAULT_ARTICLE_TYPE/ArticleType from @/lib/blog — no second, duplicate constant list", () => {
    assert.match(
      editorSrc,
      /import \{\s*\n\s*ARTICLE_TYPES,\s*\n\s*ARTICLE_TYPE_LABELS,\s*\n\s*BLOG_CATEGORIES,\s*\n\s*CATEGORY_LABELS,\s*\n\s*DEFAULT_ARTICLE_TYPE,\s*\n\s*type ArticleType,\s*\n\s*type BlogPost,\s*\n\s*\} from "@\/lib\/blog";/,
    );
  });

  test("placed beside Category in the existing grid, not a new large section", () => {
    const categoryIndex = editorSrc.indexOf('id="post-category"');
    const articleTypeIndex = editorSrc.indexOf('id="post-article-type"');
    const authorIndex = editorSrc.indexOf('id="post-author"');
    assert.ok(categoryIndex > -1 && articleTypeIndex > -1 && authorIndex > -1);
    assert.ok(categoryIndex < articleTypeIndex && articleTypeIndex < authorIndex);
  });
});

group("(2) General is the default for new posts", () => {
  test("articleType state initializes from post?.article_type, falling back to DEFAULT_ARTICLE_TYPE (general) for a new post", () => {
    assert.match(
      editorSrc,
      /const \[articleType, setArticleType\] = useState<ArticleType>\(\s*\n\s*post\?\.article_type \?\? DEFAULT_ARTICLE_TYPE,\s*\n\s*\);/,
    );
  });
});

group("(3) existing article_type is loaded for edits", () => {
  test("the same useState initializer reads post?.article_type when editing (post is present)", () => {
    assert.match(editorSrc, /post\?\.article_type \?\? DEFAULT_ARTICLE_TYPE/);
  });

  test("target_app_id is loaded the same way", () => {
    assert.match(
      editorSrc,
      /const \[targetAppId, setTargetAppId\] = useState<string \| null>\(\s*\n\s*post\?\.target_app_id \?\? null,\s*\n\s*\);/,
    );
  });
});

group("(4)+(5) App Related reveals the target-app selector; General hides it", () => {
  test("TargetAppPicker is rendered only when articleType !== \"general\"", () => {
    assert.match(editorSrc, /\{articleType !== "general" && \(/);
    const conditionalBlock = editorSrc.slice(
      editorSrc.indexOf('{articleType !== "general" && ('),
      editorSrc.indexOf("<FeaturedImageUploader"),
    );
    assert.match(conditionalBlock, /<TargetAppPicker/);
  });

  test("imports TargetAppPicker as a real component, not an inline duplicate", () => {
    assert.match(editorSrc, /import TargetAppPicker from "@\/components\/admin\/TargetAppPicker";/);
  });
});

group("(6) Review/Other behaves correctly — target app shown but optional", () => {
  test("required is true only for app_related, not review_other", () => {
    assert.match(editorSrc, /required=\{articleType === "app_related"\}/);
  });

  test("TargetAppPicker itself only renders the required asterisk when its `required` prop is true", () => {
    assert.match(pickerSrc, /\{required && <span className="text-danger-300">\*<\/span>\}/);
  });

  test("review_other is a real option in the select, sourced from the canonical ARTICLE_TYPES list (not hand-written)", () => {
    assert.doesNotMatch(editorSrc, /<option[^>]*>Review \/ Other<\/option>/);
    assert.match(editorSrc, /\{ARTICLE_TYPES\.map\(\(t\) => \(/);
  });
});

group("(7) target app is stored in target_app_id, never repurposing related_app_ids", () => {
  test("save() sends targetAppId as its own field, always touched (the form always holds a definite current value)", () => {
    assert.match(
      editorSrc,
      /targetAppId: \{ touched: true, value: targetAppId \},/,
    );
  });

  test("articleType is sent the same way", () => {
    assert.match(editorSrc, /articleType: \{ touched: true, value: articleType \},/);
  });
});

group("(8) related_app_ids remains a separate, untouched relationship", () => {
  test("RelatedAppPicker is still present, still bound to `related`/setRelated, unchanged", () => {
    assert.match(editorSrc, /<RelatedAppPicker\s*\n\s*apps=\{apps\}\s*\n\s*selected=\{related\}\s*\n\s*onChange=\{setRelated\}\s*\n\s*\/>/);
  });

  test("save() still sends relatedAppIds: related, distinct from targetAppId", () => {
    assert.match(editorSrc, /relatedAppIds: related,/);
  });

  test("TargetAppPicker's own doc comment states the distinction from RelatedAppPicker explicitly", () => {
    assert.match(pickerSrc, /genuinely different relationship from\s*\n\s*\* RelatedAppPicker/);
  });
});

group("(9) changing type does not leave stale target-app state unintentionally", () => {
  test("switching to General explicitly clears targetAppId — not left as stale hidden state", () => {
    assert.match(
      editorSrc,
      /function onArticleTypeChange\(next: ArticleType\) \{\s*\n\s*setArticleType\(next\);\s*\n\s*if \(next === "general"\) setTargetAppId\(null\);\s*\n\s*\}/,
    );
  });

  test("switching to Review/Other does NOT clear it — only the general branch does", () => {
    const fnBody = editorSrc.slice(
      editorSrc.indexOf("function onArticleTypeChange"),
      editorSrc.indexOf("function validate"),
    );
    assert.doesNotMatch(fnBody, /review_other.*setTargetAppId\(null\)/s);
  });

  test("the Article Type select's onChange calls onArticleTypeChange, not a bare setArticleType", () => {
    assert.match(
      editorSrc,
      /onChange=\{\(e\) => onArticleTypeChange\(e\.target\.value as ArticleType\)\}/,
    );
  });
});

group("(10) existing posts continue to load/edit correctly — no unrelated field changed", () => {
  test("title/slug/description/image/category/content/related/author state initializers are all untouched", () => {
    assert.match(editorSrc, /const \[title, setTitle\] = useState\(post\?\.title \?\? ""\);/);
    assert.match(editorSrc, /const \[slug, setSlug\] = useState\(post\?\.slug \?\? ""\);/);
    assert.match(editorSrc, /const \[category, setCategory\] = useState\(post\?\.category \?\? BLOG_CATEGORIES\[0\]\);/);
    assert.match(editorSrc, /const \[related, setRelated\] = useState<string\[\]>\(post\?\.related_app_ids \?\? \[\]\);/);
  });
});

group("(11) draft save behavior remains intact — no 500-word rule introduced here", () => {
  test("validate() still has no content-length/word-count check — that rule stays in lib/blog-validation.ts's publish-only path", () => {
    const validateBody = editorSrc.slice(
      editorSrc.indexOf("function validate("),
      editorSrc.indexOf("async function save("),
    );
    assert.doesNotMatch(validateBody, /word/i);
    assert.doesNotMatch(validateBody, /MIN_CONTENT_WORDS/);
  });

  test("validate() does add exactly one new rule: app_related requires a target app", () => {
    assert.match(
      editorSrc,
      /if \(articleType === "app_related" && !targetAppId\) \{\s*\n\s*return "Choose which app this article is about\.";\s*\n\s*\}/,
    );
  });

  test("Save as draft button is unchanged — still calls save(false), still disabled during save/upload", () => {
    assert.match(editorSrc, /onClick=\{\(\) => void save\(false\)\}/);
  });
});

group("(12) publish button/workflow remains intact", () => {
  test("the form's submit handler still calls save(true), unchanged", () => {
    assert.match(editorSrc, /void save\(true\);/);
  });

  test("the submit button's label logic (Saving…/Image uploading…/Update post/Publish) is untouched", () => {
    assert.match(
      editorSrc,
      /\{saving \? "Saving…" : imageBusy \? "Image uploading…" : editing \? "Update post" : "Publish"\}/,
    );
  });
});

group("(13) responsive structure — no obvious mobile layout regression", () => {
  test("the conditional target-app block spans both grid columns on sm+, same as FeaturedImageUploader/RelatedAppPicker's own blocks", () => {
    const conditionalBlock = editorSrc.slice(
      editorSrc.indexOf('{articleType !== "general" && ('),
      editorSrc.indexOf("<FeaturedImageUploader"),
    );
    assert.match(conditionalBlock, /className="sm:col-span-2"/);
  });

  test("TargetAppPicker's own controls reuse RelatedAppPicker's existing input/dropdown className patterns rather than inventing new ones", () => {
    assert.match(pickerSrc, /rounded-xl border border-base-700 bg-base-950 px-3\.5 py-2\.5 text-sm outline-none focus:border-brand-500/);
    assert.match(pickerSrc, /absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-base-700 bg-base-850/);
  });

  test("the selected-app chip and per-item dropdown buttons are real <button> elements, keyboard-activatable, not click-only divs", () => {
    assert.match(pickerSrc, /<button\s*\n\s*type="button"\s*\n\s*onClick=\{\(\) => onChange\(null\)\}/);
    assert.match(pickerSrc, /<button\s*\n\s*type="button"\s*\n\s*onClick=\{\(\) => select\(app\.id\)\}/);
  });
});
