#!/usr/bin/env node
/**
 * One-time backfill for the related_app_ids publishing bug (see
 * app/api/admin/blog/publish/route.ts / lib/blog-related-app-ids.ts): the
 * git-based publish pipeline silently dropped related_app_ids on every
 * write until that fix landed, leaving 34 of 36 published posts with an
 * empty array even where their content links real, resolvable /app/<slug>
 * pages.
 *
 * This script does NOT re-derive relationships from title/slug/content at
 * write time. TARGETS below is the exact, static output of a completed
 * read-only audit: every post classified SAFE_TO_BACKFILL — every
 * /app/<slug> link in its content resolved to a real, current app, with no
 * duplicates. The post id and app UUIDs are copied verbatim from that
 * audit; this script only re-verifies they still hold before writing.
 *
 * Two other posts already have non-empty related_app_ids and are
 * deliberately EXCLUDED, not touched by this script at all:
 *   - best-privacy-apps-android-2026 (retired/redirected): 2 of its 5
 *     content links don't resolve to any current app, and its own stored
 *     related_app_ids are entirely stale (all 5 point to deleted apps).
 *   - top-lightweight-tools-under-10mb: its 3 content-linked apps are
 *     already correctly present, but the stored array also carries 2 extra
 *     stale IDs unrelated to any content link.
 * Both are separate, reviewed editorial/cleanup decisions — not this
 * script's job.
 *
 *   node --env-file=.env.local scripts/backfill-related-app-ids.mjs             # dry run (no writes)
 *   node --env-file=.env.local scripts/backfill-related-app-ids.mjs --dry-run   # same, explicit
 *   node --env-file=.env.local scripts/backfill-related-app-ids.mjs --apply     # writes
 *
 * SAFETY, enforced in two independent places:
 *   1. Application-level preflight: re-fetches all 11 target rows in one
 *      batched query and refuses to write anything unless every row still
 *      exists, is still published, and still has related_app_ids = '{}' —
 *      and every proposed app UUID still exists in `apps`.
 *   2. Database-level guard: every UPDATE carries
 *      .eq("related_app_ids", []) alongside .eq("id", ...), so even a
 *      write that raced past the preflight (e.g. a concurrent admin edit)
 *      touches zero rows instead of overwriting curated data.
 */

import { createClient } from "@supabase/supabase-js";

/** Slugs this script must never touch, no matter what — a second, explicit
 *  belt-and-braces check alongside "not present in TARGETS". */
export const EXCLUDED_SLUGS = Object.freeze([
  "best-privacy-apps-android-2026",
  "top-lightweight-tools-under-10mb",
]);

export const TARGETS = Object.freeze([
  {
    slug: "best-open-source-internet-networking-apps-android",
    id: "a4af186a-0244-45a4-8a2e-92ed4cc592ae",
    relatedAppIds: [
      "432a38fd-1beb-4765-83e5-9f532366cbf1",
      "942eee66-c7a1-4afb-8c58-23500b0b566b",
      "79f805a9-da76-491a-b443-11d0b1a599a0",
      "c8b2d8f0-8196-4274-b8bf-a952e4cc1d7b",
      "7691e7cc-ee4a-4102-b09b-99c0b031d98c",
      "f29c41e6-293e-46cf-a3ab-1d83b2b00f23",
      "322d77bb-a4f6-4217-b6e2-8526fc3f25eb",
      "f40586d8-d7f8-4b88-824a-f45ffe842989",
      "9b9a3bf2-bb71-49e3-93e1-389fc3a145d0",
      "b8dd7a09-0e66-445b-9390-748cd94e762e",
    ],
  },
  {
    slug: "best-open-source-productivity-apps-android",
    id: "dd15f110-3fe8-45b1-b752-0f6a41cf7a91",
    relatedAppIds: [
      "23f42f39-9ec3-4b54-b746-a5e083e6a3cc",
      "cab6ec58-e6b4-41f8-adc5-a6a6a387bef5",
      "bcb9fab0-9a26-45aa-8c11-3241f4986406",
      "738ff5b5-796d-46a4-ade7-dec23efa0ca0",
      "170edec9-6d76-49e1-931b-dba92366373c",
      "c1fffa0d-d303-40a9-8065-9143a1a891f1",
      "d919bc25-3100-4d65-8169-d624ce2f37ed",
      "6fdda89d-feb1-4b7e-93c0-1791613cf45a",
      "9a5207e8-1d60-4a77-97fe-baef86c87836",
      "5d663940-12ff-45c6-84d3-1ac001a3ced5",
    ],
  },
  {
    slug: "best-open-source-multimedia-apps-android",
    id: "553651a9-e1dc-4c70-8c57-e0c168ad438e",
    relatedAppIds: [
      "bc59bc31-3523-4e56-b06b-526665cd1527",
      "239fa89b-9cdd-4d82-b445-952655efa5d9",
      "038642c1-1931-4bb2-b9c0-3cb9cdc2e37b",
      "e30e95d2-f897-49ee-8921-1fcfaea65293",
      "279768b1-b2fc-4433-a3a3-0f92a232a754",
      "c215a762-84a7-4baf-a124-dbeabc909153",
      "370e4951-5ea0-4e37-a247-fab9ec176509",
      "e3c3f427-1503-4e52-83d5-41a61a11f202",
      "2a59388b-6c40-411d-a7e7-49e1eeecfda9",
      "1c1f59f7-b957-4927-ba44-d4b940518d90",
    ],
  },
  {
    slug: "best-open-source-games-android",
    id: "bfba8589-60af-44bc-b555-af2f4f401aa2",
    relatedAppIds: [
      "c790bcb6-0e83-46e7-83b4-15223b4e1923",
      "67125e37-f231-4c7e-b180-d0bfd100686c",
      "174f0ec5-1ff3-40af-906b-da96322efafe",
      "56c55086-aaa3-493d-9826-0c0ac31cc071",
      "52ef4205-ebe3-4196-b29e-784e5b871850",
      "6e2a45d7-4b7b-482c-a262-32660bc8ed7e",
      "d2892157-329a-43de-b09a-6feebc2e9471",
      "3df28b1e-09bd-418b-8194-55682fcdd476",
      "a8fc1b00-ab9b-444a-b205-f32b514baaad",
      "ba251826-fb76-47d5-adeb-f022757f6d6f",
    ],
  },
  {
    slug: "best-open-source-privacy-security-apps-android",
    id: "7882a528-c7d1-40d9-88a4-76b3911ff08e",
    relatedAppIds: [
      "561cc462-86f1-44bd-a834-fa202c764dbe",
      "bfce54de-eea6-4bc8-90e6-eb8afa40a24d",
      "32d54626-8acf-452f-b923-8f913b088fb5",
      "ec25236c-3c74-484d-982b-08fb9c75b11a",
      "f40d6949-c531-49f0-aa38-df60aed515f6",
      "2a1b160e-387c-4d7d-83dc-0158b3584ac6",
      "0b9286c2-9d64-4858-87c9-edc851cb183b",
      "059efb88-e60a-4509-8252-4344f2cea913",
      "06380226-5fdb-4a3d-8dd0-6a7cc319866e",
      "dbf96021-660c-4921-9d58-b8f47885a819",
    ],
  },
  {
    slug: "best-open-source-tools-apps-android",
    id: "6a842546-5c19-450b-8ed7-90915960d29c",
    relatedAppIds: [
      "2b3ad29c-4cd6-4106-9439-8f107d9a3957",
      "bdf54405-cfcf-4f83-8c4f-de1b36a311b4",
      "e027798c-0998-4504-9101-b3303b275d1a",
      "d9ad8e51-51e2-45ed-addd-2648319f3632",
      "53fcbc15-2efa-4811-8477-40aae56bf3d8",
      "f6df6988-3f2d-4047-94b4-0861f7c9e0dd",
      "d62106c6-dab1-4f6c-9c9d-d402f5af855d",
      "7f7c65b9-97ad-49e9-9a25-8d2d214d014d",
      "7c9fd9a6-3d64-4fa7-ba8a-7e54e3b50e96",
      "8f9b188c-3f34-468b-ba13-9ae466eddec2",
    ],
  },
  {
    slug: "best-open-source-education-apps-android",
    id: "14217090-ff15-4c93-8c91-1124af40a110",
    relatedAppIds: [
      "0d12ab03-1318-41d9-871a-713a93824f73",
      "9468a0bf-e6fc-4594-9d81-e8c0e9618e06",
      "fb40f549-2323-405f-9f9f-1513e35f6f42",
      "de4cc18d-ed6e-4f8b-a9df-e46b5f03e7a9",
      "40f070f9-cfdd-4874-ae0e-4e7913685990",
      "b369dd11-8770-4b04-be70-c787662128ea",
      "8537743c-8e4c-41cd-905f-1c6fc82ad4fb",
      "417981de-cb61-44e9-a91c-f74502c0ca9e",
      "2bd491f5-7789-4453-990e-5e623c7f9c7f",
      "405a325f-f0b8-4500-9a55-c4ae45366a39",
    ],
  },
  {
    slug: "best-open-source-writing-apps-android",
    id: "03c6da8a-fd60-4f42-b650-bb9927b01918",
    relatedAppIds: [
      "0cf0ff70-3b06-4de8-be1b-8ce6386a62f5",
      "162e546e-0ac4-407c-b02a-8edc419ee371",
      "23b7b658-668a-457d-9f8f-105b2a8220d2",
      "0007141a-c279-416e-bce4-6239b4c1994e",
      "c52d5b3a-beab-4673-87fe-32c6302a66f1",
      "8646633c-9aca-4734-a904-eb1748ed22c5",
      "f327416d-7bd9-4acf-8b9c-5b8b65555b0c",
      "0dc05d3a-007f-45ed-ae6f-7845a2fb6f20",
      "d037d65d-b663-44cf-8494-75c6076258f2",
      "083ac280-9786-43f7-95db-0b3821c86300",
    ],
  },
  {
    slug: "best-open-source-password-managers-android",
    id: "bff87880-b61b-4c33-a695-a04c1d8715f0",
    relatedAppIds: [
      "561cc462-86f1-44bd-a834-fa202c764dbe",
      "f3bf1a8d-8b7c-4531-ba5c-1ffa61eb8db8",
      "baf4ffc9-4e80-4567-8645-c81b6490f72f",
      "44d847b7-cc44-40d2-8514-0cc1d8a3c8fa",
    ],
  },
  {
    slug: "how-to-find-apk-files-on-android",
    id: "7286df18-d38f-49f6-996c-b757a3eabd2b",
    relatedAppIds: ["bbc731b4-ba77-4667-b5db-6c686a295c90"],
  },
  {
    slug: "what-are-apk-permissions-how-to-check",
    id: "021f7503-6062-4c2f-9ff4-2600b86bf10c",
    relatedAppIds: ["0b9286c2-9d64-4858-87c9-edc851cb183b"],
  },
]);

/**
 * Re-verifies every precondition against the live database. Returns
 * { ok: true, rows } with the current row for every target (used for the
 * dry-run report) or { ok: false, problems } listing exactly what doesn't
 * hold — the caller must refuse to write on any problem. Takes `db` as a
 * parameter (rather than closing over a module-level client) so this
 * function — and the static TARGETS/EXCLUDED_SLUGS data above — can be
 * imported and tested without ever touching real credentials or Supabase.
 */
export async function preflight(db) {
  const problems = [];

  if (TARGETS.length !== 11) {
    problems.push(`expected exactly 11 targets, found ${TARGETS.length}`);
  }

  for (const target of TARGETS) {
    if (EXCLUDED_SLUGS.includes(target.slug)) {
      problems.push(`${target.slug} is on EXCLUDED_SLUGS but also in TARGETS — refusing to touch it`);
    }
  }

  const targetIds = TARGETS.map((t) => t.id);
  const { data: rows, error: rowsError } = await db
    .from("blog_posts")
    .select("id, slug, title, published, related_app_ids")
    .in("id", targetIds);

  if (rowsError) {
    problems.push(`could not read blog_posts: ${rowsError.message}`);
    return { ok: false, problems };
  }

  const rowById = new Map((rows ?? []).map((r) => [r.id, r]));

  for (const target of TARGETS) {
    const row = rowById.get(target.id);
    if (!row) {
      problems.push(`${target.slug} (${target.id}): row no longer exists`);
      continue;
    }
    if (row.slug !== target.slug) {
      problems.push(`${target.id}: expected slug "${target.slug}", found "${row.slug}"`);
    }
    if (row.published !== true) {
      problems.push(`${target.slug}: no longer published (published=${row.published})`);
    }
    if ((row.related_app_ids ?? null) === null || row.related_app_ids.length !== 0) {
      problems.push(
        `${target.slug}: related_app_ids is no longer empty (currently ${JSON.stringify(row.related_app_ids)})`,
      );
    }
  }

  const allProposedIds = [...new Set(TARGETS.flatMap((t) => t.relatedAppIds))];
  const { data: apps, error: appsError } = await db.from("apps").select("id").in("id", allProposedIds);

  if (appsError) {
    problems.push(`could not verify app ids: ${appsError.message}`);
  } else {
    const foundIds = new Set((apps ?? []).map((a) => a.id));
    const missing = allProposedIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      problems.push(`${missing.length} proposed app id(s) no longer exist in apps: ${missing.join(", ")}`);
    }
  }

  return { ok: problems.length === 0, problems, rows: rows ?? [] };
}

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const APPLY = process.argv.includes("--apply");
  const DRY_RUN = !APPLY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local.");
    process.exit(1);
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  console.log(`related_app_ids backfill — ${DRY_RUN ? "DRY RUN (no writes)" : "APPLY (will write)"}\n`);

  const result = await preflight(db);

  if (!result.ok) {
    console.error("Preflight failed — making no writes:\n");
    for (const problem of result.problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }

  console.log(`Preflight passed: all ${TARGETS.length} target posts exist, are published, and have related_app_ids = []; all proposed app ids exist.\n`);

  const rowById = new Map(result.rows.map((r) => [r.id, r]));

  for (const target of TARGETS) {
    const row = rowById.get(target.id);
    console.log(`${DRY_RUN ? "would update" : "updating"} ${row.title}`);
    console.log(`  slug:     ${target.slug}`);
    console.log(`  current:  ${JSON.stringify(row.related_app_ids)}`);
    console.log(`  proposed: ${JSON.stringify(target.relatedAppIds)}`);
    console.log(`  count:    ${target.relatedAppIds.length}`);

    if (!DRY_RUN) {
      // supabase-js serializes a JS [] passed to .eq() as an empty query
      // value ("related_app_ids=eq."), which Postgres rejects as a
      // malformed array literal — confirmed empirically against this
      // project's own database. The Postgres empty-array literal "{}" must
      // be passed as the literal string "{}", not a JS array.
      const { data, error } = await db
        .from("blog_posts")
        .update({ related_app_ids: target.relatedAppIds })
        .eq("id", target.id)
        .eq("related_app_ids", "{}")
        .select("id");

      if (error) {
        console.error(`  ✗ write failed: ${error.message}`);
        process.exitCode = 1;
        continue;
      }
      if ((data ?? []).length !== 1) {
        console.error(`  ✗ guard matched ${data?.length ?? 0} rows, expected 1 — related_app_ids may have changed concurrently; skipped`);
        process.exitCode = 1;
        continue;
      }
      console.log("  ✓ written");
    }
    console.log("");
  }

  console.log(DRY_RUN ? "Dry run complete — no rows were changed." : "Backfill complete.");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("backfill-related-app-ids.mjs")) {
  await main();
}
