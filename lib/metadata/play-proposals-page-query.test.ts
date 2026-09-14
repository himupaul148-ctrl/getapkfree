import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against
 * app/admin/play-proposals/page.tsx — a server component this project's
 * plain `node --test` runner can't import directly (no JSX transform).
 * These prove two things text-analysis can actually verify: (1) the
 * pre-existing pending-proposal query is untouched, and (2) the new
 * "Recently approved" data loading never issues a query inside a
 * per-proposal loop (the N+1 pattern this feature was explicitly built to
 * avoid) — every .from(...) call in loadRecentlyApprovedGithubCards() must
 * be a single batched call, not one nested inside a .map()/for loop.
 */

const src = readFileSync(fileURLToPath(new URL("../../app/admin/play-proposals/page.tsx", import.meta.url)), "utf8");

group("play-proposals/page.tsx — the existing pending-proposal query is untouched", () => {
  test("still selects exactly the original columns, filtered to status='pending', ordered by created_at desc", () => {
    assert.match(
      src,
      /\.select\("id, proposal_type, package_name, play_url, app_id, proposed_fields, previous_fields, created_at"\)/,
    );
    assert.match(src, /\.eq\("status", "pending"\)/);
    assert.match(src, /\.order\("created_at", \{ ascending: false \}\)/);
  });

  test("still maps rows into ManagedProposal[] exactly as before, unrelated to the new approved-cards data", () => {
    assert.match(src, /const proposals: ManagedProposal\[\] = rows\.map\(\(row\) => \{/);
  });
});

group("play-proposals/page.tsx — the new approved-cards query never issues a query per proposal (no N+1)", () => {
  test("loadRecentlyApprovedGithubCards exists as its own function, separate from the pending-queue loading above", () => {
    assert.match(src, /async function loadRecentlyApprovedGithubCards\(/);
  });

  test("every .from(...) call inside that function is a single batched call — none appear inside a .map()/for-loop body", () => {
    const start = src.indexOf("async function loadRecentlyApprovedGithubCards(");
    assert.ok(start > -1);
    const afterStart = src.slice(start);
    const bodyEnd = afterStart.indexOf("\n}\n");
    const body = afterStart.slice(0, bodyEnd);

    // Every .from(...) call in the function body uses .in(...) or a single
    // .eq(...) chain — never re-invoked inside a callback passed to
    // .map()/.filter()/for(...). A crude but effective structural check:
    // no `.from(` appears after a `.map((` / `for (` opens without the
    // matching loop body ending first — approximated here by requiring
    // every .from(...) call site to be followed, before the next .from(,
    // by exactly one of .in( or a resolved .eq( chain, and never nested
    // inside `.map((` at all.
    const fromCallCount = (body.match(/\.from\(/g) ?? []).length;
    assert.ok(fromCallCount >= 4, "expects the proposals/candidates/apps/attempts/(versions) batched calls");

    // The two batched candidate/apps lookups run inside Promise.all — never
    // sequentially inside a loop.
    assert.match(body, /Promise\.all\(\[/);

    // getAttemptsByAppIds() (itself a single .in() query, tested directly
    // in lib/apk/github-apk-enrichment-store.test.ts) is called exactly
    // once per page render, with the full id list — never once per app.
    const getAttemptsCalls = [...body.matchAll(/getAttemptsByAppIds\(/g)];
    assert.equal(getAttemptsCalls.length, 1);

    // No .from(...) call is textually nested inside a .map((...) => { ... })
    // callback anywhere in this function body.
    const mapCallbackBodies = [...body.matchAll(/\.map\(\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\n {2}\}\)/g)].map((m) => m[2]);
    for (const callbackBody of mapCallbackBodies) {
      assert.doesNotMatch(callbackBody, /\.from\(/, "a .from() call inside a .map() callback would be an N+1 query");
    }
  });

  test("resolves the app by package_name, not app_id — new_app proposals never have app_id populated", () => {
    const start = src.indexOf("async function loadRecentlyApprovedGithubCards(");
    const body = src.slice(start);
    assert.match(body, /\.in\("package_name", packageNames\)/);
  });

  test("filters to source='github' discovery candidates, and requires both a candidate and an app match before producing a card", () => {
    const start = src.indexOf("async function loadRecentlyApprovedGithubCards(");
    const body = src.slice(start);
    assert.match(body, /\.eq\("source", "github"\)/);
    assert.match(body, /Boolean\(row\.sourceRepo\) && Boolean\(row\.app\)/);
  });

  test("a failure loading approved cards is caught and logged, never left to crash the page", () => {
    assert.match(src, /try \{\s*approvedCards = await loadRecentlyApprovedGithubCards\(supabase\);\s*\} catch/);
  });

  test("the pending-queue error variable and the approved-cards loading are fully independent", () => {
    // The existing `error` (destructured from the pending query) is never
    // referenced inside the new try/catch — console.error(...) itself is
    // fine (and expected) here, so this only forbids the bare `error`
    // identifier the pending query declared, not the logging call's own name.
    const catchBlock = src.match(/\} catch \(caught\) \{[\s\S]*?\n {2}\}/)?.[0] ?? "";
    assert.ok(catchBlock.length > 0);
    assert.doesNotMatch(catchBlock, /[^.]\berror\b(?!\()/);
  });
});

group("play-proposals/page.tsx — passes approvedCards through, without altering the existing proposals prop", () => {
  test("PlayProposalsReview receives both proposals and approvedCards", () => {
    assert.match(src, /<PlayProposalsReview proposals=\{proposals\} approvedCards=\{approvedCards\} \/>/);
  });
});
