/**
 * Read-only lookup: does an approved app have a GitHub repository behind
 * it? There is no column on `apps` for this — the link only exists as a
 * reverse join through the tables the Play discovery pipeline already
 * writes (see the read-only audit this module implements):
 *
 *   apps.package_name
 *     -> play_import_proposals (proposal_type='new_app', status='applied')
 *     -> play_discovery_candidates.proposal_id (source='github')
 *     -> play_discovery_candidates.source_ref ("owner/repo")
 *
 * This module never writes anything and never calls the GitHub API itself
 * — it only answers "what repository, if any, is this app's approval
 * traceable back to". A package with no applied new_app proposal, no
 * matching discovery candidate, or a candidate from a non-GitHub source all
 * resolve to `null` — a normal "no GitHub source available" outcome, never
 * an error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// GitHub's own username/repo-name rules: an owner is 1-39 chars, alphanumeric
// or hyphen, never starting/ending with a hyphen; a repo name is 1-100 chars
// of alphanumeric, dot, hyphen, or underscore. Checked before this value is
// ever interpolated into a GitHub API URL.
const OWNER_REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;

/** True only for a plausible "owner/repo" string — never trusts source_ref's format blindly. */
export function isValidOwnerRepo(ref: string): boolean {
  return OWNER_REPO_PATTERN.test(ref);
}

/**
 * Resolves the GitHub "owner/repo" an approved app's `new_app` proposal
 * traces back to, or `null` if none exists (no proposal, no candidate, a
 * non-GitHub source, or a malformed source_ref — every one of these is a
 * normal absence, not an error).
 */
export async function resolveAppGithubSource(
  supabase: SupabaseClient,
  packageName: string,
): Promise<string | null> {
  const { data: proposal, error: proposalError } = await supabase
    .from("play_import_proposals")
    .select("id")
    .eq("package_name", packageName)
    .eq("proposal_type", "new_app")
    .eq("status", "applied")
    .order("applied_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (proposalError) throw proposalError;
  if (!proposal) return null;

  const { data: candidate, error: candidateError } = await supabase
    .from("play_discovery_candidates")
    .select("source_ref")
    .eq("proposal_id", proposal.id)
    .eq("source", "github")
    .limit(1)
    .maybeSingle<{ source_ref: string }>();
  if (candidateError) throw candidateError;
  if (!candidate?.source_ref) return null;

  return isValidOwnerRepo(candidate.source_ref) ? candidate.source_ref : null;
}
