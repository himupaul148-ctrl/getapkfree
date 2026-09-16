/**
 * Pure ordering logic for getRelatedApps() (lib/blog.ts). Pulled out into
 * its own dependency-free module — no Supabase, no next/cache — so it can
 * be imported and given real behavioral tests under plain `node --test`,
 * unlike lib/blog.ts itself (blocked by its `unstable_cache` import, the
 * same constraint documented throughout this project).
 *
 * The bug this fixes: getRelatedApps() used to call `.limit(n)` on the
 * `.in("id", ids)` Supabase query itself. An `.in()` query carries no
 * ORDER BY of its own, so for a related_app_ids list longer than the
 * sidebar's display limit, Postgres could hand back an arbitrary `n` rows
 * — not necessarily the first `n` in the author's chosen order — before
 * this module's own reordering ever ran. The fix is to fetch every
 * requested row (no database-side limit), reorder here, and only then cut
 * down to `limit`.
 */

/** Reorders `rows` to match the position of each row's `id` in `ids` (the
 *  order related_app_ids was written in), then returns at most `limit` of
 *  them. A row whose id isn't in `ids` at all sorts as if it were first
 *  (index 0) — this only ever happens for a caller-supplied row that
 *  doesn't belong, which getRelatedApps() never does, since every row it
 *  passes in came from a `.in("id", ids)` query in the first place.
 *
 *  Missing ids (an id in `ids` with no matching row — e.g. a deleted app)
 *  simply have no row to place: the surviving rows keep their relative
 *  order exactly as `ids` specifies, nothing shifts to fill the gap.
 *
 *  A duplicate id in `ids` is never expanded into two rows (an `.in()`
 *  query returns each matching row once, id being the table's primary
 *  key); the existing behavior of using that id's *last* occurrence in
 *  `ids` for its sort position is preserved unchanged, not altered by this
 *  fix. */
export function orderAndLimitRelatedApps<T extends { id: string }>(
  rows: readonly T[],
  ids: readonly string[],
  limit: number,
): T[] {
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...rows]
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .slice(0, limit);
}
