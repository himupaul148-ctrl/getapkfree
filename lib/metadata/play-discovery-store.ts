/**
 * Step 4 of the Daily New-App Discovery system: the Supabase I/O layer for
 * public.play_discovery_candidates. Every function here writes to exactly
 * one table — there is no code path in this file that could touch `apps`,
 * `versions`, `play_import_proposals`, or Storage, since the only
 * `.from(...)` call anywhere below names "play_discovery_candidates".
 * Mirrors lib/metadata/play-watchlist-store.ts's own scope discipline.
 *
 * RLS on play_discovery_candidates has no anon policy at all (see
 * 20260915000000_play_discovery_candidates.sql) — every function here
 * must be called with a service-role or authenticated-admin client, never
 * the public anon client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type DiscoverySource = "github" | "hn";

export type DiscoveryCandidateStatus =
  | "found"
  | "disqualified_no_play_link"
  | "disqualified_low_quality"
  | "disqualified_exists"
  | "verified"
  | "proposed"
  | "error";

export type DiscoveryCandidateRow = {
  id: string;
  source: DiscoverySource;
  source_ref: string;
  candidate_name: string | null;
  resolved_play_url: string | null;
  package_name: string | null;
  status: DiscoveryCandidateStatus;
  score: number | null;
  proposal_id: string | null;
  discovered_at: string;
  checked_at: string | null;
};

export const DISCOVERY_CANDIDATE_SELECT =
  "id, source, source_ref, candidate_name, resolved_play_url, package_name, status, score, proposal_id, discovered_at, checked_at";

export async function findDiscoveryCandidate(
  supabase: SupabaseClient,
  source: DiscoverySource,
  sourceRef: string,
): Promise<DiscoveryCandidateRow | null> {
  const { data, error } = await supabase
    .from("play_discovery_candidates")
    .select(DISCOVERY_CANDIDATE_SELECT)
    .eq("source", source)
    .eq("source_ref", sourceRef)
    .maybeSingle<DiscoveryCandidateRow>();
  if (error) throw error;
  return data;
}

/**
 * Inserts a brand-new 'found' candidate. Never accepts a caller-supplied
 * status/resolved_play_url/package_name/proposal_id/checked_at — those
 * only ever come from updateDiscoveryCandidate() once the pipeline has
 * actually done the corresponding work, so this can never accidentally
 * insert a row that looks further along than it really is.
 */
export async function insertDiscoveryCandidate(
  supabase: SupabaseClient,
  row: { source: DiscoverySource; source_ref: string; candidate_name?: string | null; score?: number | null },
): Promise<DiscoveryCandidateRow> {
  const { data, error } = await supabase
    .from("play_discovery_candidates")
    .insert({
      source: row.source,
      source_ref: row.source_ref,
      candidate_name: row.candidate_name ?? null,
      score: row.score ?? null,
      // status, id, discovered_at all come from the table's own defaults.
    })
    .select(DISCOVERY_CANDIDATE_SELECT)
    .single<DiscoveryCandidateRow>();
  if (error) throw error;
  return data!;
}

export type DiscoveryCandidatePatch = Partial<
  Pick<DiscoveryCandidateRow, "status" | "resolved_play_url" | "package_name" | "proposal_id" | "checked_at">
>;

/** The only write path for advancing a candidate's lifecycle — always a plain UPDATE by id, never a second insert. */
export async function updateDiscoveryCandidate(
  supabase: SupabaseClient,
  id: string,
  patch: DiscoveryCandidatePatch,
): Promise<void> {
  const { error } = await supabase.from("play_discovery_candidates").update(patch).eq("id", id);
  if (error) throw error;
}
