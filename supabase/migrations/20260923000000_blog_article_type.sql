-- Foundation for the three-type blog article system (GENERAL / APP_RELATED /
-- REVIEW_OTHER) — see the approved architecture inspection. This migration
-- only adds columns/constraints; no application code reads or writes them
-- yet, and no existing row's data is touched.
--
--   article_type  — mirrors blog_posts.category's own existing pattern
--                    exactly: `not null default`, plus a CHECK against a
--                    fixed allowed-values array. Defaulting every existing
--                    and future-until-updated row to 'general' means this
--                    migration requires no backfill and cannot invalidate
--                    any row that exists today.
--   target_app_id — nullable, single-app relationship, deliberately a real
--                   foreign key (unlike related_app_ids text[], which this
--                   table's own baseline comment explains is intentionally
--                   NOT a foreign key, so a deleted app can drop out of a
--                   post's sidebar rather than block the delete).
--                   target_app_id represents a different relationship — one
--                   post, one specific app it is about — so `on delete set
--                   null` is used instead: deleting that app should not
--                   delete or block deleting the article, only clear its
--                   target-app link. This is the same nullable,
--                   set-null-on-delete pattern already used for
--                   play_import_proposals.app_id in
--                   20260913000000_play_import_proposals.sql, applied here
--                   for the identical reason.
--
-- The article_type/target_app_id relationship itself — app_related requires
-- a target app; general and review_other never require one, though
-- review_other may optionally carry one (e.g. a single-app review) — is
-- enforced by the second CHECK constraint below, written the same
-- "P implies Q" way blog_posts's sibling table already does in
-- 20260909000000_versions_publish_requires_scan.sql
-- (`published = false or scan_status in (...)`).
alter table public.blog_posts
  add column article_type text not null default 'general',
  add column target_app_id uuid null references public.apps(id) on delete set null;

alter table public.blog_posts
  add constraint blog_posts_article_type_check
  check (article_type = any (array['general', 'app_related', 'review_other']));

-- "article_type is not 'app_related', or target_app_id is set" — an
-- app_related post must name its one target app; general and review_other
-- rows are unconstrained by this (review_other's target_app_id is genuinely
-- optional, general's is expected to stay null but is not forced to by this
-- constraint, matching what was actually requested — see this task's own
-- report for why a stricter rule was not invented here).
alter table public.blog_posts
  add constraint blog_posts_article_type_target_app_check
  check (article_type != 'app_related' or target_app_id is not null);
