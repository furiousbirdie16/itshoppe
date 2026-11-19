import type { PriceSource } from "@/lib/price-source";

/** Your own dealer list is the one uploaded under an "IT Shoppe" brand; every other brand is an outside supplier. */
export const isOwnList = (brand: string | null | undefined) => /it\s*shoppe/i.test(brand ?? "");

/** A price list product's prices, as a line needs them. */
export interface ListPrices {
  brand: string;
  bottom: number | null;
  srp: number | null;
  sdp: number | null;
}

const pos = (v: number | null | undefined): number | null => (typeof v === "number" && v > 0 ? v : null);

/**
 * The price a new invoice or quotation line starts at, and where it came from:
 *
 * 1. The customer's previous price for it (not for walk-ins: they share one
 *    customer record, so "previous" would be a stranger's price).
 * 2. On your own list: Bottom, or SRP for a walk-in.
 *    On a supplier's list: Bottom if it has one, otherwise SDP (you add the
 *    markup by hand). Walk-ins the same.
 * 3. The item's standard selling price, for items on no price list.
 *
 * Null when none of those has a price: the line stays blank.
 */
export function resolveStartPrice(opts: {
  walkIn: boolean;
  previous: number | null | undefined;
  list: ListPrices | null | undefined;
  standard: number | null | undefined;
}): { price: number; source: PriceSource } | null {
  const { walkIn, list } = opts;
  const previous = pos(opts.previous);
  if (!walkIn && previous != null) return { price: previous, source: "previous" };
  if (list) {
    const bottom = pos(list.bottom);
    const srp = pos(list.srp);
    const sdp = pos(list.sdp);
    const order: [number | null, PriceSource][] = isOwnList(list.brand)
      ? walkIn
        ? [[srp, "list:srp"], [bottom, "list:bottom"]]
        : [[bottom, "list:bottom"], [srp, "list:srp"]]
      : [[bottom, "list:bottom"], [sdp, "list:sdp"]];
    for (const [price, source] of order) if (price != null) return { price, source };
  }
  const standard = pos(opts.standard);
  return standard != null ? { price: standard, source: "standard" } : null;
}
