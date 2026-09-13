import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Step 1 of the scheduled Play automation layer: static, source-level
 * assertions against the play_watchlist migration SQL — mirrors
 * lib/metadata/play-proposals-migration.test.ts's own approach, for the
 * same reason: there is no SQL execution engine available under plain
 * `node --test`, and no Supabase instance to apply this against in this
 * test run, so these assertions read the migration's literal text rather
 * than exercising it. This does not, and cannot, prove the migration
 * applies cleanly against a real Postgres database — only that the file
 * contains what this step specified.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

function findMigrationFile(): string {
  const match = readdirSync(migrationsDir).find((f) => f.endsWith("_play_watchlist.sql"));
  assert.ok(match, "no *_play_watchlist.sql migration found in supabase/migrations/");
  return migrationsDir + match;
}

const migrationPath = findMigrationFile();
const sql = readFileSync(migrationPath, "utf8");

group("play_watchlist migration — table and columns", () => {
  test("creates the table with the expected name", () => {
    assert.match(sql, /create table if not exists public\.play_watchlist/);
  });

  test("id: uuid primary key default gen_random_uuid()", () => {
    assert.match(sql, /id\s+uuid primary key default gen_random_uuid\(\)/);
  });

  test("package_name: text not null unique", () => {
    assert.match(sql, /package_name\s+text not null unique/);
  });

  test("play_url: text not null", () => {
    assert.match(sql, /play_url\s+text not null/);
  });

  test("enabled: boolean not null default true", () => {
    assert.match(sql, /enabled\s+boolean not null default true/);
  });

  test("last_checked_at/last_success_at/last_failure_at: nullable timestamptz", () => {
    assert.match(sql, /last_checked_at\s+timestamptz null/);
    assert.match(sql, /last_success_at\s+timestamptz null/);
    assert.match(sql, /last_failure_at\s+timestamptz null/);
  });

  test("last_error: nullable text", () => {
    assert.match(sql, /last_error\s+text null/);
  });

  test("created_at: timestamptz not null default now()", () => {
    assert.match(sql, /created_at\s+timestamptz not null default now\(\)/);
  });

  test("added_by: nullable uuid, FK to public.users(id)", () => {
    assert.match(sql, /added_by\s+uuid null references public\.users\(id\)/);
  });
});

group("play_watchlist migration — no fragile SQL URL parser", () => {
  test("play_url carries no CHECK constraint attempting to validate URL shape in SQL", () => {
    // Application code (lib/metadata/play-url.ts's parsePlayUrl()) is the
    // one place this project validates a Play URL's shape — this
    // migration must not grow a second, weaker copy of that logic.
    assert.doesNotMatch(sql, /play_url.*check/i);
    assert.doesNotMatch(sql, /constraint\s+play_watchlist_play_url/i);
  });
});

group("play_watchlist migration — RLS", () => {
  test("RLS is enabled on the table", () => {
    assert.match(sql, /alter table public\.play_watchlist enable row level security/);
  });

  test("the admin policy exists, applies to authenticated only, and gates on is_admin() for both using and with check", () => {
    assert.match(
      sql,
      /create policy "admins manage play watchlist" on public\.play_watchlist\s*\n\s*for all to authenticated\s*\n\s*using \(is_admin\(\)\)\s*\n\s*with check \(is_admin\(\)\)/,
    );
  });

  test("there is no anon policy of any kind — the table has no public read/write path", () => {
    assert.doesNotMatch(sql, /to anon/);
  });

  test("exactly one policy is defined for this table", () => {
    const occurrences = sql.match(/create policy ".*?" on public\.play_watchlist/g) ?? [];
    assert.equal(occurrences.length, 1);
  });
});

group("play_watchlist migration — scope discipline", () => {
  test("this migration touches only play_watchlist — no other table is created, altered, or dropped", () => {
    const ddlTargets = [
      ...sql.matchAll(/create table[^(]*?(public\.\w+)/g),
      ...sql.matchAll(/alter table\s+(public\.\w+)/g),
      ...sql.matchAll(/drop table[^(]*?(public\.\w+)/g),
    ].map((m) => m[1]);
    assert.ok(ddlTargets.length > 0, "expected at least one DDL statement touching a table");
    for (const target of ddlTargets) {
      assert.equal(target, "public.play_watchlist");
    }
  });

  test("no INSERT/UPDATE/DELETE statement exists in this migration — it creates schema only, no rows", () => {
    assert.doesNotMatch(sql, /\binsert into\b/i);
    assert.doesNotMatch(sql, /\bupdate\s+public\./i);
    assert.doesNotMatch(sql, /\bdelete from\b/i);
  });
});
