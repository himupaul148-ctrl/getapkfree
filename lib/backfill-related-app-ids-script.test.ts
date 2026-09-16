import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { TARGETS, EXCLUDED_SLUGS, preflight } from "../scripts/backfill-related-app-ids.mjs";

/**
 * Tests for scripts/backfill-related-app-ids.mjs — the one-time, hand-
 * audited backfill for the related_app_ids publishing bug. TARGETS and
 * EXCLUDED_SLUGS are plain data (no Supabase client is created at module
 * scope — that only happens inside main(), which these tests never call),
 * so this loads directly under plain `node --test`. preflight() is tested
 * behaviorally against a minimal fake Supabase client, the same technique
 * lib/apk/test-helpers/fake-supabase.ts uses elsewhere in this project.
 */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

group("TARGETS — static shape, matching the completed audit exactly", () => {
  test("exactly 11 targets", () => {
    assert.equal(TARGETS.length, 11);
  });

  test("every target has a non-empty relatedAppIds array of well-formed UUIDs", () => {
    for (const target of TARGETS) {
      assert.ok(target.relatedAppIds.length > 0, `${target.slug} has no related app ids`);
      for (const id of target.relatedAppIds) {
        assert.match(id, UUID_RE, `${target.slug}: "${id}" is not a valid UUID`);
      }
    }
  });

  test("no target's relatedAppIds contains a duplicate app id", () => {
    for (const target of TARGETS) {
      const unique = new Set(target.relatedAppIds);
      assert.equal(unique.size, target.relatedAppIds.length, `${target.slug} has a duplicate app id`);
    }
  });

  test("no duplicate slugs across TARGETS", () => {
    const slugs = TARGETS.map((t) => t.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  test("no duplicate post ids across TARGETS", () => {
    const ids = TARGETS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("every target id is itself a well-formed UUID", () => {
    for (const target of TARGETS) {
      assert.match(target.id, UUID_RE, `${target.slug}: post id "${target.id}" is not a valid UUID`);
    }
  });
});

group("EXCLUDED_SLUGS — the two posts this script must never touch", () => {
  test("contains exactly the two known-excluded posts", () => {
    assert.deepEqual(
      [...EXCLUDED_SLUGS].sort(),
      ["best-privacy-apps-android-2026", "top-lightweight-tools-under-10mb"].sort(),
    );
  });

  test("no overlap between TARGETS and EXCLUDED_SLUGS", () => {
    const targetSlugs = new Set(TARGETS.map((t) => t.slug));
    for (const excluded of EXCLUDED_SLUGS) {
      assert.equal(targetSlugs.has(excluded), false, `${excluded} is both a target and excluded`);
    }
  });
});

/** A minimal fake matching only the .from(table).select(...).in(...) shape
 *  preflight() actually calls — nothing more elaborate is needed here. */
function fakeDb({ blogPostsRows, blogPostsError = null, appsRows, appsError = null }) {
  return {
    from(table) {
      return {
        select() {
          return {
            in() {
              if (table === "blog_posts") {
                return Promise.resolve({ data: blogPostsError ? null : blogPostsRows, error: blogPostsError });
              }
              if (table === "apps") {
                return Promise.resolve({ data: appsError ? null : appsRows, error: appsError });
              }
              throw new Error(`fakeDb: unexpected table "${table}"`);
            },
          };
        },
      };
    },
  };
}

/** Rows that satisfy every precondition for every target — the happy path
 *  other tests mutate one field of. */
function passingBlogPostsRows() {
  return TARGETS.map((t) => ({
    id: t.id,
    slug: t.slug,
    title: `Title for ${t.slug}`,
    published: true,
    related_app_ids: [],
  }));
}

function allProposedAppRows() {
  const ids = [...new Set(TARGETS.flatMap((t) => t.relatedAppIds))];
  return ids.map((id) => ({ id }));
}

group("preflight — the happy path", () => {
  test("passes when every row matches exactly what TARGETS expects", async () => {
    const db = fakeDb({ blogPostsRows: passingBlogPostsRows(), appsRows: allProposedAppRows() });
    const result = await preflight(db);
    assert.equal(result.ok, true);
    assert.deepEqual(result.problems, []);
    assert.equal(result.rows.length, 11);
  });
});

group("preflight — refuses to pass on any single broken precondition", () => {
  test("a missing target row fails preflight", async () => {
    const rows = passingBlogPostsRows().slice(1); // drop the first target's row
    const db = fakeDb({ blogPostsRows: rows, appsRows: allProposedAppRows() });
    const result = await preflight(db);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("no longer exists")));
  });

  test("a target that is no longer published fails preflight", async () => {
    const rows = passingBlogPostsRows();
    rows[0].published = false;
    const db = fakeDb({ blogPostsRows: rows, appsRows: allProposedAppRows() });
    const result = await preflight(db);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("no longer published")));
  });

  test("a target whose related_app_ids is no longer empty fails preflight", async () => {
    const rows = passingBlogPostsRows();
    rows[0].related_app_ids = ["561cc462-86f1-44bd-a834-fa202c764dbe"];
    const db = fakeDb({ blogPostsRows: rows, appsRows: allProposedAppRows() });
    const result = await preflight(db);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("no longer empty")));
  });

  test("a proposed app id that no longer exists fails preflight", async () => {
    const appsRows = allProposedAppRows().slice(1); // drop one real app id
    const db = fakeDb({ blogPostsRows: passingBlogPostsRows(), appsRows });
    const result = await preflight(db);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("no longer exist in apps")));
  });

  test("a blog_posts query error fails preflight without a crash", async () => {
    const db = fakeDb({ blogPostsError: { message: "boom" }, appsRows: allProposedAppRows() });
    const result = await preflight(db);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("could not read blog_posts")));
  });

  test("an apps query error fails preflight without a crash", async () => {
    const db = fakeDb({ blogPostsRows: passingBlogPostsRows(), appsError: { message: "boom" } });
    const result = await preflight(db);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes("could not verify app ids")));
  });

  test("a slug mismatch between TARGETS and the fetched row is caught", () => {
    const rows = passingBlogPostsRows();
    rows[0].slug = "some-other-slug";
    const db = fakeDb({ blogPostsRows: rows, appsRows: allProposedAppRows() });
    return preflight(db).then((result) => {
      assert.equal(result.ok, false);
      assert.ok(result.problems.some((p) => p.includes("expected slug")));
    });
  });
});
