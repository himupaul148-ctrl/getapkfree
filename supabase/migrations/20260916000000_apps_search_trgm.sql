-- Live, app-only header search (see the read-only search audit from this
-- session for the full design). Adds trigram-based fuzzy search over
-- public.apps, plus the one Postgres function the search API actually
-- calls — PostgREST's query builder cannot express "prefer a name-prefix
-- match, then rank by trigram similarity, then by download_count, and only
-- ever include an app that has at least one published version" as a plain
-- .select()/.order() chain, so that logic lives in SQL, not in JavaScript
-- after the fact.
--
-- Nothing here touches RLS. apps/versions keep the exact policies already
-- defined in 20260903000000_baseline_schema.sql — this migration only adds
-- a generated column, an index, and a SECURITY INVOKER function that reads
-- through those same, unmodified policies (a function's own privileges are
-- irrelevant here since both apps and published versions are already
-- publicly readable; INVOKER is used, not DEFINER, because nothing in this
-- function needs to see anything a normal anon reader couldn't already see
-- directly).
create extension if not exists pg_trgm;

-- One column, derived automatically from the fields a search should cover
-- (name, package_name, developer_name, description) — STORED so the GIN
-- index below can actually index it, and GENERATED ALWAYS so it can never
-- drift out of sync with the source columns via a forgotten update.
alter table public.apps
  add column if not exists search_text text generated always as (
    coalesce(name, '') || ' ' ||
    coalesce(package_name, '') || ' ' ||
    coalesce(developer_name, '') || ' ' ||
    coalesce(description, '')
  ) stored;

create index if not exists idx_apps_search_trgm
  on public.apps using gin (search_text gin_trgm_ops);

-- The one function the public search API calls via .rpc(). Read-only,
-- callable by anon (the search endpoint uses the same public/anon client
-- every other public catalogue read already uses — never the service
-- role). Ranking: an app whose name starts with the query sorts first,
-- then by fuzzy similarity, then by download_count as the final
-- tie-breaker — exactly the audit's recommended ranking strategy. The
-- EXISTS clause is the actual, authoritative "has at least one published
-- version" filter: a metadata-only draft app (zero published versions,
-- e.g. a freshly-approved Play proposal) can never appear in a result row,
-- enforced here in SQL rather than left to a caller to remember to filter
-- afterward.
--
-- Fuzzy scoring uses word_similarity(query, a.name) — pg_trgm's function
-- for "how well does this short query match the best substring of a
-- longer string" — applied to `name` specifically, not the full
-- `search_text` blob. Empirically verified against production data before
-- finalizing: plain similarity() over the whole blob scored the correct
-- match for "what" against "WhatsApp Messenger" at only 0.078 (a real
-- match, but BELOW even a permissive 0.15 threshold) while several
-- unrelated apps scored ABOVE that threshold purely from incidental
-- trigram overlap in their (much longer) description text — both a false
-- negative on the real match and false positives on noise, simultaneously.
-- word_similarity(query, name) scored the same real match at 0.8 and
-- every one of those same noise apps at exactly 0. Exact substring
-- coverage across package_name/developer_name/description (the other two
-- required search fields) is still provided by the plain ILIKE clause
-- below — word_similarity only drives the *fuzzy/typo-tolerant* half of
-- matching, and only against the app's name.
create or replace function public.search_apps(query text, max_results integer default 6)
returns table (
  id uuid,
  name text,
  slug text,
  icon_url text,
  category text
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select a.id, a.name, a.slug, a.icon_url, a.category
  from public.apps a
  where
    (
      a.search_text ilike '%' || query || '%'
      or word_similarity(query, a.name) > 0.3
    )
    and exists (
      select 1
      from public.versions v
      where v.app_id = a.id
        and v.published = true
    )
  order by
    (a.name ilike query || '%') desc,
    word_similarity(query, a.name) desc,
    a.download_count desc
  limit greatest(max_results, 0);
$function$;

revoke all on function public.search_apps(text, integer) from public;
grant execute on function public.search_apps(text, integer) to anon, authenticated, service_role;
