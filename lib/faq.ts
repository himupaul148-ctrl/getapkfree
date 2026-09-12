/**
 * Extracts genuine, already-visible FAQ question/answer pairs straight from a
 * blog post's own Markdown source — the same string `renderMarkdown()` turns
 * into the visible article. There is deliberately no second, independently
 * editable FAQ data source (no frontmatter field, no new syntax): whatever
 * this returns is only ever a structured read of text a reader can already
 * see, so FAQPage JSON-LD built from it can never describe content that
 * isn't on the page, and can never drift from what the page shows.
 *
 * Recognises exactly the convention every current post already uses inside a
 * bounded "## Frequently Asked Questions" section — a `**Question?**` line
 * followed by its answer:
 *
 *   ## Frequently Asked Questions
 *
 *   **Are APK permissions dangerous?**
 *   Not inherently. A permission is only meaningful in context.
 *
 * Fails closed throughout: anything that does not cleanly match this shape
 * is left out rather than guessed at, so a post with no FAQ section, or one
 * written in some other style, simply yields no pairs instead of a wrong or
 * partial one.
 */

export type FaqPair = { question: string; answer: string };

/** An unvalidated question/answer pair, before sanitizeFaqPairs checks it. */
export type FaqCandidate = { question: string; answer: string };

/** Matched case-insensitively as the *entire* heading text, not a substring. */
const FAQ_HEADING_NAMES = new Set([
  "frequently asked questions",
  "faq",
  "faqs",
  "common questions",
]);

/** A level-2 heading line ("## Title"), never a level-3+ one ("### Title"). */
const H2_LINE = /^##(?!#)\s*(.*?)\s*$/;

/** A line that, in full, is a bold span and nothing else: "**...**". */
const BOLD_LINE = /^\*\*(.+)\*\*$/;

function findFaqSectionLines(lines: string[]): string[] | null {
  let headingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = H2_LINE.exec(lines[i]);
    if (match && FAQ_HEADING_NAMES.has(match[1].trim().toLowerCase())) {
      headingIndex = i;
      break;
    }
  }
  if (headingIndex === -1) return null;

  let end = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (H2_LINE.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(headingIndex + 1, end);
}

/**
 * Markdown -> plain text, for one answer. Deliberately narrower than
 * lib/markdown.ts's excerpt(): excerpt() strips every `-` character
 * indiscriminately, which would corrupt ordinary prose an FAQ answer might
 * contain ("F-Droid", "open-source"). This only unwraps the specific
 * markdown constructs answers actually use — links, emphasis, inline code —
 * and leaves every other character, including hyphens and punctuation,
 * untouched.
 */
function normalizeAnswerText(raw: string): string {
  return raw
    // [text](url) -> text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // **bold** / __bold__ -> bold (before single */_, so it isn't matched first)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // *italic* / _italic_ -> italic
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // `code` -> code
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validates and dedupes a list of already-assembled question/answer
 * candidates, regardless of where they came from. Fails closed: a candidate
 * whose question is not phrased as a question, or whose answer is empty
 * once trimmed, is dropped rather than guessed at. A later duplicate of an
 * already-seen question (by exact text) is dropped, not merged — the first
 * occurrence wins.
 *
 * This is the one place that decides what counts as a valid FAQ pair;
 * extractFaqPairs below uses it for markdown-sourced candidates, and any
 * other page assembling its own candidates from visible JSX content (e.g.
 * app/how-to-install/page.tsx's safety-badge FAQ) should use it too, rather
 * than re-implementing this validation.
 */
export function sanitizeFaqPairs(candidates: FaqCandidate[]): FaqPair[] {
  const pairs: FaqPair[] = [];
  const seenQuestions = new Set<string>();

  for (const { question: rawQuestion, answer: rawAnswer } of candidates) {
    const question = rawQuestion.trim();
    const answer = normalizeAnswerText(rawAnswer);
    if (question.length === 0 || !question.endsWith("?")) continue;
    if (answer.length === 0) continue;
    if (seenQuestions.has(question)) continue;

    pairs.push({ question, answer });
    seenQuestions.add(question);
  }

  return pairs;
}

export function extractFaqPairs(markdown: string): FaqPair[] {
  if (!markdown?.trim()) return [];

  const sectionLines = findFaqSectionLines(markdown.split(/\r?\n/));
  if (!sectionLines) return [];

  const candidates: FaqCandidate[] = [];

  let currentQuestion: string | null = null;
  let currentAnswerLines: string[] = [];

  function commitCurrentCandidate(): void {
    if (currentQuestion !== null) {
      candidates.push({
        question: currentQuestion,
        answer: currentAnswerLines.join(" "),
      });
    }
    currentQuestion = null;
    currentAnswerLines = [];
  }

  for (const rawLine of sectionLines) {
    const line = rawLine.trim();

    if (line === "") {
      // Blank lines are allowed between a question and its answer — they do
      // not end the answer, they are just not part of it.
      continue;
    }

    const boldMatch = BOLD_LINE.exec(line);
    if (boldMatch) {
      const candidate = boldMatch[1].trim();
      if (candidate.endsWith("?")) {
        // A new valid question — finalize whatever answer was accumulating.
        commitCurrentCandidate();
        currentQuestion = candidate;
        continue;
      }
      // A bold line that is not phrased as a question never becomes a
      // question. If an answer is currently being collected, its bold
      // markup is just inline emphasis within that answer's prose; if no
      // question is open yet, it has nothing to attach to and is ignored.
    }

    if (currentQuestion !== null) {
      currentAnswerLines.push(line);
    }
  }
  commitCurrentCandidate();

  return sanitizeFaqPairs(candidates);
}
