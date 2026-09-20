import type { AppSummary } from "./types.ts";

/**
 * Whether toSummary() (lib/catalogue.ts) found a currently published build
 * for this app — the exact same "published" signal getCatalogue()'s own
 * fetchCatalogue() already filters the homepage catalogue on. Pulled into
 * its own dependency-free module (no Supabase, no next/cache) so it can be
 * imported and given real behavioral tests under plain `node --test`,
 * unlike lib/catalogue.ts itself (see lib/catalogue.test.ts for why).
 *
 * An app can reach this check with no published version either because it
 * hasn't cleared its first scan yet, or because an admin unpublished it
 * (e.g. for a content-policy violation) — both cases must be treated the
 * same way by any query deciding what is publicly visible.
 */
export function hasPublishedVersion(app: Pick<AppSummary, "latestVersion">): boolean {
  return app.latestVersion !== null;
}
