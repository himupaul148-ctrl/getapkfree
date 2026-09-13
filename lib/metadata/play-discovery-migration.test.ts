import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Step 1 of the Daily New-App Discovery system: static, source-level
 * assertions against the play_discovery_candidates migration SQL —
 * mirrors lib/metadata/play-proposals-migration.test.ts's and
 * lib/metadata/play-watchlist-migration.test.ts's own approach, for the
 * same reason: there is no SQL execution engine available under plain
 * `node --test`, and no Supabase instance to apply this against in this
 * test run, so these assertions read the migration's literal text rather
 * than exercising it. This does not, and cannot, prove the migration
 * applies cleanly against a real Postgres database — only that the file
 * contains what this step specified.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

function findMigrationFile(): string {
  const match = readdirSync(migrationsDir).find((f) => f.endsWith("_play_discovery_candidates.sql"));
  assert.ok(match, "no *_play_discovery_candidates.sql migration found in supabase/migrations/");
  return migrationsDir + match;
}

const migrationPath = findMigrationFile();
const sql = readFileSync(migrationPath, "utf8");

group("play_discovery_candidates migration — table and columns", () => {
  test("creates the table with the expected name", () => {
    assert.match(sql, /create table if not exists public\.play_discovery_candidates/);
  });

  test("id: uuid primary key default gen_random_uuid()", () => {
    assert.match(sql, /id\s+uuid primary key default gen_random_uuid\(\)/);
  });

  test("source: text not null", () => {
    assert.match(sql, /source\s+text not null/);
  });

  test("source_ref: text not null", () => {
    assert.match(sql, /source_ref\s+text not null/);
  });

  test("candidate_name: nullable text", () => {
    assert.match(sql, /candidate_name\s+text null/);
  });

  test("resolved_play_url: nullable text", () => {
    assert.match(sql, /resolved_play_url\s+text null/);
  });

  test("package_name: nullable text", () => {
    assert.match(sql, /package_name\s+text null/);
  });

  test("status: text not null default 'found'", () => {
    assert.match(sql, /status\s+text not null default 'found'/);
  });

  test("score: nullable numeric", () => {
    assert.match(sql, /score\s+numeric null/);
  });

  test("proposal_id: nullable uuid, FK to public.play_import_proposals(id)", () => {
    assert.match(
      sql,
      /proposal_id\s+uuid null references public\.play_import_proposals\(id\)/,
    );
  });

  test("discovered_at: timestamptz not null default now()", () => {
    assert.match(sql, /discovered_at\s+timestamptz not null default now\(\)/);
  });

  test("checked_at: nullable timestamptz", () => {
    assert.match(sql, /checked_at\s+timestamptz null/);
  });
});

group("play_discovery_candidates migration — constraints", () => {
  test("UNIQUE(source, source_ref)", () => {
    assert.match(sql, /unique \(source, source_ref\)/);
  });

  test("source CHECK allows exactly github and hn, no other value", () => {
    assert.match(
      sql,
      /constraint play_discovery_candidates_source_check\s*\n\s*check \(source = any \(array\['github', 'hn'\]\)\)/,
    );
  });

  test("status CHECK allows exactly the seven specified values", () => {
    assert.match(
      sql,
      /constraint play_discovery_candidates_status_check\s*\n\s*check \(status = any \(array\[\s*'found',\s*'disqualified_no_play_link',\s*'disqualified_low_quality',\s*'disqualified_exists',\s*'verified',\s*'proposed',\s*'error'\s*\]\)\)/,
    );
  });
});

group("play_discovery_candidates migration — RLS", () => {
  test("RLS is enabled on the table", () => {
    assert.match(sql, /alter table public\.play_discovery_candidates enable row level security/);
  });

  test("the admin policy exists, applies to authenticated only, and gates on is_admin() for both using and with check", () => {
    assert.match(
      sql,
      /create policy "admins manage play discovery candidates" on public\.play_discovery_candidates\s*\n\s*for all to authenticated\s*\n\s*using \(is_admin\(\)\)\s*\n\s*with check \(is_admin\(\)\)/,
    );
  });

  test("there is no anon policy of any kind — the table has no public read/write path", () => {
    assert.doesNotMatch(sql, /to anon/);
  });

  test("exactly one policy is defined for this table", () => {
    const occurrences = sql.match(/create policy ".*?" on public\.play_discovery_candidates/g) ?? [];
    assert.equal(occurrences.length, 1);
  });
});

group("play_discovery_candidates migration — scope discipline", () => {
  test("this migration touches only play_discovery_candidates — no other table is created, altered, or dropped", () => {
    const ddlTargets = [
      ...sql.matchAll(/create table[^(]*?(public\.\w+)/g),
      ...sql.matchAll(/alter table\s+(public\.\w+)/g),
      ...sql.matchAll(/drop table[^(]*?(public\.\w+)/g),
    ].map((m) => m[1]);
    assert.ok(ddlTargets.length > 0, "expected at least one DDL statement touching a table");
    for (const target of ddlTargets) {
      assert.equal(target, "public.play_discovery_candidates");
    }
  });

  test("no INSERT/UPDATE/DELETE statement exists in this migration — it creates schema only, no rows", () => {
    assert.doesNotMatch(sql, /\binsert into\b/i);
    assert.doesNotMatch(sql, /\bupdate\s+public\./i);
    assert.doesNotMatch(sql, /\bdelete from\b/i);
  });
});
