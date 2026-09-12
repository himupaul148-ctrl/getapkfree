import { sanitizeFaqPairs, type FaqCandidate, type FaqPair } from "./faq.ts";

/**
 * FAQPage content for /how-to-install's "What the safety badges mean"
 * section. Each answer here is a literal transcription of the wording
 * already rendered next to that badge in app/how-to-install/page.tsx — kept
 * as a separate constant rather than derived from the JSX, so that section
 * can stay exactly as written. If that wording changes, this must be
 * updated to match, or the two will drift.
 *
 * Questions are not written on the page verbatim as questions; each one is
 * a direct rephrasing of the page's own "What the safety badges mean"
 * heading for one specific, already-visible badge label ("Scanned",
 * "Pending scan", "Flagged" — see components/ScanBadge.tsx), not an
 * invented topic.
 */
const BADGE_FAQ_CANDIDATES: FaqCandidate[] = [
  {
    question: "What does the “Scanned” badge mean?",
    answer:
      "No engine flagged this build. The date shown is when it was checked. Only these appear on the site.",
  },
  {
    question: "What does the “Pending scan” badge mean?",
    answer:
      "No verdict yet — usually a build too new to have been analysed. Held back until it clears.",
  },
  {
    question: "What does the “Flagged” badge mean?",
    answer:
      "At least one engine reported something. Never published; kept only for review.",
  },
];

/**
 * Passed through the same fail-closed validation blog-post FAQs use (see
 * lib/faq.ts's sanitizeFaqPairs): if a candidate above were ever left with
 * an empty answer or a question not phrased as one, it is dropped rather
 * than rendered as structured data that doesn't match anything on the page.
 */
export const HOW_TO_INSTALL_FAQ_PAIRS: FaqPair[] = sanitizeFaqPairs(BADGE_FAQ_CANDIDATES);
