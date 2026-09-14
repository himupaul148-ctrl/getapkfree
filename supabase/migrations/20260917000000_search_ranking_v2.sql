-- Search Ranking V2 — fixes two production relevance problems found in a
-- read-only audit of the original public.search_apps() (see
-- 20260916000000_apps_search_trgm.sql):
--
--   1. "telegram" surfaced Mercurygram/Goregram/Nonogram/Instagram — all
--      coincidental trigram overlap with the "-gram" suffix, not
--      plausible typos of "telegram".
--   2. "discord" surfaced exactly one result, "SyncRecord" — again pure
--      trigram-overlap noise, not a relevant match — while the one
--      correct answer (the real Discord app) has no published version and
--      is correctly excluded, so the honest answer is zero results, not
--      one wrong one.
--
-- Root cause: the old function had only 3 ranking tiers (name-prefix,
-- name-fuzzy, download_count), so package/developer/description matches
-- and weak name-fuzz all fell into one undifferentiated bucket sorted
-- almost entirely by download_count — which is exactly how an unrelated
-- app can end up ranked at or above a genuinely relevant one.
--
-- This migration CREATE OR REPLACEs the same function — same name, same
-- parameters (query text, max_results integer default 6), same return
-- table shape (id, name, slug, icon_url, category) — so no application
-- code changes anywhere (lib/search.ts, app/api/search/route.ts,
-- components/HeaderSearch.tsx are all untouched). Same grants, same
-- SECURITY INVOKER, same STABLE, same published-version EXISTS safety
-- check, same RLS (untouched, exactly as before).
--
-- ---------------------------------------------------------------------
-- SEVEN ranking tiers, evaluated in this order (1 = best):
--   1. Exact normalized app-name match
--      lower(trim(a.name)) = lower(trim(query))
--   2. App-name prefix match
--      a.name ilike query || '%'
--   3. App-name whole-word match
--      lower(query) = any(regexp_split_to_array(lower(a.name), '\W+'))
--      Deliberately NOT built from a regex containing the raw query —
--      '\W+' is a fixed, hardcoded split pattern; the user's query is
--      only ever compared as a plain string value against the resulting
--      array, so there is no way for query content to be interpreted as
--      regex syntax at all.
--   4. Strong fuzzy app-name match
--      char_length(query) >= 5 and word_similarity(query, a.name) > 0.45
--      Both the length gate and the 0.45 threshold are the direct result
--      of empirical testing against this production database before
--      finalizing (see the numbers below) — not a guess:
--        word_similarity('whatasp', 'WhatsApp Messenger')          = 0.5     -> KEEP (the one real typo case this tier exists for)
--        word_similarity('discord', 'SyncRecord')                  = 0.375   -> REJECT
--        word_similarity('telegram', 'Mercurygram Tor Plugin')     = 0.444.. -> REJECT
--        word_similarity('telegram', 'Goregram')                   = 0.444.. -> REJECT
--        word_similarity('telegram', 'Instagram')                  = 0.333.. -> REJECT
--        word_similarity('telegram', 'Nonogram')                   = 0.333.. -> REJECT
--      0.45 sits strictly between the real match (0.5) and the highest
--      rejected false positive (0.444...), rejecting every case above
--      while keeping the one case this tier must preserve.
--      The length gate (>= 5) exists because word_similarity on very
--      short queries is independently noisy in a way no single threshold
--      fixes: word_similarity('what', 'Status - Chat, Wallet, Browser')
--      measured at 0.6 — HIGHER than the genuine 'whatasp'/WhatsApp typo
--      match (0.5) — purely because "Chat" and "what" coincidentally
--      share the "hat" trigram. Excluding queries under 5 characters from
--      this tier removes that noise entirely without any loss: "what"'s
--      own real match (WhatsApp Messenger) is already caught by tier 2
--      (prefix match) regardless, since 'whatsapp messenger' ilike
--      'what%' is true on its own.
--   5. Package-name match
--      a.package_name ilike '%' || query || '%'
--   6. Developer-name match
--      a.developer_name ilike '%' || query || '%'
--   7. Description-only match (the lowest tier — never a proxy for name
--      relevance; the whole point of this migration is that a
--      description hit can never outrank any tier above it, regardless
--      of download_count)
--
-- Within any tier, download_count desc is the only tiebreaker — exactly
-- as specified, with no secondary fuzzy-score ordering.
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
      lower(trim(a.name)) = lower(trim(query))
      or a.name ilike query || '%'
      or lower(query) = any (regexp_split_to_array(lower(a.name), '\W+'))
      or (char_length(query) >= 5 and word_similarity(query, a.name) > 0.45)
      or a.package_name ilike '%' || query || '%'
      or a.developer_name ilike '%' || query || '%'
      or a.description ilike '%' || query || '%'
    )
    and exists (
      select 1
      from public.versions v
      where v.app_id = a.id
        and v.published = true
    )
  order by
    case
      when lower(trim(a.name)) = lower(trim(query)) then 1
      when a.name ilike query || '%' then 2
      when lower(query) = any (regexp_split_to_array(lower(a.name), '\W+')) then 3
      when char_length(query) >= 5 and word_similarity(query, a.name) > 0.45 then 4
      when a.package_name ilike '%' || query || '%' then 5
      when a.developer_name ilike '%' || query || '%' then 6
      else 7
    end asc,
    a.download_count desc
  limit greatest(max_results, 0);
$function$;

revoke all on function public.search_apps(text, integer) from public;
grant execute on function public.search_apps(text, integer) to anon, authenticated, service_role;
