import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import {
  contentFromCandidate,
  resolvePlayLink,
  verifyResolvedPlayUrl,
  type GithubCandidateContent,
  type MetadataFetcher,
} from "./github-play-resolution.ts";
import type { FetchedMetadata } from "./fetchers.ts";

/**
 * Run with: npm test — every test here is a pure function call over plain
 * strings, or (for verifyResolvedPlayUrl) an injected fake fetcher. No
 * network call, no Supabase call, no real Play/GitHub request anywhere in
 * this file.
 */

function content(overrides: Partial<GithubCandidateContent> = {}): GithubCandidateContent {
  return {
    repository_url: "https://github.com/someone/cool-app",
    homepage_url: null,
    description: null,
    readme_excerpt: null,
    ...overrides,
  };
}

group("resolvePlayLink — direct Play URL", () => {
  test("a bare Play URL in the README resolves", () => {
    const result = resolvePlayLink(content({ readme_excerpt: "https://play.google.com/store/apps/details?id=com.example.app" }));
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.link.package_name, "com.example.app");
      assert.equal(result.link.play_url, "https://play.google.com/store/apps/details?id=com.example.app");
    }
  });
});

group("resolvePlayLink — markdown link", () => {
  test("a markdown-style link resolves, without capturing the surrounding syntax", () => {
    const result = resolvePlayLink(
      content({ readme_excerpt: "[Get it on Google Play](https://play.google.com/store/apps/details?id=com.example.app)" }),
    );
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.link.package_name, "com.example.app");
      assert.equal(result.link.confidence, "high");
    }
  });
});

group("resolvePlayLink — HTML link", () => {
  test("an HTML anchor resolves, without capturing the closing quote/tag", () => {
    const result = resolvePlayLink(
      content({ readme_excerpt: '<a href="https://play.google.com/store/apps/details?id=com.example.app">Google Play</a>' }),
    );
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") assert.equal(result.link.package_name, "com.example.app");
  });
});

group("resolvePlayLink — punctuation around the URL", () => {
  test("trailing period/comma/parenthesis is trimmed off", () => {
    for (const wrapped of [
      "See it here: https://play.google.com/store/apps/details?id=com.example.app.",
      "(https://play.google.com/store/apps/details?id=com.example.app)",
      "https://play.google.com/store/apps/details?id=com.example.app, thanks!",
    ]) {
      const result = resolvePlayLink(content({ readme_excerpt: wrapped }));
      assert.equal(result.status, "resolved", `expected resolved for: ${wrapped}`);
      if (result.status === "resolved") assert.equal(result.link.package_name, "com.example.app");
    }
  });
});

group("resolvePlayLink — invalid package id", () => {
  test("a details URL with no ?id= param is reported as invalid_play_link, not silently dropped", () => {
    const result = resolvePlayLink(content({ readme_excerpt: "https://play.google.com/store/apps/details?hl=en" }));
    assert.equal(result.status, "invalid_play_link");
    if (result.status === "invalid_play_link") assert.equal(result.rawMatches.length, 1);
  });
});

group("resolvePlayLink — generic Play Store URL", () => {
  test("a bare play.google.com homepage (no /store/apps/details) is no_play_link, never mistaken for an app link", () => {
    const result = resolvePlayLink(content({ readme_excerpt: "Check out https://play.google.com for more apps." }));
    assert.equal(result.status, "no_play_link");
  });

  test("the generic /store front page is also no_play_link", () => {
    const result = resolvePlayLink(content({ readme_excerpt: "Browse https://play.google.com/store" }));
    assert.equal(result.status, "no_play_link");
  });
});

group("resolvePlayLink — no Play link", () => {
  test("no play.google.com text anywhere returns no_play_link", () => {
    const result = resolvePlayLink(content({ description: "A CLI tool.", readme_excerpt: "Install with npm i cool-app." }));
    assert.equal(result.status, "no_play_link");
  });

  test("all-null content returns no_play_link", () => {
    assert.equal(resolvePlayLink(content()).status, "no_play_link");
  });
});

group("resolvePlayLink — multiple Play links, same app", () => {
  test("the same package mentioned twice still resolves to one link, not ambiguous", () => {
    const result = resolvePlayLink(
      content({
        homepage_url: "https://play.google.com/store/apps/details?id=com.example.app",
        readme_excerpt: "Also available: https://play.google.com/store/apps/details?id=com.example.app",
      }),
    );
    assert.equal(result.status, "resolved");
  });
});

group("resolvePlayLink — multiple Play links, different apps: ambiguous", () => {
  test("two distinct packages produce an ambiguous result with both candidates, never an arbitrary pick", () => {
    const result = resolvePlayLink(
      content({
        readme_excerpt:
          "Inspired by https://play.google.com/store/apps/details?id=com.other.app — get ours at https://play.google.com/store/apps/details?id=com.example.app",
      }),
    );
    assert.equal(result.status, "ambiguous");
    if (result.status === "ambiguous") {
      assert.equal(result.candidates.length, 2);
      const packages = result.candidates.map((c) => c.package_name).sort();
      assert.deepEqual(packages, ["com.example.app", "com.other.app"]);
    }
  });
});

group("resolvePlayLink — unrelated Play link (low confidence, no trust phrase nearby)", () => {
  test("a link with no supporting context is still resolved but marked low confidence, with a reason", () => {
    const result = resolvePlayLink(
      content({ readme_excerpt: "See also the changelog. https://play.google.com/store/apps/details?id=com.unrelated.app end of file." }),
    );
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.link.confidence, "low");
      assert.match(result.link.reason, /no supporting context/);
    }
  });

  test("a link near 'Google Play' text is high confidence", () => {
    const result = resolvePlayLink(content({ readme_excerpt: "Get it on Google Play: https://play.google.com/store/apps/details?id=com.example.app" }));
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") assert.equal(result.link.confidence, "high");
  });
});

group("resolvePlayLink — ambiguous links carry confidence/reason for each candidate", () => {
  test("every candidate in an ambiguous result has its own confidence and reason", () => {
    const result = resolvePlayLink(
      content({
        readme_excerpt:
          "Download on Google Play: https://play.google.com/store/apps/details?id=com.example.app. Similar to https://play.google.com/store/apps/details?id=com.other.app.",
      }),
    );
    assert.equal(result.status, "ambiguous");
    if (result.status === "ambiguous") {
      for (const c of result.candidates) {
        assert.ok(typeof c.confidence === "string");
        assert.ok(typeof c.reason === "string" && c.reason.length > 0);
      }
      // The one found near "Download"/"Google Play" ranks first.
      assert.equal(result.candidates[0].package_name, "com.example.app");
      assert.equal(result.candidates[0].confidence, "high");
    }
  });
});

group("resolvePlayLink — parsePlayUrl integration", () => {
  test("a non-play.google.com host is never matched at all (the loose pattern itself requires the real host)", () => {
    const result = resolvePlayLink(content({ readme_excerpt: "https://evil.com/store/apps/details?id=com.example.app" }));
    assert.equal(result.status, "no_play_link");
  });

  test("www.play.google.com is tolerated, matching parsePlayUrl's own www-stripping", () => {
    const result = resolvePlayLink(content({ readme_excerpt: "https://www.play.google.com/store/apps/details?id=com.example.app" }));
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") assert.equal(result.link.package_name, "com.example.app");
  });
});

group("resolvePlayLink — deterministic ranking", () => {
  test("running the same input twice produces the identical result and ordering", () => {
    const input = content({
      homepage_url: "https://play.google.com/store/apps/details?id=com.example.app",
      readme_excerpt: "Also see https://play.google.com/store/apps/details?id=com.other.app",
    });
    const a = resolvePlayLink(input);
    const b = resolvePlayLink(input);
    assert.deepEqual(a, b);
  });

  test("homepage-sourced link outranks a readme-sourced one for the same input shape, deterministically", () => {
    const input = content({
      homepage_url: "https://play.google.com/store/apps/details?id=com.homepage.app",
      readme_excerpt: "Mentioned: https://play.google.com/store/apps/details?id=com.readme.app",
    });
    const result = resolvePlayLink(input);
    assert.equal(result.status, "ambiguous");
    if (result.status === "ambiguous") {
      assert.equal(result.candidates[0].package_name, "com.homepage.app");
      assert.equal(result.candidates[0].source, "homepage");
    }
  });
});

group("resolvePlayLink — no arbitrary external fetches from the pure extractor", () => {
  test("resolvePlayLink never touches globalThis.fetch", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    // @ts-expect-error -- intentionally stubbing for the duration of this test
    globalThis.fetch = async () => {
      called = true;
      throw new Error("resolvePlayLink must never call fetch");
    };
    try {
      resolvePlayLink(content({ readme_excerpt: "https://play.google.com/store/apps/details?id=com.example.app" }));
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

group("contentFromCandidate", () => {
  test("picks exactly the four fields this module reads, nothing more", () => {
    const candidate = {
      repository_url: "https://github.com/a/b",
      homepage_url: "https://play.google.com/store/apps/details?id=com.a.b",
      description: "desc",
      readme_excerpt: "readme",
      // Extra fields a real GithubDiscoveryCandidate carries, deliberately
      // included to confirm they are NOT copied through.
      stars: 100,
      source: "github" as const,
    };
    const mapped = contentFromCandidate(candidate);
    assert.deepEqual(mapped, {
      repository_url: "https://github.com/a/b",
      homepage_url: "https://play.google.com/store/apps/details?id=com.a.b",
      description: "desc",
      readme_excerpt: "readme",
    });
  });
});

/* ------------------------------------------------------- Play verification */

group("verifyResolvedPlayUrl — a separate layer, never invoked by resolvePlayLink", () => {
  test("calls the injected fetcher with exactly the given URL and returns its result", async () => {
    const fetched: FetchedMetadata = {
      name: "Example",
      packageName: "com.example.app",
      description: null,
      iconUrl: null,
      developer: null,
      category: null,
      version: null,
      rating: 4.5,
      ratingCount: 100,
      screenshots: [],
      source: "play",
      unavailable: [],
    };
    let calledWith: string | null = null;
    const fetchMetadataFn: MetadataFetcher = async (url) => {
      calledWith = url;
      return fetched;
    };
    const result = await verifyResolvedPlayUrl(fetchMetadataFn, "https://play.google.com/store/apps/details?id=com.example.app");
    assert.equal(calledWith, "https://play.google.com/store/apps/details?id=com.example.app");
    assert.deepEqual(result, fetched);
  });

  test("resolvePlayLink itself never calls any fetcher — it is a pure function with no async work at all", () => {
    // resolvePlayLink's return type is not a Promise; this is a
    // compile-time guarantee as much as a runtime one.
    const result = resolvePlayLink(content({ readme_excerpt: "https://play.google.com/store/apps/details?id=com.example.app" }));
    assert.equal(result instanceof Promise, false);
  });
});
