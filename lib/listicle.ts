/**
 * Extracts the ordered, curated app list from a "best open-source X apps"
 * listicle's own Markdown source — the same string the article body and its
 * Comparison Table are both rendered from. As with lib/faq.ts, there is
 * deliberately no second, independently editable source (no frontmatter
 * field, no related_app_ids lookup): whatever this returns is only ever a
 * structured read of links a reader already sees in the article, in the
 * order they already see them, so ItemList JSON-LD built from it can never
 * describe a list the page doesn't actually show.
 *
 * Recognises exactly the convention all five current listicles use — a
 * level-3 heading that is nothing but a link to an app page:
 *
 *   ### [1Key Password Manager](/app/1key-password-manager)
 *
 * collected from the top of the document up to (not including) the first
 * "## Comparison Table" heading, verified during the P1-2 audit to be the
 * exact, consistent boundary every current listicle uses between its
 * ten-app list and the rest of the article (FAQ, "How to Choose", etc., none
 * of which ever contain this heading shape). A post with no such boundary
 * falls back to scanning the whole document — safe because no current
 * listicle links an app anywhere outside its main list, verified directly
 * against every published post during the audit.
 *
 * Fails closed: a post with none of these headings (i.e. not one of the
 * curated listicles) simply yields [] rather than guessing at a list.
 */

export type ListicleItem = { name: string; slug: string };

/** A level-3 heading that is, in full, a link to an app page. */
const APP_H3_LINE = /^###\s*\[(.+?)\]\(\/app\/([a-z0-9-]+)\)\s*$/;

/** A level-2 heading line ("## Title"), never a level-3+ one ("### Title"). */
const H2_LINE = /^##(?!#)\s*(.*?)\s*$/;

const COMPARISON_TABLE_HEADING = "Comparison Table";

function boundToBeforeComparisonTable(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    const match = H2_LINE.exec(lines[i]);
    if (match && match[1] === COMPARISON_TABLE_HEADING) {
      return lines.slice(0, i);
    }
  }
  // No "## Comparison Table" boundary — fall back to the whole document,
  // which every current listicle has verified to be safe (no app is linked
  // anywhere outside its own main list).
  return lines;
}

export function extractListicleItems(markdown: string): ListicleItem[] {
  if (!markdown?.trim()) return [];

  const lines = boundToBeforeComparisonTable(markdown.split(/\r?\n/));

  const items: ListicleItem[] = [];
  const seenSlugs = new Set<string>();

  for (const line of lines) {
    const match = APP_H3_LINE.exec(line.trim());
    if (!match) continue;

    const name = match[1].trim();
    const slug = match[2].trim();
    if (name.length === 0 || slug.length === 0) continue;
    if (seenSlugs.has(slug)) continue;

    items.push({ name, slug });
    seenSlugs.add(slug);
  }

  return items;
}
