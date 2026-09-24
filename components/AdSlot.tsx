"use client";

import { useEffect, useRef } from "react";
import { ADSENSE_CLIENT, adsEnabled } from "@/lib/site-config";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * The one reusable ad-slot component for this site — infrastructure only,
 * not yet placed on any page (see the AdSense/CSP audit's own report for
 * recommended placements, decided separately from this component's shape).
 *
 * Renders nothing at all when ads aren't configured (adsEnabled false, the
 * site's actual state today) — no placeholder box, no reserved space, so a
 * page with this component mounted but ads disabled is byte-identical to one
 * without it. When enabled, it pushes exactly one `{}` to `window.adsbygoogle`
 * per mount (the call Google's own snippet requires to request a unit), and
 * unmounting/remounting (e.g. a client-side route change) never accumulates
 * duplicate requests for the same slot since each mount owns its own ref
 * guard.
 */
export default function AdSlot({
  slotId,
  className = "",
  label = "Advertisement",
}: {
  /** The AdSense ad-unit slot ID (data-ad-slot) — distinct per placement. */
  slotId: string;
  className?: string;
  /** Accessible label for the containing region — never read as page content. */
  label?: string;
}) {
  const pushed = useRef(false);

  useEffect(() => {
    if (!adsEnabled || pushed.current) return;
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (caught) {
      // A failed ad request must never break the page around it.
      console.error("AdSlot: adsbygoogle push failed", caught);
    }
  }, []);

  if (!adsEnabled) return null;

  return (
    <div
      className={`w-full overflow-hidden ${className}`}
      role="complementary"
      aria-label={label}
    >
      <ins
        className="adsbygoogle block"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
