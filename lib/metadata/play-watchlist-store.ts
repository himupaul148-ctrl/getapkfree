/**
 * Step 2 of the scheduled Play automation layer: the Supabase I/O layer for
 * public.play_watchlist. Every function here writes to exactly one table —
 * there is no code path in this file that could touch `apps`, `versions`,
 * or Storage, since the only `.from(...)` calls anywhere below name
 * "play_watchlist". This mirrors lib/metadata/play-proposal-store.ts's own
 * scope discipline for play_import_proposals.
 *
 * RLS on play_watchlist has no anon policy at all (see
 * 20260914000000_play_watchlist.sql) — every function here must be called
 * with a service-role or authenticated-admin client, never the public anon
 * client, or every read/write below returns nothing/fails silently under
 * RLS rather than throwing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WatchlistRow } from "./play-watchlist.ts";

export const WATCHLIST_SELECT =
  "id, package_name, play_url, enabled, last_checked_at, last_success_at, last_failure_at, last_error, created_at, added_by";

/** Every watchlist row, enabled and disabled alike — partitioning which ones are in scope for a run is play-watchlist.ts's job, not this function's. */
export async function listWatchlistRows(supabase: SupabaseClient): Promise<WatchlistRow[]> {
  const { data, error } = await supabase.from("play_watchlist").select(WATCHLIST_SELECT);
  if (error) throw error;
  return (data ?? []) as WatchlistRow[];
}

/** Recorded before a row is even fetched, so a run that crashes mid-way still shows which rows it reached. */
export async function markWatchlistChecked(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from("play_watchlist")
    .update({ last_checked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** A successful Play fetch clears any prior failure — a row's health reflects its most recent check, not its worst-ever one. */
export async function markWatchlistSuccess(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from("play_watchlist")
    .update({ last_success_at: new Date().toISOString(), last_failure_at: null, last_error: null })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Deliberately never touches last_success_at — a failed check must not
 * erase the record of the last time this row actually worked.
 */
export async function markWatchlistFailure(
  supabase: SupabaseClient,
  id: string,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from("play_watchlist")
    .update({ last_failure_at: new Date().toISOString(), last_error: message })
    .eq("id", id);
  if (error) throw error;
}
