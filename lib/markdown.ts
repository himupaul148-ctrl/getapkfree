import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/**
 * Markdown -> sanitised HTML.
 *
 * Sanitising is not optional even though only admins can write posts: raw HTML
 * inside a post body would otherwise become stored XSS served to every reader,
 * so a compromised admin account would escalate into a site-wide problem. That
 * is why this uses the rehype pipeline rather than `marked`, which dropped its
 * sanitiser and has no equivalent.
 *
 * The same function renders the published page and the editor's preview pane,
 * so what an author sees before publishing is exactly what ships.
 */

const schema: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Language hints on fenced code blocks. The default schema drops every
    // className, which would strip `language-ts` and leave highlighting hooks
    // with nothing to match on.
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./]],
    // Allow ordinary links to open elsewhere, but the sanitiser still governs
    // the href protocol, so `javascript:` cannot survive this.
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
  },
};

const processor = unified()
  .use(remarkParse)
  // Tables, strikethrough, task lists and bare autolinks.
  .use(remarkGfm)
  // `allowDangerousHtml: false` is the default and is left alone deliberately:
  // raw HTML in the source never reaches the sanitiser because it is dropped
  // at the bridge.
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

export function renderMarkdown(markdown: string): string {
  if (!markdown?.trim()) return "";
  return String(processor.processSync(markdown));
}

/** Words per minute for an average adult reading technical prose. */
const WPM = 200;

export function readingTime(markdown: string): number {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WPM));
}

/**
 * Plain-text opening of a post, for cards and meta descriptions. Strips the
 * markdown syntax rather than the rendered HTML so link text survives but URLs
 * and heading markers do not.
 */
export function excerpt(markdown: string, length = 150): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    // Whole table rows, not just the pipes — a stray "| a | b |" in a summary
    // reads as broken text rather than as a table.
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (plain.length <= length) return plain;
  const cut = plain.slice(0, length);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : length).trimEnd()}…`;
}
