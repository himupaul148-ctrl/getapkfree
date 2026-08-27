"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { clearUserId, setUserId, trackPageView } from "@/lib/gtag";
import { useSessionProfile } from "@/lib/useSessionProfile";

/**
 * Page views on client-side navigation, plus User-ID for signed-in visitors.
 *
 * GA4's enhanced measurement does pick up History API navigations by itself,
 * but that depends on a toggle inside the GA console which is invisible from
 * the code. Sending the view explicitly means the behaviour is defined here.
 *
 * Must be rendered inside <Suspense>: useSearchParams() opts its whole subtree
 * into client rendering, and without a boundary that would reach the root
 * layout and cost the static shell every page depends on.
 */
export default function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { userId } = useSessionProfile();

  // The first page view is already sent by gtag('config', …) in the tag
  // itself, so sending one on mount would double-count every landing.
  const seenFirst = useRef(false);

  useEffect(() => {
    const query = searchParams.toString();
    const path = query ? `${pathname}?${query}` : pathname;

    if (!seenFirst.current) {
      seenFirst.current = true;
      return;
    }

    trackPageView(path, document.title);
  }, [pathname, searchParams]);

  useEffect(() => {
    if (userId) setUserId(userId);
    else clearUserId();
  }, [userId]);

  return null;
}
