/**
 * Whether the third-party scripts described in the privacy policy are actually
 * running.
 *
 * The policy reads off these flags rather than hard-coding claims, so it can
 * never describe collection that is not happening. Both are inert until the
 * corresponding env var is set in Vercel.
 */

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "";
export const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "";

export const analyticsEnabled = GA_ID.length > 0;
export const adsEnabled = ADSENSE_CLIENT.length > 0;

/** Where privacy and abuse reports go. */
export const CONTACT_EMAIL = "himupaul148@gmail.com";

/**
 * Shown as "Last updated" on the legal pages. Bumped by hand when the wording
 * changes — deriving it from a build date would make every deploy look like a
 * policy revision.
 */
export const LEGAL_LAST_UPDATED = "2026-08-27";
