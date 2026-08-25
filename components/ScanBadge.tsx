import { formatDate } from "@/lib/format";

/**
 * Only a build whose scan actually came back clean earns the green tick.
 * Anything else says so plainly rather than quietly showing nothing.
 */
export default function ScanBadge({
  status,
  scannedAt,
  showDate = true,
}: {
  status: string | null;
  scannedAt: string | null;
  showDate?: boolean;
}) {
  if (status !== "clean") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-base-600 px-2 py-0.5 text-[11px] text-fg-dim">
        Not verified
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-300">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="m5 13 4 4L19 7"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Scanned
      {showDate && scannedAt && (
        <span className="font-normal text-brand-300/70">{formatDate(scannedAt)}</span>
      )}
    </span>
  );
}
