/**
 * Turns an admin-curated input file's raw text into the list of lines
 * import-play-metadata.mjs should actually try to process — blank lines and
 * `#`-prefixed comment lines dropped, everything else trimmed.
 */
export function parseInputLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
