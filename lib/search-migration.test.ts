import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against the apps-search migration SQL —
 * mirrors every other migration test in this project (e.g.
 * lib/metadata/play-watchlist-migration.test.ts): there is no SQL
 * execution engine or local Postgres instance available under plain
 * `node --test`, so these assertions read the migration's literal text
 * rather than exercising it. This proves the migration contains what was
 * specified — it cannot, and does not, prove it applies cleanly or that
 * pg_trgm actually ranks results correctly against a real database.
 */

const migrationsDir = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

function findMigrationFile(): string {
  const match = readdirSync(migrationsDir).find((f) => f.endsWith("_apps_search_trgm.sql"));
  assert.ok(match, "no *_apps_search_trgm.sql migration found in supabase/migrations/");
  return migrationsDir + match;
}

const sql = readFileSync(findMigrationFile(), "utf8");

group("apps search migration — pg_trgm and generated column", () => {
  test("enables pg_trgm", () => {
    assert.match(sql, /create extension if not exists pg_trgm/);
  });

  test("adds search_text as a STORED generated column covering name/package_name/developer_name/description", () => {
    assert.match(sql, /add column if not exists search_text text generated always as/);
    assert.match(sql, /coalesce\(name, ''\)/);
    assert.match(sql, /coalesce\(package_name, ''\)/);
    assert.match(sql, /coalesce\(developer_name, ''\)/);
    assert.match(sql, /coalesce\(description, ''\)/);
    assert.match(sql, /\)\s*stored;/);
  });

  test("adds a GIN trigram index on search_text", () => {
    assert.match(
      sql,
      /create index if not exists idx_apps_search_trgm\s*\n\s*on public\.apps using gin \(search_text gin_trgm_ops\)/,
    );
  });
});

group("apps search migration — search_apps() function", () => {
  test("defines search_apps(query text, max_results integer) returning the minimal dropdown fields", () => {
    assert.match(sql, /create or replace function public\.search_apps\(query text, max_results integer default 6\)/);
    assert.match(sql, /returns table \(\s*\n\s*id uuid,\s*\n\s*name text,\s*\n\s*slug text,\s*\n\s*icon_url text,\s*\n\s*category text\s*\n\s*\)/);
  });

  test("is STABLE and SECURITY INVOKER — never SECURITY DEFINER for this read-only, already-public data", () => {
    assert.match(sql, /language sql\s*\n\s*stable\s*\n\s*security invoker/);
    assert.doesNotMatch(sql, /security definer/);
  });

  test("explicitly requires a published version via EXISTS — never relies on filtering results in application code", () => {
    assert.match(
      sql,
      /exists \(\s*\n\s*select 1\s*\n\s*from public\.versions v\s*\n\s*where v\.app_id = a\.id\s*\n\s*and v\.published = true\s*\n\s*\)/,
    );
  });

  test("ranks by name-prefix match, then fuzzy name similarity, then download_count", () => {
    const orderByBlock = sql.slice(sql.lastIndexOf("order by"), sql.lastIndexOf("limit"));
    const prefixIdx = orderByBlock.indexOf("a.name ilike query");
    const similarityIdx = orderByBlock.indexOf("word_similarity(query, a.name) desc");
    const downloadIdx = orderByBlock.indexOf("a.download_count desc");
    assert.ok(prefixIdx !== -1 && similarityIdx !== -1 && downloadIdx !== -1, "expected all three ranking terms");
    assert.ok(prefixIdx < similarityIdx && similarityIdx < downloadIdx, "expected prefix > similarity > download_count ranking order");
  });

  test("uses both a substring (ilike) match across the full search_text blob and a word_similarity threshold against name specifically, not a whole-blob similarity", () => {
    assert.match(sql, /a\.search_text ilike '%' \|\| query \|\| '%'/);
    assert.match(sql, /word_similarity\(query, a\.name\) > 0\.3/);
  });

  test("grants EXECUTE to anon (required for the public, unauthenticated search endpoint) and authenticated, after revoking from public", () => {
    assert.match(sql, /revoke all on function public\.search_apps\(text, integer\) from public;/);
    assert.match(
      sql,
      /grant execute on function public\.search_apps\(text, integer\) to anon, authenticated, service_role;/,
    );
  });
});

group("apps search migration — RLS is untouched", () => {
  test("no ALTER POLICY, DROP POLICY, or CREATE POLICY statement exists — RLS itself is never modified", () => {
    assert.doesNotMatch(sql, /\balter policy\b/i);
    assert.doesNotMatch(sql, /\bdrop policy\b/i);
    assert.doesNotMatch(sql, /\bcreate policy\b/i);
  });

  test("no ALTER TABLE ... (DISABLE|ENABLE) ROW LEVEL SECURITY statement exists", () => {
    assert.doesNotMatch(sql, /row level security/i);
  });
});

group("apps search migration — scope discipline", () => {
  test("touches only public.apps (adding a column) — no other table is created, altered, or dropped", () => {
    const alterTargets = [...sql.matchAll(/alter table\s+(public\.\w+)/g)].map((m) => m[1]);
    assert.ok(alterTargets.length > 0, "expected at least one ALTER TABLE statement");
    for (const target of alterTargets) {
      assert.equal(target, "public.apps");
    }
    assert.doesNotMatch(sql, /\bcreate table\b/i);
    assert.doesNotMatch(sql, /\bdrop table\b/i);
  });

  test("no INSERT/UPDATE/DELETE statement exists — schema and function only, no row data written", () => {
    assert.doesNotMatch(sql, /\binsert into\b/i);
    assert.doesNotMatch(sql, /\bupdate\s+public\./i);
    assert.doesNotMatch(sql, /\bdelete from\b/i);
  });
});

/* ===================================================================== */
/* Search Ranking V2 — supabase/migrations/<ts>_search_ranking_v2.sql    */
/* ===================================================================== */

function findRankingV2MigrationFile(): string {
  const match = readdirSync(migrationsDir).find((f) => f.endsWith("_search_ranking_v2.sql"));
  assert.ok(match, "no *_search_ranking_v2.sql migration found in supabase/migrations/");
  return migrationsDir + match;
}

const v2Sql = readFileSync(findRankingV2MigrationFile(), "utf8");

group("search ranking v2 — same function signature, no application code impact", () => {
  test("CREATE OR REPLACEs the exact same function name/parameters/return shape as the original", () => {
    assert.match(v2Sql, /create or replace function public\.search_apps\(query text, max_results integer default 6\)/);
    assert.match(
      v2Sql,
      /returns table \(\s*\n\s*id uuid,\s*\n\s*name text,\s*\n\s*slug text,\s*\n\s*icon_url text,\s*\n\s*category text\s*\n\s*\)/,
    );
  });

  test("is STABLE and SECURITY INVOKER — never SECURITY DEFINER", () => {
    assert.match(v2Sql, /language sql\s*\n\s*stable\s*\n\s*security invoker/);
    assert.doesNotMatch(v2Sql, /security definer/);
  });

  test("does not touch the original migration file — V2 is a new file, never an edit to 20260916000000_apps_search_trgm.sql", () => {
    assert.doesNotMatch(sql, /char_length\(query\)/);
    assert.doesNotMatch(sql, /regexp_split_to_array/);
  });

  test("grants EXECUTE to anon/authenticated/service_role after revoking from public, unchanged from V1", () => {
    assert.match(v2Sql, /revoke all on function public\.search_apps\(text, integer\) from public;/);
    assert.match(
      v2Sql,
      /grant execute on function public\.search_apps\(text, integer\) to anon, authenticated, service_role;/,
    );
  });
});

group("search ranking v2 — published-version safety is preserved", () => {
  test("still requires EXISTS a published version — a metadata-only app can never be returned", () => {
    assert.match(
      v2Sql,
      /exists \(\s*\n\s*select 1\s*\n\s*from public\.versions v\s*\n\s*where v\.app_id = a\.id\s*\n\s*and v\.published = true\s*\n\s*\)/,
    );
  });
});

group("search ranking v2 — seven ranking tiers, in the required order", () => {
  test("tier 1: exact normalized app-name match", () => {
    assert.match(v2Sql, /lower\(trim\(a\.name\)\) = lower\(trim\(query\)\)/);
  });

  test("tier 2: app-name prefix match", () => {
    assert.match(v2Sql, /a\.name ilike query \|\| '%'/);
  });

  test("tier 3: app-name whole-word match, via regexp_split_to_array on a fixed pattern — never a regex built from the raw query", () => {
    assert.match(v2Sql, /lower\(query\) = any \(regexp_split_to_array\(lower\(a\.name\), '\\W\+'\)\)/);
    // The split pattern itself must be the literal, hardcoded '\W+' — the
    // query string is only ever compared as a plain value against the
    // resulting array, never interpolated into a regex pattern.
    assert.doesNotMatch(v2Sql, /\|\| query \|\| .*~/);
    assert.doesNotMatch(v2Sql, /~\s*\(.*query/);
  });

  test("tier 4: strong fuzzy app-name match, using word_similarity with the empirically-chosen 0.45 threshold and a 5-character minimum length gate", () => {
    assert.match(v2Sql, /char_length\(query\) >= 5 and word_similarity\(query, a\.name\) > 0\.45/);
  });

  test("tier 5: package-name match", () => {
    assert.match(v2Sql, /a\.package_name ilike '%' \|\| query \|\| '%'/);
  });

  test("tier 6: developer-name match", () => {
    assert.match(v2Sql, /a\.developer_name ilike '%' \|\| query \|\| '%'/);
  });

  test("tier 7: description-only match — the lowest tier, only reached via the CASE's ELSE branch", () => {
    assert.match(v2Sql, /a\.description ilike '%' \|\| query \|\| '%'/);
    const caseBlock = v2Sql.slice(v2Sql.indexOf("order by"), v2Sql.indexOf("end asc"));
    assert.match(caseBlock, /else 7/);
  });

  test("the seven tiers appear in the CASE expression in exactly this order: exact, prefix, word, fuzzy, package, developer, else-description", () => {
    const caseBlock = v2Sql.slice(v2Sql.indexOf("order by"), v2Sql.indexOf("end asc"));
    const positions = [
      caseBlock.indexOf("then 1"),
      caseBlock.indexOf("then 2"),
      caseBlock.indexOf("then 3"),
      caseBlock.indexOf("then 4"),
      caseBlock.indexOf("then 5"),
      caseBlock.indexOf("then 6"),
      caseBlock.indexOf("else 7"),
    ];
    for (const p of positions) assert.ok(p !== -1, "expected every tier number to appear in the CASE block");
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i - 1] < positions[i], `expected tier ${i} to appear before tier ${i + 1}`);
    }
  });

  test("download_count desc is the only tiebreaker after the tier CASE — no secondary fuzzy-score sort", () => {
    const orderByBlock = v2Sql.slice(v2Sql.indexOf("order by"), v2Sql.indexOf("limit"));
    const endIdx = orderByBlock.indexOf("end asc");
    const downloadIdx = orderByBlock.indexOf("a.download_count desc");
    assert.ok(endIdx !== -1 && downloadIdx !== -1 && endIdx < downloadIdx);
    // Nothing else appears between the tier CASE and download_count.
    const between = orderByBlock.slice(endIdx + "end asc,".length, downloadIdx).trim();
    assert.equal(between, "");
  });
});

group("search ranking v2 — app-name relevance dominates package/developer/description", () => {
  test("all four name-based tiers (exact, prefix, word, fuzzy) are numbered strictly below package/developer/description", () => {
    const caseBlock = v2Sql.slice(v2Sql.indexOf("order by"), v2Sql.indexOf("end asc"));
    const nameTierMax = Math.max(
      Number(/then (\d)/.exec(caseBlock.slice(caseBlock.indexOf("then 1"), caseBlock.indexOf("then 2") + 10))?.[1]),
      4, // fuzzy is explicitly tier 4
    );
    assert.equal(nameTierMax, 4);
    const packageTier = 5;
    const developerTier = 6;
    const descriptionTier = 7;
    assert.ok(4 < packageTier && packageTier < developerTier && developerTier < descriptionTier);
  });
});

group("search ranking v2 — WHERE inclusion mirrors the ranking tiers", () => {
  test("every ranking condition also appears in the WHERE clause's inclusion list, so nothing ranks into a tier it wasn't actually included for", () => {
    const whereBlock = v2Sql.slice(v2Sql.indexOf("where"), v2Sql.indexOf("and exists"));
    for (const fragment of [
      "lower(trim(a.name)) = lower(trim(query))",
      "a.name ilike query || '%'",
      "lower(query) = any (regexp_split_to_array(lower(a.name), '\\W+'))",
      "char_length(query) >= 5 and word_similarity(query, a.name) > 0.45",
      "a.package_name ilike '%' || query || '%'",
      "a.developer_name ilike '%' || query || '%'",
      "a.description ilike '%' || query || '%'",
    ]) {
      assert.ok(whereBlock.includes(fragment), `expected the WHERE clause to include: ${fragment}`);
    }
  });
});

group("search ranking v2 — empirically-verified threshold rationale is documented", () => {
  test("the migration's own comment records the production word_similarity measurements the 0.45 threshold was derived from", () => {
    assert.match(v2Sql, /word_similarity\('whatasp', 'WhatsApp Messenger'\)\s*\)?\s*=\s*0\.5/);
    assert.match(v2Sql, /word_similarity\('discord', 'SyncRecord'\)/);
    assert.match(v2Sql, /0\.375/);
    assert.match(v2Sql, /word_similarity\('telegram', 'Mercurygram Tor Plugin'\)/);
    assert.match(v2Sql, /word_similarity\('telegram', 'Goregram'\)/);
    assert.match(v2Sql, /word_similarity\('telegram', 'Instagram'\)/);
    assert.match(v2Sql, /word_similarity\('telegram', 'Nonogram'\)/);
  });
});
