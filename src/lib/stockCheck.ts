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
  available: number; // base units available at store
  needed: number;   // base units required by this line(s)
  shortBy: number;  // needed - available (>0)
  unit: string;
}

/**
 * Check store-stock availability for a set of sale lines.
 *
 * IMPORTANT: cut variations (e.g. "CAT6 Outdoor m") sell in BASE units (meters)
 * but the parent item.store_quantity is counted in STOCK units (rolls). We must
 * convert the parent's stock into base units before comparing, otherwise selling
 * 80 m from a 5-roll parent would falsely report "5 available, 80 needed".
 *
 * Available base units for a cut-capable item =
 *   store_quantity * units_per_stock + open_roll_remaining
 *
 * For pack variations (or non-variation lines), items are compared in whole units
 * directly against store_quantity.
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
      .select("id, name, store_quantity, base_unit, units_per_stock, open_roll_remaining")
      .in("id", itemIds),
    variationIds.length > 0
      ? (supabase as any)
          .from("item_variations")
          .select("id, item_id, factor, type, name")
          .in("id", variationIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const itemMap = new Map<string, any>(((items as any[]) || []).map((i) => [i.id, i]));
  const varMap = new Map<string, any>(((variations as any[]) || []).map((v) => [v.id, v]));

  // Aggregate base-unit demand per item, and track whether any demand for this
  // item involved a cut variation (so we know to convert available to base units).
  const demand = new Map<string, number>();
  const cutMode = new Map<string, boolean>();

  for (const l of valid) {
    const itemId = l.item_id as string;
    let baseUnits = Number(l.quantity);
    let isCut = false;
    if (l.variation_id) {
      const v = varMap.get(l.variation_id);
      if (v) {
        baseUnits = Number(v.factor || 1) * Number(l.quantity);
        isCut = v.type === "cut";
      }
    }
    demand.set(itemId, (demand.get(itemId) || 0) + baseUnits);
    if (isCut) cutMode.set(itemId, true);

    // Diagnostic log to make future variation/inventory bugs easier to trace.
    const it = itemMap.get(itemId);
    const v = l.variation_id ? varMap.get(l.variation_id) : null;
    // eslint-disable-next-line no-console
    console.debug("[stockCheck]", {
      item: it?.name,
      itemId,
      variation: v?.name || null,
      variationId: l.variation_id || null,
      variationType: v?.type || null,
      factor: v?.factor ?? null,
      lineQty: l.quantity,
      baseUnitsNeeded: baseUnits,
      unit: it?.base_unit || (v?.type === "cut" ? "m" : "pcs"),
    });
  }

  const shortages: Shortage[] = [];
  for (const [itemId, needed] of demand.entries()) {
    const it = itemMap.get(itemId);
    if (!it) continue;

    const storeQty = Number(it.store_quantity || 0);
    const ups = Number(it.units_per_stock || 1);
    const openRem = Number(it.open_roll_remaining || 0);

    // For cut-mode items, convert store stock into base units (meters).
    const available = cutMode.get(itemId)
      ? storeQty * (ups > 0 ? ups : 1) + openRem
      : storeQty;

    if (available < needed) {
      shortages.push({
        itemId,
        name: it.name,
        available,
        needed,
        shortBy: needed - available,
        unit: cutMode.get(itemId) ? (it.base_unit || "m") : (it.base_unit || "pcs"),
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
