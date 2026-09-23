/**
 * The General layout's compact "Quick Answer" callout — sourced from
 * post.description, the same human-written, already-published summary the
 * page's own <meta name="description"> and every card/listing excerpt
 * already use elsewhere. Deliberately not a separately-authored field or an
 * extracted/generated sentence: reusing the one summary that already exists
 * means this can never invent a claim the rest of the page doesn't already
 * make, and never drifts from it.
 *
 * Renders only when there is a genuine description to show — description is
 * a required, NOT NULL column, but this stays defensive rather than
 * asserting non-null, consistent with every other "only when it actually
 * exists" rule this task applies elsewhere (AppFacts, TargetAppCard).
 */
export default function QuickAnswer({ description }: { description: string }) {
  if (!description.trim()) return null;

  return (
    <div className="mt-6 rounded-2xl border border-brand-500/30 bg-brand-500/5 p-4 sm:p-5">
      <p className="text-xs font-semibold tracking-wide text-brand-300 uppercase">
        Quick Answer
      </p>
      <p className="mt-2 text-sm leading-relaxed text-fg sm:text-base">
        {description}
      </p>
    </div>
  );
}
