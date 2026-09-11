import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { appDescriptionSuffix, appSummarySentence, type AppSummaryFacts } from "./seo.ts";

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
