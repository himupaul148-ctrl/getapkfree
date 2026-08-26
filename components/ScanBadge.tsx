import { formatDate } from "@/lib/format";

type Tone = {
  className: string;
  label: string;
  icon: React.ReactNode;
};

const CHECK = (
  <path
    d="m5 13 4 4L19 7"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

const CLOCK = (
  <>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" />
    <path
      d="M12 7v5l3 2"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
);

const WARN = (
  <>
    <path
      d="M12 3 2 20h20L12 3z"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
    <path d="M12 10v4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="12" cy="17" r="1.1" fill="currentColor" />
  </>
);

const LINK = (
  <path
    d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

/**
 * Three states, each visually distinct:
 *   clean   -> green tick, the only one that reaches the public site
 *   pending -> amber, scanned nothing yet
 *   flagged -> red, held back from the catalogue and shown only in /admin
 *
 * `failed` shares the red treatment: from a reader's point of view a build
 * whose scan errored is no more trustworthy than one that was flagged.
 *
 * `external` is not a scan result at all — it marks a listing we redirect to
 * the official publisher. Azure rather than green, because green on this site
 * means "we scanned this build" and this is the case where we did not.
 */
const TONES: Record<string, Tone> = {
  clean: {
    className:
      "border-brand-500/30 bg-brand-500/10 text-brand-300",
    label: "Scanned",
    icon: CHECK,
  },
  pending: {
    className: "border-warn-500/40 bg-warn-500/10 text-warn-300",
    label: "Pending scan",
    icon: CLOCK,
  },
  flagged: {
    className: "border-danger-500/40 bg-danger-500/10 text-danger-300",
    label: "Flagged",
    icon: WARN,
  },
  failed: {
    className: "border-danger-500/40 bg-danger-500/10 text-danger-300",
    label: "Scan failed",
    icon: WARN,
  },
  external: {
    className: "border-azure-500/40 bg-azure-500/10 text-azure-300",
    label: "Official source",
    icon: LINK,
  },
};

export default function ScanBadge({
  status,
  scannedAt,
  showDate = true,
}: {
  status: string | null;
  scannedAt: string | null;
  showDate?: boolean;
}) {
  const tone = status ? TONES[status] : undefined;

  if (!tone) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-base-600 px-2 py-0.5 text-[11px] text-fg-dim">
        Not verified
      </span>
    );
  }

  // A date only means something once a scan actually ran.
  const date =
    status !== "pending" && status !== "external" && scannedAt
      ? formatDate(scannedAt)
      : null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.className}`}
      title={date ? `${tone.label} ${date}` : tone.label}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {tone.icon}
      </svg>
      {tone.label}
      {showDate && date && <span className="font-normal">{date}</span>}
    </span>
  );
}
