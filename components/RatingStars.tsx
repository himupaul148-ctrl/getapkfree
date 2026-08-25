import { formatCount } from "@/lib/format";

function Row({ className }: { className: string }) {
  return (
    <div className={className} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3L7 14.2l-5-4.9 6.9-1z" />
        </svg>
      ))}
    </div>
  );
}

/**
 * Two stacked star rows, the filled one clipped to the score — this renders
 * fractional ratings (4.3 of 5) accurately rather than rounding to half stars.
 */
export default function RatingStars({
  rating,
  count,
  showCount = true,
  compact = false,
}: {
  rating: number | null;
  count?: number;
  showCount?: boolean;
  /** Card-sized: score only, no star row, to keep the metadata line short. */
  compact?: boolean;
}) {
  if (rating === null) {
    return <span className="text-sm text-fg-dim">Not yet rated</span>;
  }

  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-fg-muted"
        title={`Rated ${rating} out of 5`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400" aria-hidden="true">
          <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3L7 14.2l-5-4.9 6.9-1z" />
        </svg>
        {rating.toFixed(1)}
        {showCount && count !== undefined && (
          <span className="text-fg-dim">({formatCount(count)})</span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="relative inline-block"
        role="img"
        aria-label={`Rated ${rating} out of 5`}
      >
        <Row className="flex gap-0.5 text-base-600" />
        <span
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${pct}%` }}
        >
          <Row className="flex gap-0.5 text-amber-400" />
        </span>
      </span>
      <span className="text-sm font-medium text-fg">{rating.toFixed(1)}</span>
      {showCount && count !== undefined && (
        <span className="text-sm text-fg-dim">({formatCount(count)})</span>
      )}
    </span>
  );
}
