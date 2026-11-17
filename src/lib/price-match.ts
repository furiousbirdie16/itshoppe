/**
 * Suggesting which inventory item a price list product is.
 *
 * Your office list says "80x50mm junction box" where Inventory says
 * "Junction Box 80x50", and "DATA CABINET 4U w/ shelf Width: 530mm Height:
 * 240mm Depth :400mm" where Inventory says "Data Cabinet 4U 530x240x400".
 * Names are broken into words; sizes and numbers count for most, because
 * they are what tell one junction box or cable from the next. A suggestion
 * is only a suggestion: you confirm or change it on the Inventory links
 * screen. Tuned on your own price list against your own inventory.
 */

const STOP = new Set([
  "with", "w", "and", "for", "the", "a", "of", "in", "pcs", "pc", "per", "box", "set", "unit", "units", "type", "new",
  "sold", "pair", "pack", "hxw", "wxh", "size", "only", "x",
]);

// Words that mean the same thing written differently.
const SAME: Record<string, string> = {
  meters: "m", meter: "m", mtrs: "m", mtr: "m",
  volts: "v", volt: "v", amps: "a", amp: "a",
  splitters: "splitter", connectors: "connector", cables: "cable", brackets: "bracket", clamps: "clamp", ties: "tie",
  whtie: "white", cliup: "clip",
  "4k2k": "4k",
};

const UNIT = "mm|cm|m|meters?|v|a|w|u|awg|ft|inch|in|ports?|ch|mp|tb|gb|mah|k";

/** A name as comparable words. Sizes keep their numbers together: "80x50x30". */
export function nameTokens(name: string): string[] {
  let t = ` ${name} `.toLowerCase().replace(/[×*]/g, "x");
  // "Width: 530mm Height: 240mm Depth :400mm" → "530x240x400"
  t = t.replace(/width\s*:?\s*(\d+(?:\.\d+)?)\s*mm.*?height\s*:?\s*(\d+(?:\.\d+)?)\s*mm.*?depth\s*:?\s*(\d+(?:\.\d+)?)\s*mm/g, " $1x$2x$3 ");
  // "(per pack 100 pcs)", "200 pcs": a pack size, not the product's size.
  t = t.replace(/\d+\s*pcs\b/g, " ");
  // "80 x 50 mm" → "80x50mm"
  t = t.replace(/(\d)\s*x\s*(?=\d)/g, "$1x");
  // "305 m", "12 v", "6 u", "24 ports" → "305m", "12v", "6u", "24ports"
  t = t.replace(new RegExp(`(\\d+(?:\\.\\d+)?)\\s+(${UNIT})\\b`, "g"), "$1$2");
  // "8+2+1SFP" → "8 2 1 sfp"
  t = t.replace(/[^a-z0-9.x]+/g, " ");
  const out: string[] = [];
  for (let w of t.split(" ")) {
    w = w.replace(/^\.+|\.+$/g, "");
    if (!w) continue;
    // A number stuck to a word that isn't a unit: "1sfp" → "1", "sfp".
    const stuck = w.match(/^(\d+(?:\.\d+)?)([a-z]{3,})$/);
    if (stuck && !new RegExp(`^(${UNIT})$`).test(stuck[2])) {
      out.push(stuck[1], stuck[2]);
      continue;
    }
    if (STOP.has(w)) continue;
    // A size drops its unit and its order: "80x50mm" = "50x80", and a
    // cabinet's W×H×D is written in either order.
    if (/^\d+(\.\d+)?(x\d+(\.\d+)?)+(mm|cm|m)?$/.test(w)) {
      w = w.replace(/(mm|cm|m)$/, "").split("x").map(Number).sort((p, q) => p - q).join("x");
    }
    w = w.replace(/^(\d+(?:\.\d+)?)(meters?|mtrs?)$/, "$1m").replace(/^(\d+)ports?$/, "$1port");
    out.push(SAME[w] ?? w);
  }
  return [...new Set(out)];
}

const hasDigit = (w: string) => /\d/.test(w);
const weight = (w: string) => (hasDigit(w) ? 3 : 1);
// What kind of number a word is ("12v" → "v", "80x50" → "x"), so a 12V and
// a 24V adaptor clash while a 12V and a 2A one don't.
const numKind = (w: string) => (w.includes("x") && /^\d/.test(w) ? "x" : w.replace(/^[\d.]+/, "") || "#");

/**
 * How alike a product and an inventory item are, 0 to 1.
 *
 * Mostly: how much of the inventory name the product covers (inventory names
 * are short, price list names long). Then: a size or rating that clashes (a
 * 30x30 tray against a 50x50 one, 4U against 6U) cuts the score hard, and so
 * does a word your inventory uses to tell items apart ("circle", "outdoor",
 * a colour) that the item lacks.
 */
function scoreTokens(ta: string[], tb: Set<string>, vocab: Set<string>): number {
  if (ta.length === 0 || tb.size === 0) return 0;
  const sa = new Set(ta);
  let shared = 0;
  let wa = 0;
  let wb = 0;
  for (const w of sa) {
    wa += weight(w);
    if (tb.has(w)) shared += weight(w);
  }
  for (const w of tb) wb += weight(w);
  if (shared === 0) return 0;
  let score = 0.65 * (shared / wb) + 0.35 * (shared / wa);
  // The item has a size the product doesn't: a different product.
  const productKinds = new Set(ta.filter(hasDigit).map(numKind));
  for (const w of tb) if (hasDigit(w) && !sa.has(w) && productKinds.has(numKind(w))) score *= 0.4;
  for (const w of tb) if (hasDigit(w) && !sa.has(w) && !productKinds.has(numKind(w))) score *= 0.8;
  // The product has a telling word the item lacks.
  for (const w of sa) if (!hasDigit(w) && !tb.has(w) && vocab.has(w)) score *= 0.7;
  return Math.round(score * 100) / 100;
}

export function nameScore(a: string, b: string): number {
  const tb = new Set(nameTokens(b));
  return scoreTokens(nameTokens(a), tb, tb);
}

export interface MatchCandidate<T> {
  item: T;
  score: number;
}

/**
 * Prepares the inventory once, then finds the best few items for any
 * product, best first. Both the item's name and its SKU are tried.
 */
export function makeMatcher<T extends { name: string; sku?: string | null }>(items: T[]) {
  const prepared = items.map((item) => ({
    item,
    name: new Set(nameTokens(item.name)),
    sku: item.sku && item.sku !== item.name ? new Set(nameTokens(item.sku)) : null,
  }));
  // Words your inventory uses: missing one of these matters, missing "shelf"
  // from a long price list description doesn't.
  const vocab = new Set(prepared.flatMap((p) => [...p.name]));
  return (product: string, limit = 3): MatchCandidate<T>[] => {
    const ta = nameTokens(product);
    return prepared
      .map((p) => ({ item: p.item, score: Math.max(scoreTokens(ta, p.name, vocab), p.sku ? scoreTokens(ta, p.sku, vocab) : 0) }))
      .filter((c) => c.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, limit);
  };
}

export function bestMatches<T extends { name: string; sku?: string | null }>(product: string, items: T[], limit = 3): MatchCandidate<T>[] {
  return makeMatcher(items)(product, limit);
}

/**
 * How sure a suggestion is: "high" ones can be confirmed in one go. A best
 * guess barely ahead of the next one ("HDMI 30M": the 30m cable or the 30m
 * extender?) is never "high", however good its score.
 */
export function confidence(score: number, runnerUp = 0): "high" | "medium" | "low" {
  if (score >= 0.7 && score - runnerUp >= 0.1) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}
