/**
 * Shared logic for backfilling thin F-Droid app descriptions from the current
 * F-Droid index.
 *
 * The catalogue's original bulk import often stored only F-Droid's one-line
 * `summary` (~40-80 chars) as an app's description, because at the time the
 * fuller `localized.description` was either empty or not preferred. This
 * module centralises three things so a generalised backfill script can stay a
 * thin wrapper and be unit-tested without a database or the network:
 *
 *   1. building a clean candidate description from one F-Droid index entry
 *      (`buildFdroidDescriptionCandidate`) — same field precedence the
 *      importer uses (localized en-US -> en -> top level), same HTML strip,
 *      same 400-char sentence-boundary trim, same leading-duplicate-name
 *      cleanup as scripts/backfill-fdroid-descriptions.mjs;
 *   2. deciding whether a given app is "thin" (`isThinDescription`);
 *   3. the full skip/update decision for one app (`planDescriptionBackfill`),
 *      which is where every safety rule lives: F-Droid only, published builds
 *      only, never touch a manual override, never shorten, never swap a clean
 *      one-liner for a barely-longer or prose-less replacement.
 *
 * Nothing here reads or writes anything. The runner script owns the database
 * and the index fetch; it passes plain values in and acts on the decision.
 */

/** Hard ceiling for a stored description — matches the importer's own slice. */
export const MAX_DESCRIPTION_LEN = 400;

/**
 * A description shorter than this (after trimming) counts as "thin" and is a
 * backfill candidate. Chosen from the live catalogue's own length histogram:
 * published F-Droid descriptions cluster tightly at ~40-80 chars (the bare
 * F-Droid summary) or at 200-400 chars (a real paragraph), with almost
 * nothing in between — 120 sits in that empty gap, so the threshold is not
 * sensitive to its exact value. It is also a clean superset of the
 * deprecated one-off script's "<= 40 chars" rule.
 */
export const THIN_DESCRIPTION_MAX_LEN = 120;

/**
 * A replacement must clear the current description by at least this many
 * characters *unless* it carries a genuine extra sentence (see
 * `hasMeaningfulExtraContent`). Keeps a clean one-liner from being churned
 * into a barely-longer reword.
 */
export const MIN_MEANINGFUL_GAIN = 30;

/** The one field name that, when present in apps.manual_fields, freezes the description. */
export const DESCRIPTION_FIELD = "description";

/**
 * Short tokens that end in "." without ending a sentence. Deliberately small
 * and conservative — a token here is *always* rejected as a sentence
 * boundary, so anything ambiguous with a real word (e.g. a lone "no") is left
 * out; the cost of a missed abbreviation is only a slightly earlier, still
 * valid, cut. Stored without the internal dots ("e.g" -> "eg").
 */
const ABBREVIATIONS = new Set([
  "eg", "ie", "etc", "vs", "cf", "al", "approx", "incl", "est",
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vol", "fig", "no",
]);

/**
 * Minimal shape of an F-Droid index-v1 app entry this module reads. Callers
 * pass their real entries through; extra fields are ignored, never required.
 */
export type FdroidIndexApp = {
  name?: string | null;
  summary?: string | null;
  description?: string | null;
  localized?: Record<
    string,
    { name?: string | null; summary?: string | null; description?: string | null } | undefined
  > | null;
};

/** Everything the decision needs about one catalogue row. All plain values — no client, no row object. */
export type BackfillInput = {
  sourceType: string | null;
  hasPublishedBuild: boolean;
  manualFields: readonly string[] | null;
  currentDescription: string | null;
  /** The cleaned upstream candidate, from `buildFdroidDescriptionCandidate`. */
  candidate: string | null;
};

export type BackfillSkipReason =
  | "not-fdroid"
  | "no-published-build"
  | "manual-override"
  | "not-thin"
  | "no-upstream-description"
  | "candidate-lacks-prose"
  | "candidate-not-longer"
  | "candidate-not-meaningfully-longer";

export type BackfillDecision =
  | { action: "update"; reason: "thin-description-upgraded" }
  | { action: "skip"; reason: BackfillSkipReason }
  | { action: "manual-review"; reason: "candidate-lacks-prose" };

// --------------------------------------------------------------- text helpers
// stripHtml / dedupeLeadingName are copied verbatim from
// scripts/backfill-fdroid-descriptions.mjs (which took stripHtml from
// scripts/import-fdroid.mjs). trimToBoundary is the same idea with two added
// safety checks (abbreviations, bracket balance) — see below.

/** Strip HTML tags and named entities, collapse whitespace. Never returns HTML. */
export function stripHtml(html: unknown): string {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True if `(` / `)` and `[` / `]` are balanced and never close before they open. */
function isBracketBalanced(text: string): boolean {
  let round = 0;
  let square = 0;
  for (const ch of text) {
    if (ch === "(") round++;
    else if (ch === ")") round--;
    else if (ch === "[") square++;
    else if (ch === "]") square--;
    if (round < 0 || square < 0) return false;
  }
  return round === 0 && square === 0;
}

/**
 * True when `sentence` (which ends in `.`, `!` or `?`) actually ends on a
 * known abbreviation rather than a sentence — e.g. "…alarms (e.g." or
 * "…see Mr." — so it is not a safe place to cut.
 */
function endsWithAbbreviation(sentence: string): boolean {
  if (!sentence.endsWith(".")) return false; // only "." is ever an abbreviation
  const body = sentence.slice(0, -1);
  const match = body.match(/([A-Za-z](?:\.?[A-Za-z])*)$/); // trailing alpha token, may carry internal dots
  if (!match) return false;
  const token = match[1].replace(/\./g, "").toLowerCase();
  if (ABBREVIATIONS.has(token)) return true;
  if (match[1].length === 1) return true; // a lone initial: "…named A."
  return false;
}

/**
 * Prefer cutting a too-long candidate at a sentence end, then a word
 * boundary, then (only for pathological no-space text) a hard slice.
 *
 * On top of the original scan-from-the-end behaviour, a sentence boundary is
 * rejected — and the scan falls back to the previous one — when it would:
 *   - end on a known abbreviation ("e.g.", "i.e.", "Mr.", a lone initial, …), or
 *   - leave unbalanced `()` or `[]` in the kept text.
 * The word-boundary fallback also skips cuts that leave unbalanced brackets.
 * Never exceeds `max`; never turns non-empty input into an empty string.
 */
export function trimToBoundary(text: string, max: number = MAX_DESCRIPTION_LEN): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;

  const window = clean.slice(0, max);

  // Every sentence-boundary position in the window, then tried latest-first.
  const stops: number[] = [];
  const re = /[.!?] /g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(window))) stops.push(m.index);

  for (let i = stops.length - 1; i >= 0; i--) {
    const kept = window.slice(0, stops[i] + 1).trim();
    if (!kept) continue;
    if (endsWithAbbreviation(kept)) continue;
    if (!isBracketBalanced(kept)) continue;
    return kept;
  }

  for (let cut = window.lastIndexOf(" "); cut > 0; cut = window.lastIndexOf(" ", cut - 1)) {
    const kept = window.slice(0, cut).trim();
    if (kept && isBracketBalanced(kept)) return kept;
  }

  return window.trim();
}

/**
 * Some F-Droid entries open with the app's own name used as a heading,
 * immediately followed by the real sentence that also starts with the name
 * ("Arcade Arcade is a minimal...", "🌠 Diadem Diadem is a..."). Strip only
 * that leading duplicate — anchored at the very start, so a legitimate later
 * mention of the name is never touched — and leave the text alone otherwise.
 */
export function dedupeLeadingName(text: string, appName: string): string {
  const name = appName.trim();
  if (!text || !name) return text;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^[^A-Za-z0-9]*${escaped}\\s+(${escaped}\\b.*)$`, "i");
  const match = text.match(pattern);
  return match ? match[1].trim() : text;
}

// --------------------------------------------------------- candidate builder

/**
 * Build a clean candidate description from one F-Droid index entry, or null
 * if the entry has no usable text.
 *
 * Field precedence matches scripts/import-fdroid.mjs: the `en-US` localized
 * block, then `en`, then the entry's top-level fields. Within that, the fuller
 * `description` wins over the one-line `summary` when it genuinely says more;
 * otherwise `summary` is kept as the fallback rather than dropped. The result
 * is HTML-stripped, leading-name-deduplicated, and trimmed to 400 chars at a
 * safe sentence boundary.
 */
export function buildFdroidDescriptionCandidate(app: FdroidIndexApp): string | null {
  const localized = app.localized?.["en-US"] ?? app.localized?.["en"] ?? {};
  const appName = (localized.name || app.name || "").trim();

  const rawSummary = stripHtml((localized.summary || app.summary || "").toString().trim());
  const rawDescription = stripHtml(
    (localized.description || app.description || "").toString().trim(),
  );

  const summary = trimToBoundary(dedupeLeadingName(rawSummary, appName), MAX_DESCRIPTION_LEN);
  const description = trimToBoundary(
    dedupeLeadingName(rawDescription, appName),
    MAX_DESCRIPTION_LEN,
  );

  const chosen = description.length > summary.length ? description : summary;
  return chosen || null;
}

// ------------------------------------------------------------------- helpers

/** True when a stored description is missing or below the thin threshold. */
export function isThinDescription(description: string | null | undefined): boolean {
  return (description ?? "").trim().length < THIN_DESCRIPTION_MAX_LEN;
}

/** True when apps.manual_fields marks the description as a human override. */
export function hasManualDescription(manualFields: readonly string[] | null | undefined): boolean {
  return (manualFields ?? []).includes(DESCRIPTION_FIELD);
}

/**
 * True when `text` opens with list/heading content and no real prose sentence
 * before the first list marker — a flattened F-Droid feature dump like
 * "Features - 100% offline - No ads …" or "FEATURES: …" or "- Item one - …".
 * Such a candidate reads worse than a clean one-liner even when it is longer,
 * so it is routed to manual review rather than written automatically.
 */
export function lacksProseLeadIn(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // Opens directly with a bullet / dash-list item.
  if (/^[-*•▪●‣·]\s/.test(t)) return true;

  // Opens with a heading label ("Features:", "Key Features -", "Features & Perks —").
  if (/^(key\s+)?(features?|perks?|highlights?|what'?s\s+new)\b[^.!?]{0,40}?[:\-–—]/i.test(t)) {
    return true;
  }

  // A heading label, or *two or more* list markers, appear before the first
  // sentence-ending mark. Two markers, not one, so a lone " - " used as an
  // aside inside a normal sentence ("track spending - and set limits") is not
  // mistaken for a list.
  const firstStop = t.search(/[.!?](\s|$)/);
  const head = firstStop === -1 ? t : t.slice(0, firstStop);
  if (/(^|\s)(key\s+)?(features?|perks?|highlights?)\b[^.!?]{0,40}?[:\-–—]/i.test(head)) return true;
  const markers = head.match(/(^|\s)[-*•▪●‣·]\s/g);
  if (markers && markers.length >= 2) return true;

  return false;
}

/**
 * Rough count of real sentence breaks: a terminator followed by whitespace
 * and a capital/digit/quote (an internal break), plus one for a terminator at
 * the very end. Used only to let a genuinely useful short extra sentence
 * through the marginal-gain gate.
 */
function realSentenceBreaks(text: string): number {
  const internal = text.match(/[.!?]["')\]]?\s+["'"'(]?[A-Z0-9]/g);
  const trailing = /[.!?]["')\]]?\s*$/.test(text.trim()) ? 1 : 0;
  return (internal ? internal.length : 0) + trailing;
}

/**
 * True when the candidate adds real content over the current description:
 *
 *   - if the current description is barely there (< 20 chars) any real prose
 *     candidate wins — there is no clean one-liner to protect;
 *   - otherwise the candidate must either clear the current by
 *     `MIN_MEANINGFUL_GAIN` characters, or carry at least two real sentence
 *     breaks, so a short but genuinely fuller paragraph ("X is a Y. It also
 *     does Z.") is not rejected just for being < 30 chars longer.
 *
 * The caller has already checked the candidate is strictly longer.
 */
export function hasMeaningfulExtraContent(current: string, candidate: string): boolean {
  const currentLen = current.trim().length;
  if (currentLen < 20) return true;

  const gain = candidate.trim().length - currentLen;
  if (gain >= MIN_MEANINGFUL_GAIN) return true;
  return realSentenceBreaks(candidate) >= 2;
}

// ----------------------------------------------------------- the decision

/**
 * The complete decision for one catalogue row. Pure: every guard the backfill
 * relies on is here, in a fixed order so the `reason` is deterministic.
 *
 *   1. not an F-Droid listing          -> never touch external apps
 *   2. no published build              -> no-build pages are noindexed anyway
 *   3. description is a manual override -> frozen by project contract
 *   4. current description isn't thin  -> not in scope; avoid churn
 *   5. no usable upstream text         -> nothing to write
 *   6. candidate is a prose-less list  -> manual-review, not an auto write
 *   7. candidate not strictly longer   -> never shorten or reword sideways
 *   8. candidate barely longer         -> keep the clean one-liner
 */
export function planDescriptionBackfill(input: BackfillInput): BackfillDecision {
  if (input.sourceType !== "fdroid") return { action: "skip", reason: "not-fdroid" };
  if (!input.hasPublishedBuild) return { action: "skip", reason: "no-published-build" };
  if (hasManualDescription(input.manualFields)) {
    return { action: "skip", reason: "manual-override" };
  }
  if (!isThinDescription(input.currentDescription)) {
    return { action: "skip", reason: "not-thin" };
  }

  const candidate = (input.candidate ?? "").trim();
  if (!candidate) return { action: "skip", reason: "no-upstream-description" };

  if (lacksProseLeadIn(candidate)) {
    return { action: "manual-review", reason: "candidate-lacks-prose" };
  }

  const current = (input.currentDescription ?? "").trim();
  if (candidate.length <= current.length) {
    return { action: "skip", reason: "candidate-not-longer" };
  }
  if (!hasMeaningfulExtraContent(current, candidate)) {
    return { action: "skip", reason: "candidate-not-meaningfully-longer" };
  }

  return { action: "update", reason: "thin-description-upgraded" };
}
