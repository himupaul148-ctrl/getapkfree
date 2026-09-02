/**
 * Remembers how many catalogue cards were on screen, so going back to a list
 * restores what you were looking at rather than resetting to the first page.
 *
 * Why this needs to exist when native scroll restoration already works: the
 * browser restores the *offset* faithfully, but the content that justified it
 * is gone. Measured before this was added — load three pages, scroll to
 * 3000px, open an app, press back: scroll came back as 3000, the list came
 * back as 24 cards. You land past the end of a list that is now much shorter.
 *
 * Deliberately small. It stores one integer, not scroll positions or DOM
 * measurements — the browser is better at those and is already doing them.
 *
 * sessionStorage rather than the URL: `?shown=96` is noise in a link someone
 * shares, and writing it would turn every "Show more" into a router call.
 * Rather than localStorage because this is per-tab, throwaway state that
 * should not outlive the tab that created it.
 */

const KEY = "getapkfree:catalogue-visible";

/** Every read and write is guarded — private mode can throw on access. */
export function readVisible(fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return fallback;
    const value = Number(raw);
    // A stored count below the page size means a stale or hand-edited value.
    return Number.isFinite(value) && value >= fallback ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeVisible(value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, String(value));
  } catch {
    /* storage is unavailable; the list simply starts from the first page */
  }
}

/**
 * Called when the filters change. A new result set makes the old count
 * meaningless — restoring 96 into a filter that matches 12 would show every
 * match and hide the "Show more" button, which reads as a broken filter.
 */
export function clearVisible(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
