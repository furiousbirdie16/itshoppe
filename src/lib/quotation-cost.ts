import { supabase } from "@/integrations/supabase/client";

export interface CostLine {
  id: string;
  item_id: string | null;
  variation_id: string | null;
  quantity: number;
  unit_price: number;
}

/**
 * Each line's unit cost at the quotation's branch, the same figure an invoice
 * would record: the variation's cost (its own, or its share of the parent's),
 * else the item's branch cost, else the company cost. Lines with no product
 * (typed-in items) have no cost.
 */
export async function getQuotationLineCosts(lines: CostLine[], branchId: string | null): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  await Promise.all(
    lines.map(async (l) => {
      if (!l.item_id && !l.variation_id) { out[l.id] = null; return; }
      const { data, error } = l.variation_id
        ? await (supabase as any).rpc("variation_cost_at", { _variation_id: l.variation_id, _branch_id: branchId })
        : await (supabase as any).rpc("item_cost_at", { _item_id: l.item_id, _branch_id: branchId });
      if (error) throw error;
      out[l.id] = data == null ? null : Number(data);
    }),
  );
  return out;
}

export interface CostSummary {
  /** The whole quotation, every line. */
  total: number;
  /** Selling total of the lines that have a cost; profit and margin are over these. */
  costedTotal: number;
  cost: number;
  profit: number;
  /** Profit as a share of the costed lines' selling total, in percent; null when there is none. */
  margin: number | null;
  /** Lines with no cost: typed-in lines, and products with no cost on file. Left out of profit. */
  uncosted: number;
}

export function summariseQuotationCost(lines: CostLine[], costs: Record<string, number | null>): CostSummary {
  let total = 0;
  let costedTotal = 0;
  let cost = 0;
  let uncosted = 0;
  for (const l of lines) {
    const qty = Number(l.quantity) || 0;
    const sell = qty * (Number(l.unit_price) || 0);
    total += sell;
    const c = costs[l.id];
    if (c == null) { uncosted++; continue; }
    costedTotal += sell;
    cost += qty * c;
  }
  const profit = costedTotal - cost;
  return { total, costedTotal, cost, profit, margin: costedTotal > 0 ? (profit / costedTotal) * 100 : null, uncosted };
}
