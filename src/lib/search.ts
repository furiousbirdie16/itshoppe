/**
 * The one search rule every search box uses.
 *
 * What is typed is split into words, and a record matches when it contains
 * every word, in any order, in any of its fields: "HDMI 1.5m" finds
 * "HDMI cable 1.5m", which an exact-text search could not, because "cable"
 * sits between the two. Case, accents and punctuation do not matter, a space
 * between a number and its unit does not either ("1.5 m" is "1.5m"), and a
 * word also matches across a gap or hyphen ("rj45" finds "RJ-45").
 */

/** Lower case, no accents, punctuation as spaces, "1.5 m" as "1.5m". */
export function normalizeSearch(text: unknown): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Keep a decimal point only between digits; everything else that is not
    // a letter or digit separates words.
    .replace(/(\d)\.(\d)/g, "$1\u0000$2")
    .replace(/[^a-z0-9\u0000]+/g, " ")
    .replace(/\u0000/g, ".")
    // A number followed by a short unit is one word.
    .replace(/(\d)\s+(mm|cm|m|km|g|kg|ml|l|v|w|a|ah|mah|gb|tb|mb|mp|ft|in|pcs|pc|awg)\b/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchWords(query: string): string[] {
  const n = normalizeSearch(query);
  return n ? n.split(" ") : [];
}

/** Whether every word of the query appears somewhere in the fields. An empty query matches all. */
export function searchMatches(query: string, ...fields: unknown[]): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const hay = normalizeSearch(fields.filter((f) => f != null && f !== "").join(" "));
  const joined = hay.replace(/ /g, "");
  return words.every((w) => hay.includes(w) || joined.includes(w));
}

/**
 * How well a record matches, lower first: the SKU exactly, the name exactly,
 * the SKU or name starting with what was typed, a name starting with the
 * first word typed, every word in the name, then matches found only in other
 * fields. Ties go to the shorter name — the closer fit.
 */
export function searchRank(query: string, name: unknown, sku?: unknown): number {
  const q = normalizeSearch(query);
  if (!q) return 0;
  const n = normalizeSearch(name);
  const s = normalizeSearch(sku);
  const tie = Math.min(n.length, 999) / 1000;
  if (s && s === q) return 0;
  if (n === q) return 1;
  if (s && s.startsWith(q)) return 2 + tie;
  if (n.startsWith(q)) return 3 + tie;
  if (searchMatches(query, name)) return (n.startsWith(searchWords(query)[0]) ? 4 : 5) + tie;
  return 6 + tie;
}
