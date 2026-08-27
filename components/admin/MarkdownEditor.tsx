"use client";

import { useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";

type Tool = {
  label: string;
  title: string;
  /** Wraps the selection, or inserts at the caret when nothing is selected. */
  before: string;
  after?: string;
  /** Placeholder used when there is no selection to wrap. */
  sample: string;
  /** Line-level tools apply at the start of the line instead of wrapping. */
  block?: boolean;
};

const TOOLS: Tool[] = [
  { label: "B", title: "Bold", before: "**", after: "**", sample: "bold text" },
  { label: "I", title: "Italic", before: "_", after: "_", sample: "italic text" },
  { label: "H2", title: "Heading 2", before: "## ", sample: "Heading", block: true },
  { label: "H3", title: "Heading 3", before: "### ", sample: "Heading", block: true },
  { label: "Link", title: "Link", before: "[", after: "](/app/slug)", sample: "link text" },
  { label: "Code", title: "Inline code", before: "`", after: "`", sample: "code" },
  { label: "Block", title: "Code block", before: "```\n", after: "\n```", sample: "code" },
  { label: "List", title: "Bulleted list", before: "- ", sample: "item", block: true },
  { label: "Quote", title: "Quote", before: "> ", sample: "quote", block: true },
];

/**
 * Split markdown editor.
 *
 * The preview calls the same `renderMarkdown` the published page uses, so what
 * an author approves here is byte-identical to what ships — including the
 * sanitiser, which means a preview also shows exactly what gets stripped.
 */
export default function MarkdownEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"split" | "write" | "preview">("split");

  function apply(tool: Tool) {
    const el = ref.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const body = selected || tool.sample;

    let insert: string;
    let caretStart: number;
    let caretEnd: number;

    if (tool.block) {
      // Anchor to the start of the current line so "## " lands in column one
      // rather than mid-sentence.
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      insert = tool.before;
      const next = value.slice(0, lineStart) + insert + value.slice(lineStart);
      onChange(next);
      caretStart = caretEnd = start + insert.length;
      queueMicrotask(() => {
        el.focus();
        el.setSelectionRange(caretStart, caretEnd);
      });
      return;
    }

    insert = `${tool.before}${body}${tool.after ?? ""}`;
    const next = value.slice(0, start) + insert + value.slice(end);
    onChange(next);

    // Select the placeholder so typing replaces it immediately.
    caretStart = start + tool.before.length;
    caretEnd = caretStart + body.length;
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(caretStart, caretEnd);
    });
  }

  const html = renderMarkdown(value);

  return (
    <div className="rounded-2xl border border-base-700 bg-base-950">
      <div className="flex flex-wrap items-center gap-1 border-b border-base-800 p-2">
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            type="button"
            title={tool.title}
            onClick={() => apply(tool)}
            className="rounded-lg px-2.5 py-1.5 font-mono text-xs text-fg-muted transition-colors hover:bg-base-800 hover:text-fg"
          >
            {tool.label}
          </button>
        ))}

        <div className="ml-auto flex gap-1">
          {(["write", "split", "preview"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setTab(mode)}
              className={`rounded-lg px-2.5 py-1.5 text-xs capitalize transition-colors ${
                tab === mode
                  ? "bg-base-800 text-fg"
                  : "text-fg-dim hover:text-fg-muted"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div
        className={
          tab === "split"
            ? "grid divide-base-800 md:grid-cols-2 md:divide-x"
            : "block"
        }
      >
        {tab !== "preview" && (
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck
            rows={22}
            placeholder="Write the post in markdown…"
            className="w-full resize-y bg-transparent p-4 font-mono text-sm leading-relaxed outline-none"
          />
        )}

        {tab !== "write" && (
          <div className="min-w-0 overflow-x-auto p-4">
            {value.trim() ? (
              <div
                className="leading-relaxed text-fg-muted [&>*+*]:mt-4 [&_a]:text-brand-400 [&_blockquote]:border-l-2 [&_blockquote]:border-base-700 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-base-850 [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-fg [&_h3]:mt-5 [&_h3]:font-bold [&_h3]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-base-900 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_strong]:text-fg [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:border-base-800 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-base-800 [&_th]:px-2 [&_th]:py-1"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <p className="text-sm text-fg-dim">Preview appears here.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
