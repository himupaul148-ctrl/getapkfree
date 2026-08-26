import type { SourceType } from "@/lib/sources";
import { providerFromUrl, sourceShortLabel } from "@/lib/sources";

/**
 * Says where a download comes from. External listings get the azure tone
 * rather than the brand green, because green on this site means "we scanned
 * this build" and an external app is precisely the one we did not.
 */
export default function SourceBadge({
  sourceType,
  externalUrl,
  size = "sm",
}: {
  sourceType: SourceType;
  externalUrl: string | null;
  size?: "sm" | "md";
}) {
  const external = sourceType === "external";
  const label = sourceShortLabel(sourceType, externalUrl);
  const provider = providerFromUrl(external ? externalUrl : null);

  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium",
        size === "md" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs",
        external
          ? "bg-azure-500/10 text-azure-300"
          : "bg-brand-500/10 text-brand-300",
      ].join(" ")}
    >
      <Glyph provider={external ? provider : "fdroid"} />
      {label}
    </span>
  );
}

function Glyph({ provider }: { provider: string }) {
  // An outbound arrow for anything that leaves the site, a package for the
  // repo builds we link into directly.
  const outbound = provider !== "fdroid" && provider !== "fdroid-repo";

  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {outbound ? (
        <path
          d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v18m8-13.5-8 4.5-8-4.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
