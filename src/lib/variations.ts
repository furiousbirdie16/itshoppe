/**
 * Variation deduction math.
 *
 * Variations let users sell from a parent item in different unit sizes.
 * - "pack": 1 unit of variation = `factor` base units (e.g. DC male 5pcs pack → 5 pcs deducted per qty).
 * - "cut": 1 unit of variation = `factor` meters cut from a roll. The parent item tracks
 *   `units_per_stock` (e.g. 305 m per roll) and `open_roll_remaining` (meters left on the
 *   currently-opened roll). Cuts draw from `open_roll_remaining` first, then open new rolls
 *   (decrementing `quantity`) as needed.
 *
 * Signed `qty` allows the same helper to do reversals (negative qty = restore stock).
 */
export interface ItemStockState {
  /** Whole stock units (rolls / on-shelf pcs / etc.) */
  quantity: number;
  /** Meters left on the currently-opened roll. Only meaningful for cut-able items. */
  open_roll_remaining: number;
  /** Base units per stock unit (e.g. 305 m / roll). Defaults to 1. */
  units_per_stock: number;
}

export interface VariationLike {
  type: 'pack' | 'cut';
  factor: number;
}

export interface DeductionResult {
  /** New quantity (whole stock units). */
  quantity: number;
  /** New open-roll remainder. */
  open_roll_remaining: number;
}

/**
 * Apply a sale (positive qty) or restore (negative qty) of `variation × qty` to an item.
 * Pure function — never touches the DB. Caller persists the returned state.
 */
export function applyVariationDelta(
  item: ItemStockState,
  variation: VariationLike,
  qty: number,
): DeductionResult {
  if (qty === 0) {
    return { quantity: item.quantity, open_roll_remaining: item.open_roll_remaining };
  }

  if (variation.type === 'pack') {
    // Pack: each unit of variation deducts `factor` whole base units from stock.
    // We treat parent.quantity as the count of "packs of size 1" (i.e. base unit count
    // when no rolls). Most pack items have units_per_stock=1, so a 5pcs pack with qty 10
    // deducts 50 from quantity directly.
    const deducted = Math.round(variation.factor * qty);
    // Not clamped, for the same reason the cut path is not: on a stock already
    // below zero, Math.max(0, …) raises it rather than flooring it, and a sale
    // that silently adds stock is worse than a negative number on a screen.
    return {
      quantity: item.quantity - deducted,
      open_roll_remaining: item.open_roll_remaining,
    };
  }

  // CUT
  const perStock = item.units_per_stock > 0 ? item.units_per_stock : 1;
  let metersToDeduct = variation.factor * qty; // can be negative for restore
  let quantity = item.quantity;
  let remaining = item.open_roll_remaining;

  if (metersToDeduct > 0) {
    // Sale: draw from open roll, then open new rolls as needed.
    //
    // Deliberately allowed to go negative. This used to stop once quantity hit
    // zero and then clamp the result with Math.max(0, …), which on a stock
    // already negative RAISED it: an item at -9 rolls sold 5m and came back as
    // 0 rolls, inventing nine rolls that were never bought. A plain sale has
    // always been allowed to go negative — overselling is a real thing that
    // happens, and the ledger has to say so rather than quietly round it away.
    //
    // Opening a roll that is not there keeps the arithmetic honest: total
    // metres are always quantity * perStock + remaining, so -9 rolls less 5m
    // is -10 rolls with 300m open, which is the same quantity of nothing.
    while (metersToDeduct > 0) {
      if (remaining <= 0) {
        quantity -= 1;
        remaining += perStock;
      }
      if (remaining >= metersToDeduct) {
        remaining -= metersToDeduct;
        metersToDeduct = 0;
      } else {
        metersToDeduct -= remaining;
        remaining = 0;
      }
    }
    return { quantity, open_roll_remaining: remaining };
  } else {
    // Restore: add meters back to open roll, close it into whole rolls when full.
    let metersToAdd = -metersToDeduct;
    remaining += metersToAdd;
    while (remaining >= perStock && perStock > 0) {
      remaining -= perStock;
      quantity += 1;
    }
    return { quantity, open_roll_remaining: remaining };
  }
}

/** Format the parent stock for display: "29 rolls + 255m open" or just "29 pcs". */
export function formatStockDisplay(item: {
  quantity: number;
  open_roll_remaining?: number;
  units_per_stock?: number;
  base_unit?: string;
}): string {
  const ups = item.units_per_stock ?? 1;
  const open = item.open_roll_remaining ?? 0;
  if (ups > 1 && open > 0) {
    return `${item.quantity} + ${open}${item.base_unit || 'm'} open`;
  }
  return String(item.quantity);
}
