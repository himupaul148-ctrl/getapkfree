import { GA_MEASUREMENT_ID, analyticsEnabled } from "@/lib/site-config";

/**
 * Typed wrapper over gtag.
 *
 * Two things this buys over calling `window.gtag` directly:
 *
 * 1. Every call is a no-op when the tag is absent — no measurement ID, an ad
 *    blocker, or a script that has not finished loading. Analytics must never
 *    throw inside a click handler and break the thing the user actually
 *    clicked.
 * 2. Event names and their parameters are a closed union, so a typo is a build
 *    error rather than a report that is quietly empty three weeks later.
 *
 * No personal data passes through here by construction: the union has no field
 * for an email or a username. The only identifier is the Supabase user UUID,
 * which is opaque and is what GA4's User-ID feature expects.
 */

export type GtagEvent =
  | {
      name: "app_download";
      params: {
        app_name: string;
        app_category: string | null;
        version: string | null;
      };
    }
  | { name: "app_favorited"; params: { app_name: string; app_id: string } }
  | {
      name: "blog_post_view";
      params: { post_title: string; post_category: string };
    }
  | { name: "user_signup"; params: { signup_method: "email" } }
  | {
      name: "app_search";
      params: { search_query: string; results_count: number };
    }
  | {
      name: "filter_applied";
      params: { filter_type: string; filter_value: string };
    }
  | { name: "page_view"; params: { page_path: string; page_title?: string } };

type GtagFn = (
  command: "event" | "config" | "js" | "set",
  targetOrEvent: string | Date,
  params?: Record<string, unknown>,
) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
  }
}

/** Warn once, and only while developing — never noise in a user's console. */
let warned = false;
function warnOnce() {
  if (warned || process.env.NODE_ENV === "production") return;
  warned = true;
  console.warn(
    "GA4 not configured — set NEXT_PUBLIC_GA_MEASUREMENT_ID to enable analytics.",
  );
}

function gtag(): GtagFn | null {
  if (typeof window === "undefined") return null;
  if (!analyticsEnabled) {
    warnOnce();
    return null;
  }
  // The script is `afterInteractive`, so an early click can land before
  // window.gtag exists. Returning null loses that one event, which is the
  // right trade against holding up interaction for a tag.
  return window.gtag ?? null;
}

export function track<E extends GtagEvent>(name: E["name"], params: E["params"]) {
  const fn = gtag();
  if (!fn) return;
  try {
    fn("event", name, params as Record<string, unknown>);
  } catch {
    /* analytics must never surface to the user */
  }
}

/**
 * Ties sessions together for a signed-in visitor. The id is the Supabase UUID
 * — no email, no username.
 */
export function setUserId(userId: string) {
  const fn = gtag();
  if (!fn) return;
  try {
    fn("config", GA_MEASUREMENT_ID, { user_id: userId });
  } catch {
    /* ignore */
  }
}

export function clearUserId() {
  const fn = gtag();
  if (!fn) return;
  try {
    fn("config", GA_MEASUREMENT_ID, { user_id: null });
  } catch {
    /* ignore */
  }
}

export function trackPageView(path: string, title?: string) {
  track<Extract<GtagEvent, { name: "page_view" }>>("page_view", {
    page_path: path,
    ...(title ? { page_title: title } : {}),
  });
}
