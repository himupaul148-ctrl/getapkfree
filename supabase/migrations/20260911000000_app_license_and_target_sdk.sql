-- Adds two nullable, machine-sourced facts backed by P2-1's audit:
--
--   apps.license       — SPDX identifier string, app-level (varies by
--                         project/source, not by build — F-Droid's own
--                         index-v1.json models it the same way, one
--                         `license` string per app entry).
--   versions.target_sdk — raw numeric Android API level, per-build (F-Droid's
--                         index carries `targetSdkVersion` per build entry,
--                         and it has been observed to differ across a single
--                         app's own build history — it is not an app-level
--                         constant).
--
-- Both nullable, no default: neither field is authoritative for every row
-- today (external apps have neither), and this migration performs no
-- backfill — that is a separate, explicit follow-up step, not part of this
-- schema change.
alter table public.apps
  add column license text null;

alter table public.versions
  add column target_sdk integer null;
