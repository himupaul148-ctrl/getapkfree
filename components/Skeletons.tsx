/**
 * Placeholders shaped like the real thing, so the layout does not jump when
 * content arrives. `animate-pulse` respects the reduced-motion rule in
 * globals.css, which collapses the animation rather than removing the shape.
 */

function Block({ className }: { className: string }) {
  return <div className={`rounded bg-base-800 ${className}`} aria-hidden="true" />;
}

/** Mirrors AppCard: icon, title, developer, category pill, blurb, badges, meta. */
export function AppCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-base-800 bg-base-900 p-5">
      <div className="flex items-start gap-4 pr-10">
        <div className="h-14 w-14 shrink-0 rounded-xl bg-base-800" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <Block className="h-4 w-2/3" />
          <Block className="h-3 w-1/2" />
          <Block className="h-5 w-20 rounded-full" />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Block className="h-3 w-full" />
        <Block className="h-3 w-4/5" />
      </div>

      <Block className="mt-4 h-5 w-28 rounded-full" />

      <div className="mt-4 flex gap-3 border-t border-base-800 pt-3">
        <Block className="h-3 w-12" />
        <Block className="h-3 w-20" />
        <Block className="h-3 w-14" />
      </div>
    </div>
  );
}

export function AppGridSkeleton({
  count = 6,
  className = "grid gap-5 sm:grid-cols-2 lg:grid-cols-3",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className} role="status" aria-label="Loading apps">
      {Array.from({ length: count }, (_, i) => (
        <AppCardSkeleton key={i} />
      ))}
      <span className="sr-only">Loading apps…</span>
    </div>
  );
}

export function SectionHeadingSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <Block className="h-7 w-48" />
      <Block className="h-4 w-72 max-w-full" />
    </div>
  );
}

/** Matches the eight category cards. */
export function CategoryGridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
      role="status"
      aria-label="Loading categories"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-base-800 bg-base-900 p-5"
        >
          <div className="h-10 w-10 rounded-xl bg-base-800" aria-hidden="true" />
          <Block className="mt-3 h-4 w-24" />
          <Block className="mt-3 h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Matches the Recently updated list rows. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="divide-y divide-base-800 overflow-hidden rounded-2xl border border-base-800 bg-base-900"
      role="status"
      aria-label="Loading list"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-5 py-4">
          <Block className="h-4 flex-1" />
          <Block className="hidden h-3 w-20 sm:block" />
          <Block className="h-3 w-14" />
          <Block className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
