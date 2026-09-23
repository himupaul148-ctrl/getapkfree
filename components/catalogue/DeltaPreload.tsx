import { preload } from "react-dom";
import { getCatalogue } from "@/lib/catalogue";
import { deltaPreloadUrl } from "@/lib/catalogue-delta";

/**
 * PREVIEW EXPERIMENT — Variant B early-preload investigation. Not yet
 * committed.
 *
 * A minimal Server Component rendered as its own Suspense sibling,
 * structurally BEFORE <HomeSections>'s boundary in app/page.tsx. It does
 * nothing but await the same cache()-deduped getCatalogue() call
 * HomeSections already makes, call preload() for the delta endpoint, and
 * render null — no carousel/category/card JSX to serialize, so once the
 * shared getCatalogue() promise resolves this boundary has far less
 * synchronous work left before it can flush than HomeSections' own, much
 * larger boundary does.
 */
export default async function DeltaPreload() {
  const { apps, error } = await getCatalogue();
  if (!error && apps.length > 0) {
    preload(deltaPreloadUrl(apps), { as: "fetch", crossOrigin: "anonymous" });
  }
  return null;
}
