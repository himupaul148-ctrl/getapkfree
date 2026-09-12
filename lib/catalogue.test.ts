import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { cache } from "react";

/**
 * P3-2: getAppBySlug and getPublishedVersions (lib/catalogue.ts) are wrapped
 * in React's cache() so app/app/[slug]/page.tsx's two calls to each (once
 * from generateMetadata, once from the page body) collapse into one Supabase
 * round trip per request.
 *
 * This file cannot import lib/catalogue.ts directly: that module imports
 * `unstable_cache` from "next/cache" and the Supabase client from
 * "@/lib/supabase/public", and this project's test runner is plain
 * `node --test` with no bundler and no path-alias resolution (confirmed:
 * attempting the import fails at `next/cache` itself before the alias issue
 * even comes up — the same structural reason this file never existed
 * before). So these tests target the one thing that actually changed and
 * can be verified in isolation: the `cache()` primitive's own contract,
 * using the exact same `cache` import lib/catalogue.ts now uses, against
 * small local stand-in functions.
 *
 * One thing these tests deliberately do NOT assert: that two calls with the
 * same argument invoke the underlying function only once. cache()'s
 * cross-call dedup is only active inside a live React Server Component
 * render (the "react-server" condition Next.js's runtime provides) — under
 * plain `node --test`, which resolves the ordinary "react" package, cache()
 * is a documented no-op passthrough. Confirmed directly while building this
 * fix: wrapping a counting function and calling it twice with the same
 * argument here still invokes it twice, not once. Asserting call-count-1 in
 * this file would therefore either fail honestly or pass by accident —
 * neither would prove anything about lib/catalogue.ts's real, request-scoped
 * behavior inside the actual app, which is where that guarantee is Next.js's
 * (not this project's) to keep.
 */

group("cache()'s arity-erasure — the one wrapper effect visible without a render", () => {
  test("wrapping a function makes it report .length === 0, regardless of its real arity", () => {
    const rawOneArg = (a: string) => a;
    const wrappedOneArg = cache(rawOneArg);
    const rawTwoArg = (a: string, b: number) => `${a}${b}`;
    const wrappedTwoArg = cache(rawTwoArg);

    assert.equal(rawOneArg.length, 1);
    assert.equal(wrappedOneArg.length, 0);
    assert.equal(rawTwoArg.length, 2);
    assert.equal(wrappedTwoArg.length, 0);
  });
});

group("cache()'s pass-through contract (the guarantee lib/catalogue.ts relies on)", () => {
  test("a resolved value passes through unchanged", async () => {
    const fn = cache(async (n: number) => ({ doubled: n * 2 }));
    assert.deepEqual(await fn(5), { doubled: 10 });
  });

  test("different arguments produce independent, correct results", async () => {
    const fn = cache(async (n: number) => n * 2);
    const [a, b] = await Promise.all([fn(1), fn(2)]);
    assert.equal(a, 2);
    assert.equal(b, 4);
  });

  test("a rejection passes through unchanged rather than being swallowed or altered", async () => {
    const fn = cache(async (): Promise<never> => {
      throw new Error("boom");
    });
    await assert.rejects(() => fn(), /boom/);
  });

  test("null and empty-array results — what getAppBySlug/getPublishedVersions return on a miss — pass through unchanged", async () => {
    const nullish = cache(async () => null);
    const empty = cache(async () => [] as unknown[]);
    assert.equal(await nullish("missing"), null);
    assert.deepEqual(await empty("missing"), []);
  });
});
