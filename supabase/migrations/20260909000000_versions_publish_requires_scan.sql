-- Server-side enforcement of the publish invariant the application layer
-- already assumed (lib/admin/version-publish.ts's canPublishVersion): a
-- version may only be published once it has a real, favorable scan verdict.
--
-- Before this migration, "admins manage versions" (see the baseline schema)
-- only checked *who* was writing (is_admin()), never *what* they wrote —
-- canPublishVersion was a UI-side convenience, not a boundary. A direct
-- authenticated write (a raw API call, a future bug in a different admin
-- code path) could set published = true on a pending, flagged, or failed
-- build. This constraint makes that structurally impossible at the database
-- itself, regardless of which code path or client performs the write.
--
-- A CHECK constraint referencing only this row's own two columns is
-- sufficient here — no trigger is needed, since this is not a cross-row or
-- cross-table rule. `published = false or scan_status in (...)` reads as
-- "either it's not published, or its scan status is one of the two eligible
-- values" — an unpublished row is completely unconstrained by this, exactly
-- matching setVersionPublished's own unpublish path having no eligibility
-- check.
alter table public.versions
  add constraint versions_publish_requires_scan_check
  check (published = false or scan_status in ('clean', 'external'));
