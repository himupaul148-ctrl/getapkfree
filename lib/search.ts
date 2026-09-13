/**
 * Live, app-only header search. Every ranking/filtering decision — trigram
 * similarity, the name-prefix boost, the download_count tie-breaker, and
 * critically the "has at least one published version" requirement — lives
 * in the public.search_apps() Postgres function
 * (supabase/migrations/20260916000000_apps_search_trgm.sql), never here.
 * This module only calls it and reshapes the result; it deliberately does
 * NOT re-filter or re-rank anything in JavaScript after the query, since
 * relying on that would risk a metadata-only draft app (zero published
 * versions) slipping through if this file's own logic ever drifted from
 * the SQL's.
 *
 * The caller supplies the Supabase client (see SearchClient below) rather
 * than this module importing one itself — app/api/search/route.ts passes
 * the same public/anon client every other public catalogue read already
 * uses (lib/supabase/public.ts), never the service-role key. This module
 * deliberately never imports that client module directly: it throws at
 * import time if the Supabase env vars aren't set, which would make this
 * file unimportable under this project's plain `node --test` runner (no
 * --env-file) — the same reason lib/catalogue.ts is never imported
 * directly in a test either. Dependency injection here isn't just for
 * testability; it's what keeps this module importable at all under test.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The header component gates on this before firing a request at all — kept here, not duplicated, so the two can't drift. */
export const MIN_QUERY_LENGTH = 2;

/** A light abuse-prevention ceiling — no legitimate search term is anywhere near this long. */
export const MAX_QUERY_LENGTH = 100;

export const MAX_RESULTS = 6;

export type AppSearchResult = {
  id: string;
  name: string;
  slug: string;
  iconUrl: string | null;
  category: string | null;
};

export type SearchQueryValidation =
  | { kind: "empty" }
  | { kind: "too_long" }
  | { kind: "ok"; value: string };

/**
 * Pure query-string validation, extracted out of app/api/search/route.ts
 * so it's directly testable without a Next.js request context — the route
 * itself stays thin plumbing around this, matching every other route in
 * this project (e.g. lib/apk/import-pipeline.ts's own relationship to its
 * route).
 */
export function validateSearchQuery(raw: string): SearchQueryValidation {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) return { kind: "too_long" };
  if (!trimmed) return { kind: "empty" };
  return { kind: "ok", value: trimmed };
}

type RawSearchRow = {
  id: string;
  name: string;
  slug: string;
  icon_url: string | null;
  category: string | null;
};

/**
 * The one Supabase capability this module actually needs — narrowed to
 * `rpc` alone (rather than the full SupabaseClient) so a test can pass a
 * minimal fake without constructing anything else.
 */
export type SearchClient = Pick<SupabaseClient, "rpc">;

function toResult(row: RawSearchRow): AppSearchResult {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    iconUrl: row.icon_url,
    category: row.category,
  };
}

/**
 * Searches published apps only, via public.search_apps(). An empty (after
 * trimming) query returns an empty array without ever calling the
 * database — there is nothing meaningful to rank an empty string against.
 */
export async function searchApps(
  query: string,
  client: SearchClient,
): Promise<AppSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { data, error } = await client.rpc("search_apps", {
    query: trimmed,
    max_results: MAX_RESULTS,
  });
  if (error) throw error;

  return ((data ?? []) as RawSearchRow[]).map(toResult);
}
