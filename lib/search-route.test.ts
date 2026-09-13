import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Static, source-level assertions against app/api/search/route.ts —
 * next/server's NextRequest/NextResponse have no meaning outside a Next.js
 * runtime, so this route can't be imported directly under plain
 * `node --test` (the same constraint documented throughout this project,
 * e.g. lib/metadata/play-proposals-review-component.test.ts). The route's
 * actual decision logic (query validation, search) is extracted into
 * lib/search.ts and tested directly/behaviorally there — this file only
 * checks the route's own wiring and safety properties.
 */

const routeSrc = readFileSync(
  fileURLToPath(new URL("../app/api/search/route.ts", import.meta.url)),
  "utf8",
);

group("app/api/search/route.ts — wiring", () => {
  test("delegates query validation and searching to lib/search.ts rather than reimplementing them", () => {
    assert.match(routeSrc, /import \{ searchApps, validateSearchQuery \} from "@\/lib\/search";/);
    assert.match(routeSrc, /validateSearchQuery\(rawQuery\)/);
    assert.match(routeSrc, /searchApps\(validation\.value, supabase\)/);
  });

  test("imports the public/anon Supabase client to pass into searchApps, not a service-role client", () => {
    assert.match(routeSrc, /import \{ supabase \} from "@\/lib\/supabase\/public";/);
  });

  test("is a GET handler, read-only — no POST/PUT/DELETE exported", () => {
    assert.match(routeSrc, /export async function GET\(/);
    assert.doesNotMatch(routeSrc, /export async function (POST|PUT|DELETE|PATCH)\(/);
  });

  test("requires no authentication check — this is deliberately public data", () => {
    assert.doesNotMatch(routeSrc, /isAdmin/);
    assert.doesNotMatch(routeSrc, /getUser/);
  });
});

group("app/api/search/route.ts — safety", () => {
  test("never imports or references the service-role key", () => {
    assert.doesNotMatch(routeSrc, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(routeSrc, /service_role/i);
  });

  test("never constructs its own Supabase client — only the shared public client via lib/search.ts", () => {
    assert.doesNotMatch(routeSrc, /createClient\(/);
  });

  test("never echoes the caught error's own message back to the client — only a generic, fixed string", () => {
    const catchBlock = routeSrc.slice(routeSrc.indexOf("} catch (caught)"));
    assert.doesNotMatch(catchBlock, /caught\.message/);
    assert.doesNotMatch(catchBlock, /\$\{caught\}/);
    assert.match(catchBlock, /"Search is temporarily unavailable\."/);
  });

  test("rejects an over-length query with 400 before ever calling the database", () => {
    assert.match(routeSrc, /"too_long"/);
    assert.match(routeSrc, /status: 400/);
  });

  test("an empty query returns an empty results array directly, without calling searchApps", () => {
    const emptyBranch = routeSrc.slice(routeSrc.indexOf('"empty"'), routeSrc.indexOf("try {"));
    assert.match(emptyBranch, /results: \[\]/);
  });
});
