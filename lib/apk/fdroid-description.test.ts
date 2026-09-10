import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFdroidDescriptionCandidate,
  dedupeLeadingName,
  hasManualDescription,
  hasMeaningfulExtraContent,
  isThinDescription,
  lacksProseLeadIn,
  planDescriptionBackfill,
  stripHtml,
  THIN_DESCRIPTION_MAX_LEN,
  trimToBoundary,
  type BackfillInput,
} from "./fdroid-description.ts";
import { FakeSupabase } from "./test-helpers/fake-supabase.ts";

/**
 * Run with: npm test
 *
 * Covers the generalised F-Droid description backfill's decision logic and
 * text processing. The runner script (scripts/backfill-fdroid-descriptions-all.mjs)
 * is a thin wrapper over these functions plus an optimistic-concurrency
 * UPDATE; the last group exercises that write pattern against the in-memory
 * Supabase fake.
 */

function input(overrides: Partial<BackfillInput> = {}): BackfillInput {
  return {
    sourceType: "fdroid",
    hasPublishedBuild: true,
    manualFields: [],
    // A clean ~40-char one-liner: thin, but worth protecting from a marginal reword.
    currentDescription: "A simple, private offline note-taking app.",
    candidate:
      "NoteKeeper is a local-first note app for Android. Your notes stay on the device, there is no account, and the app requests no network permission at all. Markdown, tags and full-text search are built in.",
    ...overrides,
  };
}

group("planDescriptionBackfill — safety gates", () => {
  test("manual_fields = ['description'] -> skip, never modified", () => {
    const d = planDescriptionBackfill(input({ manualFields: ["description"] }));
    assert.deepEqual(d, { action: "skip", reason: "manual-override" });
  });

  test("manual_fields with description alongside other fields -> still skip", () => {
    const d = planDescriptionBackfill(
      input({ manualFields: ["icon_url", "description", "category"] }),
    );
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "manual-override");
  });

  test("external source -> skip", () => {
    const d = planDescriptionBackfill(input({ sourceType: "external" }));
    assert.deepEqual(d, { action: "skip", reason: "not-fdroid" });
  });

  test("null / unknown source -> skip (not-fdroid)", () => {
    assert.equal(planDescriptionBackfill(input({ sourceType: null })).reason, "not-fdroid");
    assert.equal(planDescriptionBackfill(input({ sourceType: "playstore" })).reason, "not-fdroid");
  });

  test("no published build -> skip", () => {
    const d = planDescriptionBackfill(input({ hasPublishedBuild: false }));
    assert.deepEqual(d, { action: "skip", reason: "no-published-build" });
  });

  test("current description is not thin -> skip even if candidate is longer", () => {
    const notThin = "x".repeat(THIN_DESCRIPTION_MAX_LEN + 5);
    const d = planDescriptionBackfill(
      input({ currentDescription: notThin, candidate: "y".repeat(THIN_DESCRIPTION_MAX_LEN + 200) }),
    );
    assert.deepEqual(d, { action: "skip", reason: "not-thin" });
  });

  test("thin current but no usable upstream text -> skip", () => {
    assert.equal(planDescriptionBackfill(input({ candidate: null })).reason, "no-upstream-description");
    assert.equal(planDescriptionBackfill(input({ candidate: "   " })).reason, "no-upstream-description");
  });

  test("candidate shorter than current -> skip (never shorten)", () => {
    const d = planDescriptionBackfill(
      input({ currentDescription: "A fairly descriptive one-liner about the app here.", candidate: "Tiny." }),
    );
    assert.deepEqual(d, { action: "skip", reason: "candidate-not-longer" });
  });

  test("candidate equal length to current -> skip", () => {
    const same = "Exactly the same length string here, twice over now.";
    const d = planDescriptionBackfill(input({ currentDescription: same, candidate: same }));
    assert.equal(d.reason, "candidate-not-longer");
  });

  test("candidate longer with real extra content -> update", () => {
    const d = planDescriptionBackfill(input());
    assert.deepEqual(d, { action: "update", reason: "thin-description-upgraded" });
  });

  test("near-empty current + any real prose candidate -> update (no one-liner to protect)", () => {
    const d = planDescriptionBackfill(
      input({ currentDescription: null, candidate: "A real sentence now." }),
    );
    assert.deepEqual(d, { action: "update", reason: "thin-description-upgraded" });
    const d2 = planDescriptionBackfill(
      input({ currentDescription: "Tuner.", candidate: "A precise chromatic tuner." }),
    );
    assert.equal(d2.action, "update");
  });

  test("gate order: external + manual + no-build all true -> reports not-fdroid first", () => {
    const d = planDescriptionBackfill(
      input({ sourceType: "external", manualFields: ["description"], hasPublishedBuild: false }),
    );
    assert.equal(d.reason, "not-fdroid");
  });
});

group("planDescriptionBackfill — marginal-gain gate", () => {
  test("GeauxWeather case: +5 chars, one sentence -> skip (not meaningfully longer)", () => {
    const d = planDescriptionBackfill(
      input({
        currentDescription: "Clean, fast, no-ads weather with radar, storms, and places",
        candidate: "GeauxWeather is a free weather app with no ads and no tracking.",
      }),
    );
    assert.deepEqual(d, { action: "skip", reason: "candidate-not-meaningfully-longer" });
  });

  test("Malarm case: reworded single sentence, +21 chars -> skip (not meaningfully longer)", () => {
    const d = planDescriptionBackfill(
      input({
        currentDescription: "A flexible, no-frills alarm scheduler.",
        candidate: "Malarm is a flexible, no-frills alarm scheduler for Android.",
      }),
    );
    assert.deepEqual(d, { action: "skip", reason: "candidate-not-meaningfully-longer" });
  });

  test("short but genuinely fuller: < 30 chars longer BUT a full extra sentence -> update", () => {
    const d = planDescriptionBackfill(
      input({
        currentDescription: "A weather app with radar and alerts, nothing more.",
        candidate: "A weather app with radar and alerts. It also shows tides.",
      }),
    );
    assert.equal(d.action, "update");
  });

  test(">= 30 chars longer is always meaningful, even as one sentence", () => {
    // current is 34 chars, comfortably past the < 20 "nothing to protect" gate.
    const current = "A short descriptive label here now.";
    assert.equal(
      hasMeaningfulExtraContent(
        current,
        "A short descriptive label here now that carries well past thirty extra characters of real detail.",
      ),
      true,
    );
    assert.equal(
      hasMeaningfulExtraContent(current, "A short descriptive label here now, plus a bit."),
      false,
    );
  });
});

group("planDescriptionBackfill — prose-less candidates -> manual review", () => {
  const bulletCandidates: Record<string, string> = {
    "Block Blast": "- 100% Free & Open Source - Zero Ads, No Trackers - Campaign & Procedurally Generated Infinite Levels - Full Offline",
    "Einstein's Riddle": "FEATURES: - 100% Privacy: Fully offline play. No data collection, tracking, or network requests required. - Completely Ad-free.",
    "Goregram": "Features - Allow saving and copying messages from chats - Unlock local Telegram Premium features for free - Remove sponsored messages",
    "Mahjong Solitaire": "Key Features - No Ads & No Trackers: 100% private. - Infinite Levels: Procedurally generated boards.",
    "Match 3": "Features & Key Perks - 100% Privacy Focused: No user data collection. - Zero Ads: Play with no interruptions.",
  };

  for (const [name, candidate] of Object.entries(bulletCandidates)) {
    test(`${name} -> manual-review (candidate-lacks-prose), not an auto update`, () => {
      const d = planDescriptionBackfill(input({ candidate }));
      assert.deepEqual(d, { action: "manual-review", reason: "candidate-lacks-prose" });
    });
  }

  test("a real sentence THEN a feature list is fine -> update", () => {
    const d = planDescriptionBackfill(
      input({
        candidate:
          "Hestia controls your Shelly smart-home devices directly on your local network. Features: * Channel dashboard. * Per-device timers.",
      }),
    );
    assert.equal(d.action, "update");
  });

  test("lacksProseLeadIn direct checks", () => {
    assert.equal(lacksProseLeadIn("- item one - item two"), true);
    assert.equal(lacksProseLeadIn("• item one • item two"), true);
    assert.equal(lacksProseLeadIn("FEATURES: offline, private, fast"), true);
    assert.equal(lacksProseLeadIn("Key Features - offline - private"), true);
    assert.equal(lacksProseLeadIn("Features & Perks — offline, private"), true);
    assert.equal(lacksProseLeadIn("A real app. Features: offline, private."), false);
    assert.equal(lacksProseLeadIn("A calm, minimal launcher with no ads."), false);
    assert.equal(lacksProseLeadIn("Manage your budget - track spending and set limits every month."), false);
  });
});

group("isThinDescription / hasManualDescription", () => {
  test("null, empty, whitespace, and short strings are thin", () => {
    assert.equal(isThinDescription(null), true);
    assert.equal(isThinDescription(undefined), true);
    assert.equal(isThinDescription("   "), true);
    assert.equal(isThinDescription("F-Droid one-liner summary text"), true);
  });

  test("a full paragraph over the threshold is not thin", () => {
    assert.equal(isThinDescription("x".repeat(THIN_DESCRIPTION_MAX_LEN)), false);
    assert.equal(isThinDescription("x".repeat(THIN_DESCRIPTION_MAX_LEN - 1)), true);
  });

  test("hasManualDescription only fires for the exact 'description' entry", () => {
    assert.equal(hasManualDescription(["description"]), true);
    assert.equal(hasManualDescription(["name", "icon_url"]), false);
    assert.equal(hasManualDescription([]), false);
    assert.equal(hasManualDescription(null), false);
  });
});

group("stripHtml", () => {
  test("removes tags and entities, collapses whitespace", () => {
    assert.equal(stripHtml("<p>Hello&nbsp;<b>there</b></p>\n\n  world  "), "Hello there world");
  });

  test("a script tag's textual content survives but the tags are gone (no HTML in output)", () => {
    const out = stripHtml("<script>alert(1)</script>Safe text");
    assert.equal(out.includes("<"), false);
    assert.equal(out.includes(">"), false);
    assert.match(out, /Safe text/);
  });

  test("null / undefined -> empty string", () => {
    assert.equal(stripHtml(null), "");
    assert.equal(stripHtml(undefined), "");
  });
});

group("trimToBoundary — 400-char cap and boundary safety", () => {
  test("text under the cap is returned unchanged (just trimmed)", () => {
    assert.equal(trimToBoundary("  Short and sweet.  "), "Short and sweet.");
  });

  test("prefers the last complete sentence within the window", () => {
    const long = "First sentence is here. Second sentence is also here. " + "x".repeat(400);
    const out = trimToBoundary(long, 400);
    assert.ok(out.length <= 400);
    assert.equal(out, "First sentence is here. Second sentence is also here.");
  });

  test("the Malarm case: does NOT cut after 'e.g.' — falls back to the previous real sentence", () => {
    const long =
      "Malarm is a flexible, no-frills alarm scheduler for Android. Features: * One-time and date-specific alarms (e.g. " +
      "one-time reminders, weekly repeats, and many more variations) plus " +
      "x".repeat(400);
    const out = trimToBoundary(long, 400);
    assert.ok(out.length <= 400);
    assert.equal(out, "Malarm is a flexible, no-frills alarm scheduler for Android.");
    assert.equal(out.includes("(e.g"), false);
  });

  test("common abbreviations are not treated as sentence ends", () => {
    for (const abbr of ["e.g.", "i.e.", "etc.", "vs.", "Mr.", "St."]) {
      const long =
        `A real opening sentence that is complete. Then a clause ending in ${abbr} ` +
        "and it keeps going well past four hundred characters " +
        "y".repeat(400);
      const out = trimToBoundary(long, 400);
      assert.equal(
        out,
        "A real opening sentence that is complete.",
        `abbreviation "${abbr}" must not be a cut point`,
      );
    }
  });

  test("a lone trailing initial ('...named A.') is not a cut point", () => {
    const long =
      "The full first sentence stands on its own. A person named A. did something " +
      "z".repeat(400);
    const out = trimToBoundary(long, 400);
    assert.equal(out, "The full first sentence stands on its own.");
  });

  test("rejects a boundary that would leave an unbalanced '(' — falls back to the previous one", () => {
    const long =
      "Opening sentence is fine. Then we start a parenthetical (with a full stop inside. " +
      "and much more text that runs on and on " +
      "q".repeat(400);
    const out = trimToBoundary(long, 400);
    // The "(with a full stop inside." boundary is unbalanced -> use "Opening sentence is fine."
    assert.equal(out, "Opening sentence is fine.");
    assert.equal(out.includes("("), false);
  });

  test("falls back to a word boundary when there is no safe sentence end", () => {
    const long = "word ".repeat(200).trim(); // 999 chars, no sentence punctuation
    const out = trimToBoundary(long, 400);
    assert.ok(out.length <= 400);
    assert.equal(out.endsWith("word"), true);
    assert.equal(out.includes("  "), false);
  });

  test("word-boundary fallback also avoids leaving an unbalanced bracket", () => {
    const long = "aaaa (bbbb " + "cccc ".repeat(120); // no sentence punctuation, an open paren early
    const out = trimToBoundary(long, 400);
    assert.equal(isBracketBalancedForTest(out), true);
  });

  test("never turns non-empty input into empty output, never exceeds max", () => {
    const noSpaces = "x".repeat(1000);
    const out = trimToBoundary(noSpaces, 400);
    assert.equal(out.length, 400);
  });
});

// small local mirror of the module-internal bracket check, for the test above
function isBracketBalancedForTest(text: string): boolean {
  let r = 0;
  let s = 0;
  for (const ch of text) {
    if (ch === "(") r++;
    else if (ch === ")") r--;
    else if (ch === "[") s++;
    else if (ch === "]") s--;
    if (r < 0 || s < 0) return false;
  }
  return r === 0 && s === 0;
}

group("dedupeLeadingName", () => {
  test("removes a doubled leading app name", () => {
    assert.equal(
      dedupeLeadingName("Arcade Arcade is a minimal game launcher.", "Arcade"),
      "Arcade is a minimal game launcher.",
    );
  });

  test("removes a doubled leading name behind emoji / punctuation", () => {
    assert.equal(
      dedupeLeadingName("🌠 Diadem Diadem is a next-gen GO Map.", "Diadem"),
      "Diadem is a next-gen GO Map.",
    );
  });

  test("leaves a single leading mention alone", () => {
    const text = "Arcade is a minimal game launcher for Arcade fans.";
    assert.equal(dedupeLeadingName(text, "Arcade"), text);
  });

  test("does not touch a later mention of the name", () => {
    const text = "A minimal launcher. Arcade Arcade appears mid-text and stays.";
    assert.equal(dedupeLeadingName(text, "Arcade"), text);
  });

  test("regex-significant characters in the app name are escaped, not injected", () => {
    assert.equal(
      dedupeLeadingName("Mr. Sudoku Mr. Sudoku is a number puzzle.", "Mr. Sudoku"),
      "Mr. Sudoku is a number puzzle.",
    );
    assert.doesNotThrow(() => dedupeLeadingName("Foo (Bar) some text", "Foo (Bar)"));
  });

  test("a name ending in a non-word char (e.g. 'C++') is left as-is rather than mis-stripped", () => {
    assert.equal(
      dedupeLeadingName("C++ C++ is a systems language wrapper.", "C++"),
      "C++ C++ is a systems language wrapper.",
    );
  });
});

group("buildFdroidDescriptionCandidate", () => {
  test("prefers the fuller localized en-US description over the summary", () => {
    const out = buildFdroidDescriptionCandidate({
      name: "Tuner",
      localized: {
        "en-US": {
          summary: "A simple and precise tuner",
          description: "The app listens through your microphone and shows in real time how close each note is.",
        },
      },
    });
    assert.equal(out, "The app listens through your microphone and shows in real time how close each note is.");
  });

  test("falls back to en, then to top-level fields", () => {
    assert.equal(
      buildFdroidDescriptionCandidate({ localized: { en: { description: "English fallback description text." } } }),
      "English fallback description text.",
    );
    assert.equal(
      buildFdroidDescriptionCandidate({ description: "Top-level description only." }),
      "Top-level description only.",
    );
  });

  test("keeps the summary when it is the only text available", () => {
    assert.equal(
      buildFdroidDescriptionCandidate({ localized: { "en-US": { summary: "Only a summary here" } } }),
      "Only a summary here",
    );
  });

  test("strips HTML and dedupes the leading name in one pass", () => {
    const out = buildFdroidDescriptionCandidate({
      name: "Arcade",
      localized: { "en-US": { description: "<p>Arcade Arcade is a <b>minimal</b> launcher.</p>" } },
    });
    assert.equal(out, "Arcade is a minimal launcher.");
  });

  test("caps at 400 characters on a safe sentence boundary", () => {
    const long = "Sentence one is complete. " + "y".repeat(500);
    const out = buildFdroidDescriptionCandidate({ localized: { "en-US": { description: long } } });
    assert.ok(out!.length <= 400);
    assert.equal(out, "Sentence one is complete.");
  });

  test("returns null when there is no usable text at all", () => {
    assert.equal(buildFdroidDescriptionCandidate({}), null);
    assert.equal(buildFdroidDescriptionCandidate({ localized: { "en-US": { summary: "   " } } }), null);
  });
});

// --------------------------------------------------------------------------
// Optimistic-concurrency write pattern the runner uses. Not the pure logic —
// this proves the guarded UPDATE does not clobber a description that changed
// between the read and the write.

function client(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}

/** Mirrors scripts/backfill-fdroid-descriptions-all.mjs's guarded write. */
async function applyGuardedUpdate(
  supabase: SupabaseClient,
  id: string,
  previousDescription: string,
  candidate: string,
): Promise<"written" | "raced"> {
  const { data } = await supabase
    .from("apps")
    .update({ description: candidate })
    .eq("id", id)
    .eq("source_type", "fdroid")
    .eq("description", previousDescription)
    .select("id");
  return data && (data as unknown[]).length > 0 ? "written" : "raced";
}

group("guarded UPDATE — concurrency protection", () => {
  test("writes when the row still holds the description that was read", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "a1", source_type: "fdroid", description: "Old thin text." });

    const result = await applyGuardedUpdate(
      client(fake),
      "a1",
      "Old thin text.",
      "A much fuller replacement paragraph that clears the bar and then some.",
    );

    assert.equal(result, "written");
    assert.equal(
      fake.apps[0].description,
      "A much fuller replacement paragraph that clears the bar and then some.",
    );
  });

  test("does NOT overwrite when the description changed between read and write", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "a1", source_type: "fdroid", description: "Old thin text." });
    fake.onBeforeUpdate = (table) => {
      if (table === "apps") fake.apps[0].description = "Hand-written override, do not touch.";
    };

    const result = await applyGuardedUpdate(
      client(fake),
      "a1",
      "Old thin text.",
      "Automated fuller paragraph that should now be rejected.",
    );

    assert.equal(result, "raced");
    assert.equal(fake.apps[0].description, "Hand-written override, do not touch.");
  });

  test("does not touch a row whose source_type is no longer fdroid", async () => {
    const fake = new FakeSupabase();
    fake.apps.push({ id: "a1", source_type: "external", description: "Old thin text." });

    const result = await applyGuardedUpdate(client(fake), "a1", "Old thin text.", "Longer replacement text here now.");

    assert.equal(result, "raced");
    assert.equal(fake.apps[0].description, "Old thin text.");
  });
});
