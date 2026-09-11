import { CATEGORIES } from "./types.ts";

/**
 * Editorial copy for category browse views (`/?category=X`), kept apart from
 * lib/seo.ts's generic SEO helpers because this is prose tied to the catalogue's
 * eight fixed categories, not a reusable formatting function.
 */
export type Category = (typeof CATEGORIES)[number];

/**
 * One 2-3 sentence, answer-first introduction per category, shown above the
 * catalogue grid on that category's browse view.
 *
 * Deliberately avoids claims that do not hold for every app in the category
 * (e.g. "no account required", "works fully offline", "no ads or extra
 * permissions") — the catalogue mixes fully local tools with apps that need a
 * network connection by design (messengers, proxies, RSS readers), so a
 * blanket claim here would be false for some fraction of the category.
 */
export const CATEGORY_INTRO: Record<Category, string> = {
  Games:
    "Free, open-source Android games spanning puzzle, logic, strategy, card, and other game styles. Browse the catalogue to find games with published, versioned APK builds and visible app details.",
  Productivity:
    "Free, open-source Android apps for tasks such as planning, tracking, notes, habits, expenses, and time management. Browse productivity tools with versioned APK builds and published app information.",
  Multimedia:
    "Free, open-source Android apps for playing, recording, creating, and managing audio, video, and images. The catalogue includes media players, recording tools, editors, and related multimedia utilities.",
  Internet:
    "Free, open-source Android apps for messaging, browsing, networking, and connecting to online services. The catalogue includes privacy-focused communication tools, clients, and other networking applications.",
  System:
    "Free, open-source Android apps for system management, privacy, security, authentication, encryption, and device control. For a curated selection of security-focused apps, see our privacy and security apps guide.",
  Tools:
    "Free, open-source Android utilities for focused everyday tasks, including file operations, device tools, converters, remote controls, and other specialised helpers. Browse the catalogue by the specific function you need.",
  Education:
    "Free, open-source Android apps for learning, study, reference, science, languages, and other educational uses. Browse the catalogue for specialised learning and reference tools.",
  Writing:
    "Free, open-source Android apps for notes, text editing, outlining, and other writing workflows. The catalogue includes tools built around plain text, Markdown, structured notes, and related writing tasks.",
};

/**
 * Reverse link from a category view to its matching "best open-source X"
 * listicle, for the categories where one has actually been verified to match
 * — every app that listicle links is in that exact app.category, confirmed
 * against the live catalogue during the P0-2 audit. Tools, Education, and
 * Writing have no entry: no published post's linked apps concentrate in any
 * one of those three, so no mapping exists rather than guessing one.
 *
 * System's listicle is titled "privacy & security", not "System" — the post
 * itself already links `/?category=System`, and every app it names is
 * categorised System in the catalogue, so the anchor text below says what the
 * guide actually covers rather than repeating the category name.
 */
export const CATEGORY_LISTICLE: Partial<
  Record<Category, { slug: string; anchorText: string }>
> = {
  Games: {
    slug: "best-open-source-games-android",
    anchorText: "Read our guide to the best open-source Games apps for Android",
  },
  Productivity: {
    slug: "best-open-source-productivity-apps-android",
    anchorText:
      "Read our guide to the best open-source Productivity apps for Android",
  },
  Multimedia: {
    slug: "best-open-source-multimedia-apps-android",
    anchorText:
      "Read our guide to the best open-source Multimedia apps for Android",
  },
  Internet: {
    slug: "best-open-source-internet-networking-apps-android",
    anchorText:
      "Read our guide to the best open-source Internet & networking apps for Android",
  },
  System: {
    slug: "best-open-source-privacy-security-apps-android",
    anchorText:
      "Read our guide to the best open-source privacy and security apps for Android",
  },
};

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);

/**
 * `normaliseCategory()` (lib/filters.ts) already only ever returns a real
 * category or "", but its return type is plain `string` — this narrows that
 * back to `Category` so the maps above can be indexed safely wherever a
 * page only has the normalised string on hand, e.g. an empty/unfiltered view.
 */
export function isCategory(value: string): value is Category {
  return CATEGORY_SET.has(value);
}

/** The intro for a normalised category string, or null outside the 8 categories (including ""). */
export function categoryIntro(category: string): string | null {
  return isCategory(category) ? CATEGORY_INTRO[category] : null;
}

/** The listicle mapping for a normalised category string, or null when none exists. */
export function categoryListicle(
  category: string,
): { slug: string; anchorText: string } | null {
  return isCategory(category) ? CATEGORY_LISTICLE[category] ?? null : null;
}
