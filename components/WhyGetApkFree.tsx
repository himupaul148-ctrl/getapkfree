/**
 * Static value-proposition grid — every claim here mirrors copy already
 * used elsewhere on the site (the hero's "Scanned or official" pill, the
 * F-Droid scan/changelog description, the app detail page's permissions
 * and version history), not a new claim invented for this section.
 */
const REASONS = [
  {
    title: "Safe & Transparent",
    description: "F-Droid builds are malware-scanned by file hash before they're listed.",
    icon: ShieldIcon,
  },
  {
    title: "Open-Source Focused",
    description: "Most apps link straight to their public source, not a black box.",
    icon: CodeIcon,
  },
  {
    title: "Detailed App Information",
    description: "Real versions, permissions and changelogs on every app page.",
    icon: InfoIcon,
  },
  {
    title: "Easy APK Downloads",
    description: "No account needed — download or install directly.",
    icon: DownloadIcon,
  },
];

export default function WhyGetApkFree() {
  return (
    <section className="mt-12 sm:mt-20">
      <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Why GetApkFree?</h2>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-4 lg:grid-cols-4">
        {REASONS.map(({ title, description, icon: Icon }) => (
          <div
            key={title}
            className="rounded-2xl border border-brand-500/20 bg-brand-500/5 p-4 sm:p-5"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/15 text-brand-500">
              <Icon />
            </span>
            <p className="mt-3 text-sm font-semibold text-fg">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function iconProps() {
  return {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function ShieldIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg {...iconProps()}>
      <path d="m9 8-4 4 4 4m6-8 4 4-4 4" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 3v12m0 0-4-4m4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
