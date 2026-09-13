/**
 * Step 4 of the Daily New-App Discovery system: connects a verified GitHub
 * discovery candidate to the existing, unmodified Play proposal system.
 *
 * This module decides nothing about what a proposal should contain, and
 * duplicates none of that logic — classifyProposal()/buildProposalRow()
 * (lib/metadata/play-proposals.ts) and proposeForPackage()
 * (lib/metadata/play-proposal-store.ts) are called exactly as every other
 * caller already calls them. This module only adds the "which candidate,
 * and what does its lifecycle status become" layer on top, exactly the
 * way lib/metadata/play-watchlist-runner.ts adds "which packages" on top
 * of the same propose pipeline without changing it.
 *
 * The three layers stay separate, per the discovery audit's own design:
 *   DISCOVERY           — already done before this module runs (github-discovery.ts).
 *   METADATA VERIFICATION — step 5 below, the existing fetchMetadata()/fromPlay().
 *   PUBLIC LISTING       — step 13 below, the existing proposeForPackage() —
 *                          which, for a Play-sourced new_app, only ever
 *                          creates a metadata-only, zero-version pending
 *                          proposal. Nothing in this module approves,
 *                          rejects, applies, or publishes anything.
 */
import { classifyProposal, type CurrentAppRow } from "./play-proposals.ts";
import { resolvePlayLink, type GithubCandidateContent } from "./github-play-resolution.ts";
import type { MetadataFetcher } from "./github-play-resolution.ts";
import type { FetchedMetadata } from "./fetchers.ts";
import type { ProposeOutcome } from "./play-proposal-store.ts";
import type { DiscoveryCandidatePatch, DiscoveryCandidateStatus } from "./play-discovery-store.ts";

/**
 * A candidate is never reprocessed once it has reached one of these —
 * exactly the four terminal states the task specifies. Note "verified"
 * and "error" are deliberately NOT terminal: a transient failure or an
 * intermediate verified-but-not-yet-classified row can always be picked
 * up again by a later run.
 */
export const TERMINAL_DISCOVERY_STATUSES: readonly DiscoveryCandidateStatus[] = [
  "proposed",
  "disqualified_exists",
  "disqualified_no_play_link",
  "disqualified_low_quality",
];

export type DiscoveryPipelineDeps = {
  /** METADATA VERIFICATION — the existing fetchMetadata() dispatcher (which itself calls fromPlay() for a play.google.com URL), injected so this module never imports the real network fetcher directly. */
  fetchMetadata: MetadataFetcher;
  /** Reads `apps` by package_name — the existing findCurrentApp() (lib/metadata/play-proposal-store.ts), injected. */
  findCurrentApp: (packageName: string) => Promise<CurrentAppRow | null>;
  /** Duplicate protection — the existing findAnyProposalForPackage() (lib/metadata/play-proposal-store.ts), injected. Checks ANY status, not just pending, so an already-rejected proposal is never silently recreated. */
  findExistingProposal: (packageName: string) => Promise<{ id: string; status: string } | null>;
  /** PUBLIC LISTING creation — the existing, unmodified proposeForPackage() (lib/metadata/play-proposal-store.ts), injected. */
  proposeForPackage: (input: {
    fetched: FetchedMetadata;
    packageName: string;
    playUrl: string;
  }) => Promise<ProposeOutcome>;
  /** Persistence for play_discovery_candidates — the existing updateDiscoveryCandidate() (lib/metadata/play-discovery-store.ts), injected. The ONLY other write destination besides proposeForPackage()'s own table. */
  updateDiscoveryCandidate: (id: string, patch: DiscoveryCandidatePatch) => Promise<void>;
  now: Date;
};

export type DiscoveryCandidateRef = { id: string; status: DiscoveryCandidateStatus };

export type ProcessDiscoveryCandidateResult =
  | { outcome: "skipped_terminal"; status: DiscoveryCandidateStatus }
  | { outcome: "disqualified_no_play_link" }
  | { outcome: "error"; reason: string }
  | { outcome: "disqualified_exists"; reason: string }
  | { outcome: "proposed"; proposalId: string; packageName: string; playUrl: string };

/**
 * Processes exactly one discovery candidate. Every write this function
 * performs goes through one of the two injected store functions
 * (updateDiscoveryCandidate, proposeForPackage) — never a direct
 * Supabase call of its own, and never anything touching `apps`,
 * `versions`, or Storage.
 */
export async function processDiscoveryCandidate(
  candidate: DiscoveryCandidateRef,
  content: GithubCandidateContent,
  deps: DiscoveryPipelineDeps,
): Promise<ProcessDiscoveryCandidateResult> {
  // Step 1: terminal candidates are never reprocessed — not even a read
  // beyond the status already passed in.
  if (TERMINAL_DISCOVERY_STATUSES.includes(candidate.status)) {
    return { outcome: "skipped_terminal", status: candidate.status };
  }

  const checkedAt = deps.now.toISOString();

  // Steps 2-4: EXTRACTION — the existing, pure resolvePlayLink(). Never
  // makes a network request; only searches content already fetched by
  // the discovery step.
  const resolution = resolvePlayLink(content);

  if (resolution.status === "no_play_link") {
    await deps.updateDiscoveryCandidate(candidate.id, { status: "disqualified_no_play_link", checked_at: checkedAt });
    return { outcome: "disqualified_no_play_link" };
  }

  if (resolution.status === "invalid_play_link") {
    await deps.updateDiscoveryCandidate(candidate.id, { status: "error", checked_at: checkedAt });
    return { outcome: "error", reason: `invalid Play link(s) found: ${resolution.rawMatches.join(", ")}` };
  }

  if (resolution.status === "ambiguous") {
    // Never chosen arbitrarily — reported as an error with every
    // candidate's package name preserved in the returned reason for
    // later inspection. play_discovery_candidates itself has no free-text
    // detail column beyond package_name/resolved_play_url, and neither is
    // set here (setting either would mean picking one of several
    // possible apps), so the full context lives in this function's
    // return value for the caller to log.
    await deps.updateDiscoveryCandidate(candidate.id, { status: "error", checked_at: checkedAt });
    const packages = resolution.candidates.map((c) => `${c.package_name} (${c.confidence})`).join(", ");
    return { outcome: "error", reason: `ambiguous Play links, not choosing arbitrarily: ${packages}` };
  }

  // resolution.status === "resolved"
  const { play_url: playUrl, package_name: packageName } = resolution.link;

  // Step 5: METADATA VERIFICATION — the existing fetchMetadata()/fromPlay().
  let fetched: FetchedMetadata;
  try {
    fetched = await deps.fetchMetadata(playUrl);
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    // The resolved URL/package are still recorded — verification failing
    // is a fact about *this run*, not evidence the resolution itself was
    // wrong, so there is no reason to discard it.
    await deps.updateDiscoveryCandidate(candidate.id, {
      status: "error",
      resolved_play_url: playUrl,
      package_name: packageName,
      checked_at: checkedAt,
    });
    return { outcome: "error", reason: `Play verification failed: ${reason}` };
  }

  // An intermediate checkpoint — persisted before the classification/
  // duplicate checks below run, so a crash between here and the final
  // proposed/disqualified_exists write still leaves an inspectable,
  // non-terminal row (see TERMINAL_DISCOVERY_STATUSES: 'verified' is
  // deliberately not terminal, so such a row can be picked up again).
  await deps.updateDiscoveryCandidate(candidate.id, {
    status: "verified",
    resolved_play_url: playUrl,
    package_name: packageName,
    checked_at: checkedAt,
  });

  // Steps 7-8: the existing findCurrentApp() + classifyProposal() —
  // neither modified, neither duplicated.
  const currentApp = await deps.findCurrentApp(packageName);
  const classification = classifyProposal(fetched, currentApp, playUrl);

  // Steps 9-11: only a genuine new_app classification may proceed. This
  // covers BOTH "the package already exists" (classification.kind is
  // 'metadata_update' or 'unchanged') AND "the existing app is
  // F-Droid-owned" (classification.kind is 'ineligible') — discovery's
  // whole purpose is finding apps that are not yet in the catalogue at
  // all, so any of these three outcomes means there is nothing new here.
  if (classification.kind !== "new_app") {
    await deps.updateDiscoveryCandidate(candidate.id, { status: "disqualified_exists", checked_at: checkedAt });
    const reason =
      classification.kind === "ineligible" ? classification.reason : "package already exists in the catalogue";
    return { outcome: "disqualified_exists", reason };
  }

  // Duplicate protection: has a new_app proposal ever existed for this
  // package — pending, applied, rejected, expired, or superseded? An
  // admin's earlier rejection must never be silently resurfaced just
  // because the same GitHub repo was discovered again.
  const existingProposal = await deps.findExistingProposal(packageName);
  if (existingProposal) {
    await deps.updateDiscoveryCandidate(candidate.id, { status: "disqualified_exists", checked_at: checkedAt });
    return {
      outcome: "disqualified_exists",
      reason: `a new_app proposal for this package already exists (status: ${existingProposal.status})`,
    };
  }

  // Steps 12-13: PUBLIC LISTING creation — the existing, unmodified
  // proposeForPackage(), which itself calls buildProposalRow() and
  // insertProposal() internally. Never reimplemented here.
  const outcome = await deps.proposeForPackage({ fetched, packageName, playUrl });

  if (outcome.status !== "new_app") {
    // proposeForPackage() is itself race-safe and re-classifies against
    // live state; if something changed between our own checks above and
    // this call (a concurrent run, an app created in the meantime), its
    // real outcome is reflected here rather than assumed.
    await deps.updateDiscoveryCandidate(candidate.id, { status: "disqualified_exists", checked_at: checkedAt });
    return {
      outcome: "disqualified_exists",
      reason: `proposeForPackage() returned "${outcome.status}" instead of "new_app" — likely a concurrent change`,
    };
  }

  // Step 14: success.
  await deps.updateDiscoveryCandidate(candidate.id, {
    status: "proposed",
    resolved_play_url: playUrl,
    package_name: packageName,
    proposal_id: outcome.proposalId,
    checked_at: checkedAt,
  });

  return { outcome: "proposed", proposalId: outcome.proposalId, packageName, playUrl };
}
