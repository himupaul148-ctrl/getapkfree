/**
 * Schema.org's `license` property on SoftwareApplication expects a URL (or a
 * CreativeWork), never a bare string — so a stored SPDX identifier
 * ("MIT", "Apache-2.0", "GPL-3.0-only") needs converting to a real URL
 * before it can go into AppJsonLd. SPDX's own per-license reference page at
 * https://spdx.org/licenses/{id}.html is the canonical target.
 *
 * Fails closed rather than guessing: a genuine SPDX short-form identifier is
 * one token of letters, digits, '.', '+' and '-' (every value P2-1's audit
 * found in the live catalogue matches this exactly). Rejecting anything
 * containing whitespace also rejects a compound SPDX license EXPRESSION
 * ("MIT OR Apache-2.0", "GPL-2.0-only WITH Classpath-exception-2.0") — those
 * always contain spaces around their operators — since a compound
 * expression has no single canonical page to link to. GetApkFree's own
 * F-Droid-sourced data has never contained one, but this does not assume it
 * never will.
 */
const VALID_SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/** Null for anything empty, whitespace-containing, or otherwise not a single safe SPDX-shaped token. */
export function spdxLicenseUrl(license: string | null | undefined): string | null {
  const id = (license ?? "").trim();
  if (!id || !VALID_SPDX_ID.test(id)) return null;
  return `https://spdx.org/licenses/${encodeURIComponent(id)}.html`;
}
