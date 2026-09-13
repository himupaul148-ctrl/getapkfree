import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Phase 4a: static, source-level assertions against the
 * play_import_proposals migration SQL — there is no SQL execution engine
 * available under plain `node --test`, and no Supabase instance to apply
 * this against in this test run, so these assertions read the migration's
 * literal text the same way lib/catalogue-select.test.ts and friends read
 * TypeScript source they can't import directly. This is a Phase 4a-only
 * check: it does not, and cannot, prove the migration applies cleanly
 * against a real Postgres database — only that the file contains what this
 * phase specified.
 */

const migrationsDir = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

function findMigrationFile(): string {
  const match = readdirSync(migrationsDir).find((f) => f.endsWith("_play_import_proposals.sql"));
  assert.ok(match, "no *_play_import_proposals.sql migration found in supabase/migrations/");
  return migrationsDir + match;
}

const migrationPath = findMigrationFile();
const sql = readFileSync(migrationPath, "utf8");

group("play_import_proposals migration — table and columns", () => {
  test("creates the table with the expected name", () => {
    assert.match(sql, /create table if not exists public\.play_import_proposals/);
  });

  test("id: uuid primary key default gen_random_uuid()", () => {
    assert.match(sql, /id\s+uuid primary key default gen_random_uuid\(\)/);
  });

  test("proposal_type: text not null, with the exact allowed values", () => {
    assert.match(sql, /proposal_type\s+text not null/);
    assert.match(
      sql,
      /check \(proposal_type = any \(array\['new_app', 'metadata_update'\]\)\)/,
    );
  });

  test("package_name and play_url: text not null", () => {
    assert.match(sql, /package_name\s+text not null/);
    assert.match(sql, /play_url\s+text not null/);
  });

  test("app_id: nullable uuid, FK to public.apps(id), ON DELETE SET NULL", () => {
    assert.match(
      sql,
      /app_id\s+uuid null references public\.apps\(id\) on delete set null/,
    );
  });

  test("proposed_fields: jsonb not null", () => {
    assert.match(sql, /proposed_fields\s+jsonb not null/);
  });

  test("previous_fields: jsonb, nullable", () => {
    assert.match(sql, /previous_fields\s+jsonb null/);
  });

  test("status: text not null default 'pending', with the exact allowed values", () => {
    assert.match(sql, /status\s+text not null default 'pending'/);
    assert.match(
      sql,
      /check \(status = any \(array\[\s*'pending',\s*'approved',\s*'rejected',\s*'applied',\s*'expired',\s*'superseded'\s*\]\)\)/,
    );
  });

  test("created_at: timestamptz not null default now()", () => {
    assert.match(sql, /created_at\s+timestamptz not null default now\(\)/);
  });

  test("decided_at: nullable timestamptz", () => {
    assert.match(sql, /decided_at\s+timestamptz null/);
  });

  test("decided_by: nullable uuid, FK to public.users(id)", () => {
    assert.match(sql, /decided_by\s+uuid null references public\.users\(id\)/);
  });

  test("rejection_reason: nullable text", () => {
    assert.match(sql, /rejection_reason\s+text null/);
  });

  test("applied_at: nullable timestamptz", () => {
    assert.match(sql, /applied_at\s+timestamptz null/);
  });
});

group("play_import_proposals migration — partial unique index", () => {
  test("play_import_proposals_pending_unique exists on (package_name, proposal_type) where status = 'pending'", () => {
    assert.match(
      sql,
      /create unique index if not exists play_import_proposals_pending_unique\s*\n\s*on public\.play_import_proposals \(package_name, proposal_type\)\s*\n\s*where \(status = 'pending'\)/,
    );
  });
});

group("play_import_proposals migration — RLS", () => {
  test("RLS is enabled on the table", () => {
    assert.match(sql, /alter table public\.play_import_proposals enable row level security/);
  });

  test("the admin policy exists, applies to authenticated only, and gates on is_admin() for both using and with check", () => {
    assert.match(
      sql,
      /create policy "admins manage play import proposals" on public\.play_import_proposals\s*\n\s*for all to authenticated\s*\n\s*using \(is_admin\(\)\)\s*\n\s*with check \(is_admin\(\)\)/,
    );
  });

  test("there is no anon policy of any kind — the table has no public read/write path", () => {
    assert.doesNotMatch(sql, /to anon/);
  });

  test("exactly one policy is defined for this table", () => {
    const occurrences = sql.match(/create policy ".*?" on public\.play_import_proposals/g) ?? [];
    assert.equal(occurrences.length, 1);
  });
});

group("play_import_proposals migration — scope discipline", () => {
  test("this migration touches only play_import_proposals — no other table is created, altered, or dropped", () => {
    const ddlTargets = [
      ...sql.matchAll(/create table[^(]*?(public\.\w+)/g),
      ...sql.matchAll(/alter table\s+(public\.\w+)/g),
      ...sql.matchAll(/drop table[^(]*?(public\.\w+)/g),
    ].map((m) => m[1]);
    for (const target of ddlTargets) {
      assert.equal(target, "public.play_import_proposals");
    }
  });

  test("no INSERT/UPDATE/DELETE statement exists in this migration — it creates schema only, no rows", () => {
    assert.doesNotMatch(sql, /\binsert into\b/i);
    assert.doesNotMatch(sql, /\bupdate\s+public\./i);
    assert.doesNotMatch(sql, /\bdelete from\b/i);
  });
});
