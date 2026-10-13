/**
 * The price each item was last ordered at from overseas.
 *
 * A reorder is nearly always placed at the price the last one was, so typing
 * it again is work the app can do. Kept apart from the query so the rules —
 * which order counts as last, what to do with an unpriced line — can be
 * checked without a database.
 */

export interface OverseasCostRow {
  item_id: string | null;
  unit_cost: number | null;
  order_date: string | null;
  currency: string | null;
  po_number: string | null;
}

export interface LastCost {
  unitCost: number;
  orderDate: string;
  poNumber: string;
}

/** Key for the map: a cost in RMB means nothing against an order in USD. */
export const lastOverseasCostKey = (itemId: string, currency: string) => `${itemId}::${currency}`;

export function pickLastOverseasCosts(rows: OverseasCostRow[]): Record<string, LastCost> {
  const out: Record<string, LastCost> = {};
  for (const r of rows) {
    if (!r.item_id || !r.order_date || !r.currency) continue;
    const cost = Number(r.unit_cost || 0);
    // A zero is a line nobody priced, not a price of nothing.
    if (cost <= 0) continue;

    const key = lastOverseasCostKey(r.item_id, r.currency);
    const held = out[key];
    // Ties go to the row seen later, which is the later-created order.
    if (!held || r.order_date >= held.orderDate) {
      out[key] = { unitCost: cost, orderDate: r.order_date, poNumber: r.po_number || "" };
    }
  }
  return out;
}
