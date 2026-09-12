import assert from "node:assert/strict";
import { describe as group, test } from "node:test";
import { HOW_TO_INSTALL_FAQ_PAIRS } from "./how-to-install-faq.ts";

/**
 * P2-4: the FAQPage markup on /how-to-install is built from this constant
 * rather than from a live parse of the JSX (that section's copy is fixed,
 * hand-transcribed prose, not a markdown source like a blog post). These
 * tests pin that the transcription stays valid, non-duplicated, and — via
 * the exact-text checks — actually matches the wording currently rendered
 * in app/how-to-install/page.tsx's "What the safety badges mean" section.
 */
group("HOW_TO_INSTALL_FAQ_PAIRS", () => {
  test("has exactly the three badge explanations, once each", () => {
    assert.equal(HOW_TO_INSTALL_FAQ_PAIRS.length, 3);
  });

  test("every question is phrased as a question", () => {
    for (const { question } of HOW_TO_INSTALL_FAQ_PAIRS) {
      assert.ok(question.trim().endsWith("?"), `not a question: "${question}"`);
    }
  });

  test("every answer is non-empty", () => {
    for (const { answer } of HOW_TO_INSTALL_FAQ_PAIRS) {
      assert.ok(answer.trim().length > 0);
    }
  });

  test("no duplicate questions", () => {
    const questions = HOW_TO_INSTALL_FAQ_PAIRS.map((p) => p.question);
    assert.equal(new Set(questions).size, questions.length);
  });

  test("covers clean, pending and flagged, matching the visible badge wording", () => {
    const byQuestion = new Map(
      HOW_TO_INSTALL_FAQ_PAIRS.map((p) => [p.question, p.answer]),
    );
    assert.equal(
      byQuestion.get("What does the “Scanned” badge mean?"),
      "No engine flagged this build. The date shown is when it was checked. Only these appear on the site.",
    );
    assert.equal(
      byQuestion.get("What does the “Pending scan” badge mean?"),
      "No verdict yet — usually a build too new to have been analysed. Held back until it clears.",
    );
    assert.equal(
      byQuestion.get("What does the “Flagged” badge mean?"),
      "At least one engine reported something. Never published; kept only for review.",
    );
  });
});
