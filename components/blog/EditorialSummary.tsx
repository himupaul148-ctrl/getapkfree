/**
 * The Review/Other layout's "At a Glance" summary — same sourcing rule as
 * QuickAnswer (components/blog/QuickAnswer.tsx): built only from
 * post.description, never a generated or invented verdict/score. Kept as its
 * own component rather than reusing QuickAnswer directly so the two types
 * can carry different labelling/styling without an awkward shared prop for
 * "which heading text" — the two are conceptually distinct (an answer vs. an
 * editorial preview), even though today they render structurally similar
 * boxes from the same underlying field.
 *
 * Explicitly does NOT render a rating, score, or pros/cons list — those
 * would be fabricated for any post whose body doesn't already state them,
 * which this task's own constraints forbid.
 */
export default function EditorialSummary({ description }: { description: string }) {
  if (!description.trim()) return null;

  return (
    <div className="mt-6 rounded-2xl border border-base-800 bg-base-900 p-4 sm:p-5">
      <p className="text-xs font-semibold tracking-wide text-fg-dim uppercase">
        At a Glance
      </p>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted sm:text-base">
        {description}
      </p>
    </div>
  );
}
