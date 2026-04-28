import { supabase } from "@/integrations/supabase/client";

export interface StockCheckLine {
  item_id: string | null;
  item_name?: string | null;
  variation_id?: string | null;
  quantity: number;
}

export interface Shortage {
  itemId: string;
  name: string;
  available: number; // store_quantity (base units)
  needed: number;   // base units required by this line(s)
  shortBy: number;  // needed - available (>0)
  unit: string;
}

/**
 * Check store-stock availability for a set of sale lines.
 * Returns a list of shortages (only items where store_quantity < needed base units).
 * Lines with no item_id are ignored. Variation-aware (multiplies qty by factor).
 *
 * Note: this is an *advisory* check. Sales/invoices/online sales are still
 * allowed to push through and let store stock go negative.
 */
export const checkStoreStock = async (lines: StockCheckLine[]): Promise<Shortage[]> => {
  const valid = lines.filter((l) => l.item_id && Number(l.quantity) > 0);
  if (valid.length === 0) return [];

  const itemIds = Array.from(new Set(valid.map((l) => l.item_id as string)));
  const variationIds = Array.from(
    new Set(valid.map((l) => l.variation_id).filter(Boolean) as string[]),
  );

  const [{ data: items }, { data: variations }] = await Promise.all([
    (supabase as any)
      .from("items")
      .select("id, name, store_quantity, base_unit")
      .in("id", itemIds),
    variationIds.length > 0
      ? (supabase as any)
          .from("item_variations")
          .select("id, factor, type")
          .in("id", variationIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const itemMap = new Map<string, any>(((items as any[]) || []).map((i) => [i.id, i]));
  const varMap = new Map<string, any>(((variations as any[]) || []).map((v) => [v.id, v]));

  // Aggregate base-unit demand per item
  const demand = new Map<string, number>();
  for (const l of valid) {
    const itemId = l.item_id as string;
    let baseUnits = Number(l.quantity);
    if (l.variation_id) {
      const v = varMap.get(l.variation_id);
      if (v) baseUnits = Number(v.factor || 1) * Number(l.quantity);
    }
    demand.set(itemId, (demand.get(itemId) || 0) + baseUnits);
  }

  const shortages: Shortage[] = [];
  for (const [itemId, needed] of demand.entries()) {
    const it = itemMap.get(itemId);
    if (!it) continue;
    const available = Number(it.store_quantity || 0);
    if (available < needed) {
      shortages.push({
        itemId,
        name: it.name,
        available,
        needed,
        shortBy: needed - available,
        unit: it.base_unit || "pcs",
      });
    }
  }
  return shortages;
};

/** Format shortages as a human-readable warning message. */
export const formatShortageMessage = (shortages: Shortage[]): string => {
  return shortages
    .map(
      (s) =>
        `• ${s.name}: store has ${s.available} ${s.unit}, need ${s.needed} ${s.unit} (short by ${s.shortBy})`,
    )
    .join("\n");
};
