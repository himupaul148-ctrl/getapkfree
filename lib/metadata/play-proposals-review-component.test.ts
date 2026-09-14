import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe as group, test } from "node:test";

/**
 * Phase 4e: components/admin/PlayProposalsReview.tsx is a "use client"
 * component — this project's plain `node --test` runner has no JSX
 * transform and no bundler, so it can't be imported directly (the same
 * constraint documented in lib/screenshot-gallery.test.ts for
 * ScreenshotGallery.tsx). These are therefore static, source-level
 * assertions against the component's actual text; the real decision logic
 * it delegates to (response interpretation, formatting, filtering) is
 * exercised directly and behaviorally in lib/metadata/play-proposals-ui.test.ts.
 */

const componentSrc = readFileSync(
  fileURLToPath(new URL("../../components/admin/PlayProposalsReview.tsx", import.meta.url)),
  "utf8",
);

group("PlayProposalsReview — writes only ever go through the existing API routes", () => {
  test("approve posts to the exact existing route, with no body at all", () => {
    assert.match(
      componentSrc,
      /postAction\(`\/api\/admin\/play-proposals\/\$\{proposal\.id\}\/approve`\)/,
    );
  });

  test("reject posts to the exact existing route, sending only a reason (or nothing)", () => {
    assert.match(
      componentSrc,
      /postAction\(\s*`\/api\/admin\/play-proposals\/\$\{proposal\.id\}\/reject`,\s*trimmed \? \{ reason: trimmed \} : undefined,/,
    );
  });

  test("no proposal field data (proposedFields/previousFields) is ever included in a request body", () => {
    // The only two request bodies constructed anywhere in this file.
    const bodies = [...componentSrc.matchAll(/postAction\([^)]*\)/gs)].map((m) => m[0]);
    for (const call of bodies) {
      assert.doesNotMatch(call, /proposedFields/);
      assert.doesNotMatch(call, /previousFields/);
    }
  });

  test("never imports or references a Supabase client, service-role key, or direct table write", () => {
    assert.doesNotMatch(componentSrc, /createClient/);
    assert.doesNotMatch(componentSrc, /service_role/i);
    assert.doesNotMatch(componentSrc, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(componentSrc, /\.from\(["']play_import_proposals["']\)/);
    assert.doesNotMatch(componentSrc, /\.from\(["']apps["']\)/);
    assert.doesNotMatch(componentSrc, /\.from\(["']versions["']\)/);
  });

  test("the only network calls in this file are POSTs through fetch() inside postAction", () => {
    const fetchCalls = componentSrc.match(/fetch\(/g) ?? [];
    assert.equal(fetchCalls.length, 1); // exactly the one inside postAction()
  });
});

group("PlayProposalsReview — approve/reject require explicit confirmation first", () => {
  test("clicking Approve opens the confirm modal rather than calling runApprove directly", () => {
    const newAppApprove = componentSrc.match(
      /onApprove=\{\(\) => setConfirmAction\(\{ proposal, action: "approve" \}\)\}/g,
    );
    assert.ok(newAppApprove && newAppApprove.length >= 1);
    // runApprove is only ever invoked from inside the confirm modal's onConfirm.
    const runApproveCallSites = [...componentSrc.matchAll(/runApprove\(/g)];
    // One for the function definition (`async function runApprove(`) and
    // exactly one real call site (inside the modal's onConfirm).
    assert.equal(runApproveCallSites.length, 2);
  });

  test("clicking Reject opens the confirm modal rather than calling runReject directly", () => {
    const rejectOpens = componentSrc.match(
      /onReject=\{\(\) => setConfirmAction\(\{ proposal, action: "reject" \}\)\}/g,
    );
    assert.ok(rejectOpens && rejectOpens.length >= 1);
    const runRejectCallSites = [...componentSrc.matchAll(/runReject\(/g)];
    assert.equal(runRejectCallSites.length, 2);
  });

  test("the approve confirmation message for a new_app proposal matches the required wording", () => {
    assert.match(
      componentSrc,
      /Approve this Play metadata draft\? This will create a metadata-only app record\. No version or download will be created\./,
    );
  });

  test("the approve confirmation message for a metadata_update proposal matches the required wording", () => {
    assert.match(
      componentSrc,
      /Approve these metadata changes\? Current values will be rechecked before applying\./,
    );
  });

  test("the reject confirmation offers an optional reason field", () => {
    assert.match(componentSrc, /Reason \(optional\)/);
  });
});

group("PlayProposalsReview — new_app disclosure requirements", () => {
  test("shows the required 'metadata-only draft' notice verbatim", () => {
    assert.match(componentSrc, /Metadata-only draft — no APK or version exists yet\./);
  });

  test("shows the required 'does NOT create a download' notice verbatim", () => {
    assert.match(componentSrc, /Approving this proposal does NOT create a download or APK\./);
  });
});

group("PlayProposalsReview — metadata_update diff rendering", () => {
  test("renders each changed field as a from -> to pair using the shared formatter", () => {
    assert.match(componentSrc, /formatFieldValue\(field, proposal\.previousFields\?\.\[field\]\)/);
    assert.match(componentSrc, /formatFieldValue\(field, proposal\.proposedFields\[field\]\)/);
    // The visible arrow between old and new values.
    assert.match(componentSrc, />\s*→\s*</);
  });

  test("manually protected fields are shown but explicitly marked as not changing", () => {
    assert.match(componentSrc, /Manually protected — will NOT change/);
  });
});

group("PlayProposalsReview — filters", () => {
  test("exposes exactly the three required filter options: all, new_app, metadata_update", () => {
    assert.match(componentSrc, /<option value="all">/);
    assert.match(componentSrc, /<option value="new_app">/);
    assert.match(componentSrc, /<option value="metadata_update">/);
    // No fourth option exists (kept simple, per Phase 4e's own scope).
    const optionCount = (componentSrc.match(/<option value=/g) ?? []).length;
    assert.equal(optionCount, 3);
  });
});

group("PlayProposalsReview — success/removal behavior", () => {
  test("a successful outcome removes the proposal from the local list without a full page reload", () => {
    assert.match(componentSrc, /if \(outcome\.removeFromList\) removeProposal\(proposal\.id\)/g);
    // No router.refresh()/window.location reload anywhere in this file.
    assert.doesNotMatch(componentSrc, /router\.refresh/);
    assert.doesNotMatch(componentSrc, /window\.location\.reload/);
  });
});

group("app/admin/layout.tsx — Play Proposals tab", () => {
  const layoutSrc = readFileSync(
    fileURLToPath(new URL("../../app/admin/layout.tsx", import.meta.url)),
    "utf8",
  );

  test("adds exactly one new tab, pointing at /admin/play-proposals, without removing any existing tab", () => {
    assert.match(layoutSrc, /\{ href: "\/admin\/play-proposals", label: "Play Proposals" \}/);
    for (const existing of ["/admin", "/admin/upload", "/admin/add-external-app", "/admin/import-apk-url", "/admin/apps", "/admin/blog"]) {
      assert.match(layoutSrc, new RegExp(`href: "${existing.replace(/\//g, "\\/")}"`));
    }
  });

  test("the admin-only isAdmin() redirect guard is still present and unmodified in shape", () => {
    assert.match(layoutSrc, /if \(!\(await isAdmin\(\)\)\) redirect\("\/"\);/);
  });
});

/* ============================================================
 * "Recently approved (GitHub-discovered)" section — added on top of the
 * existing pending queue above. Every assertion in the groups above this
 * point is untouched by this addition; these new groups prove the new
 * section is purely additive and never interferes with the existing
 * pending-queue behavior already covered above.
 * ============================================================ */

group("PlayProposalsReview — the approved section is separate from, and never mixed into, the pending queue", () => {
  test("accepts approvedCards as its own prop, defaulting to an empty array", () => {
    assert.match(componentSrc, /approvedCards\s*=\s*\[\]/);
  });

  test("the approved section is gated on approvedCards.length, hidden entirely when empty (never an empty-state message)", () => {
    assert.match(componentSrc, /\{approvedCards\.length > 0 && \(/);
  });

  test("renders the required section heading", () => {
    assert.match(componentSrc, /Recently approved \(GitHub-discovered\)/);
  });

  test("renders one ApprovedProposalEnrichmentStatus per card, imported from its own file", () => {
    assert.match(
      componentSrc,
      /import ApprovedProposalEnrichmentStatus, \{\s*type ApprovedProposalEnrichmentCardData,?\s*\} from "@\/components\/admin\/ApprovedProposalEnrichmentStatus";/,
    );
    assert.match(componentSrc, /approvedCards\.map\(\(card\) => /);
    assert.match(componentSrc, /<ApprovedProposalEnrichmentStatus card=\{card\} \/>/);
  });

  test("approvedCards never appears inside filterProposals(), the pending count, or the type filter — it is not part of that state", () => {
    assert.doesNotMatch(componentSrc, /filterProposals\(approvedCards/);
    assert.doesNotMatch(componentSrc, /newAppCount.*approvedCards/);
  });

  test("removeProposal is never called with anything from an approved card", () => {
    const removeProposalCalls = [...componentSrc.matchAll(/removeProposal\(([^)]*)\)/g)].map((m) => m[1]);
    for (const arg of removeProposalCalls) assert.doesNotMatch(arg, /card/);
  });
});

group("PlayProposalsReview — no Approve/Reject controls anywhere near the approved section", () => {
  test("the approved section's own JSX block contains no onApprove/onReject/ActionButtons/ConfirmModal reference", () => {
    const start = componentSrc.indexOf("{approvedCards.length > 0 && (");
    assert.ok(start > -1);
    const afterStart = componentSrc.slice(start);
    // The block ends at the next top-level `{confirmAction &&` (the existing,
    // separate modal for the PENDING queue's own actions) — not part of the
    // approved section itself.
    const end = afterStart.indexOf("{confirmAction &&");
    assert.ok(end > -1);
    const approvedBlock = afterStart.slice(0, end);

    assert.doesNotMatch(approvedBlock, /onApprove/);
    assert.doesNotMatch(approvedBlock, /onReject/);
    assert.doesNotMatch(approvedBlock, /ActionButtons/);
    assert.doesNotMatch(approvedBlock, /setConfirmAction/);
  });
});
