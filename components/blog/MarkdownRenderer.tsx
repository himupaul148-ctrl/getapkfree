/**
 * The sanitised article body — extracted from BlogArticleView unchanged
 * (byte-identical base classNames) so no existing published post's
 * appearance changes as part of introducing the three layouts.
 *
 * `extraClassName` lets one layout (Review/Other) add purely visual
 * emphasis on top of the shared base — e.g. turning listicle `<ol>` items
 * into distinct cards — without duplicating the entire class list for a
 * handful of extra rules, and without touching General/App Related's own
 * unchanged appearance.
 *
 * Content is sanitised in renderMarkdown before it reaches here — script
 * tags, event-handler attributes and javascript: hrefs are all stripped, so
 * this is not raw author HTML.
 */
export default function MarkdownRenderer({
  html,
  extraClassName = "",
}: {
  html: string;
  extraClassName?: string;
}) {
  return (
    <div
      className={`mt-10 leading-relaxed text-fg-muted [&>*+*]:mt-5 [&_a]:text-brand-400 [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-base-700 [&_blockquote]:pl-4 [&_blockquote]:text-fg-dim [&_code]:rounded [&_code]:bg-base-850 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm [&_code]:break-words [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-fg [&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-bold [&_h3]:text-fg [&_img]:rounded-xl [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-base-800 [&_pre]:bg-base-950 [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:text-fg [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:border-base-800 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-base-800 [&_th]:px-3 [&_th]:py-2 [&_th]:text-fg [&_ul]:space-y-1 ${extraClassName}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
