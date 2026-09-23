import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  appDescriptionSuffix,
  appSummarySentence,
  blogCategoryMetaDescription,
  categoryMetaDescription,
  clampDescription,
  licenseAndTargetSdkLine,
  SITE_DESCRIPTION,
  type AppSummaryFacts,
} from "./seo.ts";
import { BLOG_CATEGORIES } from "./blog-categories.ts";

/**
 * Covers the bug found in the Multimedia content audit: the app detail page's
 * meta description used to append "Free, open-source, malware-scanned." to
 * every app regardless of source, which is false for an external listing
 * (Netflix, Spotify, MX Player, and the like) — GetApkFree neither built it
 * from source nor scanned it, and the page's own body says so.
 */
group("appDescriptionSuffix", () => {
  test("an F-Droid app keeps the open-source/malware-scanned claim", () => {
    assert.equal(
      appDescriptionSuffix("fdroid"),
      "Free, open-source, malware-scanned.",
    );
  });

  test("an external app makes no open-source or malware-scanned claim", () => {
    const suffix = appDescriptionSuffix("external");
    assert.doesNotMatch(suffix, /open-source/i);
    assert.doesNotMatch(suffix, /malware-scanned/i);
    assert.doesNotMatch(suffix, /scanned/i);
  });

  test("an external app's suffix is still accurate, not just empty", () => {
    assert.equal(
      appDescriptionSuffix("external"),
      "Free download, linked to its official source.",
    );
  });
});

/**
 * P2-4: the homepage's site-wide meta description used to claim "Every
 * build is versioned, malware-scanned, and published with its full
 * changelog" unconditionally — false for the catalogue's external (official
 * source, not scanned by us) listings. It now distinguishes the two rather
 * than asserting scanning applies to the whole catalogue.
 *
 * P1 homepage-description-length fix: the audit found this same constant was
 * 213 characters — over clampDescription's own default 160-character max —
 * and was used verbatim/unclamped in app/layout.tsx and app/page.tsx,
 * risking SERP truncation on the site's own homepage. Shortened to preserve
 * the same brand claims (free/open-source, F-Droid builds versioned and
 * malware-scanned, non-F-Droid apps link to their official source) at a
 * naturally safe length, and its two call sites now wrap it in
 * clampDescription() as a defensive safety net (see app/layout.tsx's
 * DEFAULT_DESCRIPTION and app/page.tsx's HOME_DESCRIPTION).
 */
group("SITE_DESCRIPTION", () => {
  test("does not claim every build is malware-scanned", () => {
    assert.doesNotMatch(SITE_DESCRIPTION, /every build is.*malware-scanned/i);
  });

  test("distinguishes F-Droid builds from everything else", () => {
    assert.match(SITE_DESCRIPTION, /F-Droid builds are.*malware-scanned/i);
    assert.match(SITE_DESCRIPTION, /official source/i);
  });

  test("is within clampDescription's own default max length (160) — safely bounded by design, not relying on truncation at the point of use", () => {
    assert.ok(
      SITE_DESCRIPTION.length <= 160,
      `expected SITE_DESCRIPTION.length (${SITE_DESCRIPTION.length}) to be <= 160`,
    );
  });

  test("clampDescription(SITE_DESCRIPTION) is a true no-op — the constant never actually gets truncated/ellipsis-ed when passed through the helper", () => {
    assert.equal(clampDescription(SITE_DESCRIPTION), SITE_DESCRIPTION);
  });

  test("still describes GetApkFree accurately — free, open-source, no keyword stuffing or repeated 'APK download' phrasing", () => {
    assert.match(SITE_DESCRIPTION, /free/i);
    assert.match(SITE_DESCRIPTION, /open-source/i);
    // "download" (as a word) appears at most once — no repeated
    // "APK download... download... download" keyword stuffing.
    const downloadOccurrences = (SITE_DESCRIPTION.match(/download/gi) ?? []).length;
    assert.ok(downloadOccurrences <= 1, `expected at most 1 occurrence of "download", found ${downloadOccurrences}`);
  });

  test("still a genuine, meaningful sentence — not reduced to a bare keyword fragment", () => {
    assert.ok(SITE_DESCRIPTION.length > 40, "expected more than a token-length fragment");
    assert.match(SITE_DESCRIPTION, /\./, "expected at least one real sentence boundary");
  });
});

/**
 * P2-4: a category page's meta description used to repeat the same
 * unconditional "malware-scanned" claim per category, even though most
 * categories mix F-Droid and external listings. categoryMetaDescription
 * uses one wording that holds regardless of a given category's actual mix,
 * rather than branching per category.
 */
group("categoryMetaDescription", () => {
  test("does not claim every build in the category is malware-scanned", () => {
    const description = categoryMetaDescription("Tools");
    assert.doesNotMatch(description, /every build is.*malware-scanned/i);
  });

  test("distinguishes F-Droid builds from official-source listings", () => {
    const description = categoryMetaDescription("Tools");
    assert.match(description, /F-Droid builds are.*malware-scanned/i);
    assert.match(description, /official-source/i);
  });

  test("interpolates the given category, lowercased", () => {
    assert.match(categoryMetaDescription("Education"), /android education apps/i);
  });

  test("produces the same wording regardless of the category's actual source mix", () => {
    // categoryMetaDescription has no access to a category's real F-Droid/
    // external counts, and shouldn't need any: the same sentence must be
    // true whether a category, in fact, is all-F-Droid, all-external, or
    // mixed, which is exactly why it does not brand per category.
    const tools = categoryMetaDescription("Tools").replace(/tools/gi, "X");
    const education = categoryMetaDescription("Education").replace(/education/gi, "X");
    assert.equal(tools, education);
  });
});

/**
 * P1 blog-listing-metadata fix: unlike categoryMetaDescription above (one
 * template shared by every app category), blogCategoryMetaDescription gives
 * every one of the six canonical blog categories (lib/blog-categories.ts) its
 * own bespoke sentence — a template collides for the "guides" category, since
 * the word "guides" is also the generic noun the rest of the blog's own copy
 * uses for its content (see app/blog/page.tsx's base description).
 */
group("blogCategoryMetaDescription", () => {
  test("every canonical blog category (lib/blog-categories.ts) has its own real description, not the generic fallback", () => {
    const fallback = "Guides, tips and app recommendations from the GetApkFree team.";
    for (const category of BLOG_CATEGORIES) {
      const description = blogCategoryMetaDescription(category);
      assert.notEqual(description, fallback, `expected a bespoke description for "${category}"`);
      assert.ok(description.length > 0);
    }
  });

  test("every description is unique — no two categories share the same wording", () => {
    const descriptions = BLOG_CATEGORIES.map((c) => blogCategoryMetaDescription(c));
    assert.equal(new Set(descriptions).size, descriptions.length);
  });

  test("the \"guides\" category's description never reads as \"guides guides\" or otherwise doubles the word", () => {
    const description = blogCategoryMetaDescription("guides");
    assert.doesNotMatch(description, /guides\s+guides/i);
  });

  test("an unrecognised category falls back to the generic blog description rather than throwing or returning undefined/empty", () => {
    assert.equal(
      blogCategoryMetaDescription("not-a-real-category"),
      "Guides, tips and app recommendations from the GetApkFree team.",
    );
  });

  test("each description is already within a normal meta-description length (clampDescription is a no-op on all six)", () => {
    for (const category of BLOG_CATEGORIES) {
      const description = blogCategoryMetaDescription(category);
      assert.equal(clampDescription(description), description);
    }
  });
});

/**
 * Covers the P0-1 GEO finding from the SEO+GEO audit: app pages had no
 * answer-first sentence stating the entity, type, version, size, Android
 * requirement and developer — the facts lived only in a non-prose grid.
 */
group("appSummarySentence", () => {
  function facts(overrides: Partial<AppSummaryFacts> = {}): AppSummaryFacts {
    return {
      name: "LocalSend",
      category: "Internet",
      sourceType: "fdroid",
      version: "1.17.0",
      fileSize: 46_558_706,
      minAndroidVersion: "8.0",
      developer: "LocalSend Team",
      ...overrides,
    };
  }

  test("an F-Droid app with complete data states every fact", () => {
    const sentence = appSummarySentence(facts());
    assert.equal(
      sentence,
      "LocalSend is a free, open-source Android Internet app. The latest version is 1.17.0, it is 44.4 MB, requires Android 8.0+, and is published by LocalSend Team.",
    );
  });

  test("an external app never claims to be open-source", () => {
    const sentence = appSummarySentence(facts({ sourceType: "external" }));
    assert.match(sentence, /^LocalSend is a free Android Internet app\./);
    assert.doesNotMatch(sentence, /open-source/i);
  });

  test("a missing developer omits the developer clause with no dangling 'and'", () => {
    const sentence = appSummarySentence(facts({ developer: null }));
    assert.equal(
      sentence,
      "LocalSend is a free, open-source Android Internet app. The latest version is 1.17.0, it is 44.4 MB, and requires Android 8.0+.",
    );
    assert.doesNotMatch(sentence, /\sand\s*$/i);
    assert.doesNotMatch(sentence, /,,/);
  });

  test("a missing category omits the category word, not a blank or 'null'", () => {
    const sentence = appSummarySentence(facts({ category: null }));
    assert.match(sentence, /^LocalSend is a free, open-source Android app\./);
    assert.doesNotMatch(sentence, /null/i);
    assert.doesNotMatch(sentence, /Android {2}/);
  });

  test("a missing version omits the version clause and does not start the facts sentence with 'it'-less text", () => {
    const sentence = appSummarySentence(facts({ version: null }));
    assert.equal(
      sentence,
      "LocalSend is a free, open-source Android Internet app. It is 44.4 MB, requires Android 8.0+, and is published by LocalSend Team.",
    );
  });

  test("the 'Latest' placeholder version is treated as no version at all", () => {
    const withPlaceholder = appSummarySentence(facts({ version: "Latest" }));
    const withNull = appSummarySentence(facts({ version: null }));
    assert.equal(withPlaceholder, withNull);
    assert.doesNotMatch(withPlaceholder, /is Latest/);
  });

  test("a missing size omits the size clause", () => {
    const sentence = appSummarySentence(facts({ fileSize: null }));
    assert.equal(
      sentence,
      "LocalSend is a free, open-source Android Internet app. The latest version is 1.17.0, requires Android 8.0+, and is published by LocalSend Team.",
    );
  });

  test("a missing minimum Android version omits that clause", () => {
    const sentence = appSummarySentence(facts({ minAndroidVersion: null }));
    assert.equal(
      sentence,
      "LocalSend is a free, open-source Android Internet app. The latest version is 1.17.0, it is 44.4 MB, and is published by LocalSend Team.",
    );
  });

  test("only a developer is known: folds into the first sentence instead of an orphan 'Is published by X.'", () => {
    const sentence = appSummarySentence(
      facts({ version: null, fileSize: null, minAndroidVersion: null }),
    );
    assert.equal(
      sentence,
      "LocalSend is a free, open-source Android Internet app, published by LocalSend Team.",
    );
  });

  test("nothing but the name and category is known: still a single, correctly punctuated sentence", () => {
    const sentence = appSummarySentence(
      facts({
        version: null,
        fileSize: null,
        minAndroidVersion: null,
        developer: null,
      }),
    );
    assert.equal(sentence, "LocalSend is a free, open-source Android Internet app.");
  });

  test("every optional fact missing still produces a clean sentence with no fabricated values", () => {
    const sentence = appSummarySentence({
      name: "Signal",
      category: null,
      sourceType: "external",
      version: null,
      fileSize: null,
      minAndroidVersion: null,
      developer: null,
    });
    assert.equal(sentence, "Signal is a free Android app.");
  });

  test("never produces double commas or a dangling 'and' across every single-clause combination", () => {
    const baseline = facts();
    const clauseKeys: (keyof AppSummaryFacts)[] = [
      "version",
      "fileSize",
      "minAndroidVersion",
      "developer",
    ];

    for (const keep of clauseKeys) {
      const overrides: Partial<AppSummaryFacts> = {};
      for (const key of clauseKeys) {
        if (key !== keep) {
          overrides[key] = null;
        }
      }
      const sentence = appSummarySentence({ ...baseline, ...overrides });
      assert.doesNotMatch(sentence, /,\s*,/, `double comma for ${keep}: ${sentence}`);
      assert.doesNotMatch(sentence, /\band\s*\./i, `dangling 'and' for ${keep}: ${sentence}`);
      assert.doesNotMatch(sentence, /\s{2,}/, `double space for ${keep}: ${sentence}`);
    }
  });
});

/**
 * P2-1's app-page metadata line: "License: X · Target SDK: Y", each half
 * shown only when known, nothing at all when neither is.
 */
group("licenseAndTargetSdkLine", () => {
  test("both present -> both shown, joined with a middle dot", () => {
    assert.equal(
      licenseAndTargetSdkLine("MIT", 34),
      "License: MIT · Target SDK: 34",
    );
  });

  test("license only: target SDK missing -> only the license clause shows", () => {
    assert.equal(licenseAndTargetSdkLine("Apache-2.0", null), "License: Apache-2.0");
  });

  test("target SDK only: license missing -> only the target SDK clause shows", () => {
    assert.equal(licenseAndTargetSdkLine(null, 30), "Target SDK: 30");
  });

  test("neither present -> null, not an empty string or a placeholder", () => {
    assert.equal(licenseAndTargetSdkLine(null, null), null);
    assert.equal(licenseAndTargetSdkLine(undefined, undefined), null);
  });

  test("an empty or whitespace-only license counts as absent", () => {
    assert.equal(licenseAndTargetSdkLine("", 34), "Target SDK: 34");
    assert.equal(licenseAndTargetSdkLine("   ", 34), "Target SDK: 34");
  });

  test("target SDK is shown as the raw numeric API level, never converted to a release name", () => {
    // 34 is Android 14 in the site's own API_TO_RELEASE table — this must
    // never render as "Target SDK: 14.0" or any other release string.
    const line = licenseAndTargetSdkLine(null, 34);
    assert.equal(line, "Target SDK: 34");
    assert.doesNotMatch(line!, /14\.0/);
  });

  test("target SDK of 0 is not a valid value and is treated as absent", () => {
    // targetSdkFromFdroidBuild() never stores 0, but this stays defensive
    // rather than rendering a nonsensical "Target SDK: 0".
    assert.equal(licenseAndTargetSdkLine("MIT", 0), "License: MIT");
  });

  test("surrounding whitespace on a real license value is trimmed in the rendered line", () => {
    assert.equal(licenseAndTargetSdkLine("  MIT  ", null), "License: MIT");
  });
});
