/**
 * Landed cost: what one unit of a shipment really cost once its share of the
 * cargo bill is on it.
 *
 * Cargo is split by CBM, because a forwarder charges for space: a 10 CBM box
 * and a 0.5 CBM box on a ₱50,000 bill carry ₱47,619 and ₱2,381, not ₱25,000
 * each. A line can have CBM of its own (its own boxes) and a share of mixed
 * boxes; a mixed box's CBM is shared among the lines in it by their value,
 * the only measure every line has.
 *
 * Pure, so the arithmetic can be checked without a database.
 */

export interface CargoLine {
  id: string;
  qty: number;
  /** Unit cost in the order's currency. */
  unitCost: number;
}

export interface CargoBox {
  id: string;
  label: string;
  cbm: number;
  /** PO lines packed in this box. */
  lineIds: string[];
}

export interface CargoInput {
  /** The forwarder's bill, in pesos. */
  cargoAmount: number;
  /** Customs, delivery and the like, in pesos — split the same way. */
  otherCharges: number;
  /** CBM of a line's own boxes, by line id. */
  lineCbm: Record<string, number>;
  /** Boxes holding more than one line. */
  boxes: CargoBox[];
  /** Pesos per unit of the order's currency. */
  exchangeRate: number;
}

export interface LineAllocation {
  /** CBM this line accounts for: its own plus its share of mixed boxes. */
  cbm: number;
  /** Pesos of cargo and charges carried by the line. */
  cargo: number;
  cargoPerUnit: number;
  /** Unit cost in pesos before cargo. */
  goodsPerUnit: number;
  landedPerUnit: number;
}

export interface Allocation {
  lines: Record<string, LineAllocation>;
  totalCbm: number;
  /**
   * How the charges were split: by CBM normally, by value when no CBM was
   * entered at all (better than charging nothing), never silently.
   */
  basis: "cbm" | "value";
}

const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);

export function allocateCargo(lines: CargoLine[], input: CargoInput): Allocation {
  const charges = Math.max(num(input.cargoAmount), 0) + Math.max(num(input.otherCharges), 0);
  const rate = num(input.exchangeRate) > 0 ? num(input.exchangeRate) : 1;
  const value = (l: CargoLine) => Math.max(num(l.qty), 0) * Math.max(num(l.unitCost), 0);

  const cbm: Record<string, number> = {};
  for (const l of lines) cbm[l.id] = Math.max(num(input.lineCbm[l.id]), 0);

  for (const box of input.boxes) {
    const inBox = lines.filter((l) => box.lineIds.includes(l.id));
    const boxCbm = Math.max(num(box.cbm), 0);
    if (inBox.length === 0 || boxCbm === 0) continue;
    const totalValue = inBox.reduce((s, l) => s + value(l), 0);
    const totalQty = inBox.reduce((s, l) => s + Math.max(num(l.qty), 0), 0);
    for (const l of inBox) {
      // By value; by quantity if nothing in the box has a price yet.
      const weight = totalValue > 0 ? value(l) / totalValue : totalQty > 0 ? Math.max(num(l.qty), 0) / totalQty : 1 / inBox.length;
      cbm[l.id] += boxCbm * weight;
    }
  }

  const totalCbm = Object.values(cbm).reduce((s, v) => s + v, 0);
  const totalValue = lines.reduce((s, l) => s + value(l), 0);
  const basis: Allocation["basis"] = totalCbm > 0 ? "cbm" : "value";

  const out: Record<string, LineAllocation> = {};
  for (const l of lines) {
    const share = basis === "cbm"
      ? cbm[l.id] / totalCbm
      : totalValue > 0 ? value(l) / totalValue : 0;
    const cargo = charges * share;
    const qty = Math.max(num(l.qty), 0);
    const cargoPerUnit = qty > 0 ? cargo / qty : 0;
    const goodsPerUnit = Math.max(num(l.unitCost), 0) * rate;
    out[l.id] = { cbm: cbm[l.id], cargo, cargoPerUnit, goodsPerUnit, landedPerUnit: goodsPerUnit + cargoPerUnit };
  }
  return { lines: out, totalCbm, basis };
}

/**
 * The item's cost once a shipment is in: the stock already held at its old
 * cost, averaged with the shipment at its landed cost.
 *
 * Worked out when the cargo bill is entered, which can be after some of the
 * shipment has sold. Units sold since are taken to have come from the older
 * stock first, which is how a shelf is actually emptied.
 *
 * @param stockNow every branch's stock of the item right now
 * @param ordered  units on this PO line
 * @param received units of the line already received (already in stockNow)
 */
export function weightedAverageCost(params: {
  currentCost: number;
  stockNow: number;
  ordered: number;
  received: number;
  landed: number;
}): { cost: number; oldUnits: number; newUnits: number } {
  const current = num(params.currentCost);
  const landed = num(params.landed);
  const stockNow = Math.max(num(params.stockNow), 0);
  const ordered = Math.max(num(params.ordered), 0);
  const received = Math.min(Math.max(num(params.received), 0), ordered);

  // Received units are part of stockNow; the rest of the line is still to come.
  const newOnHand = Math.min(received, stockNow) + (ordered - received);
  const oldUnits = Math.max(stockNow - received, 0);

  // No older stock, or none with a cost worth averaging in: the landed cost is it.
  if (oldUnits === 0 || current <= 0 || newOnHand === 0) {
    return { cost: newOnHand === 0 && oldUnits > 0 && current > 0 ? current : landed, oldUnits, newUnits: newOnHand };
  }
  return {
    cost: (oldUnits * current + newOnHand * landed) / (oldUnits + newOnHand),
    oldUnits,
    newUnits: newOnHand,
  };
}

/** Margin on the selling price, as a fraction; null when there is no price. */
export function marginOf(sellingPrice: number, cost: number): number | null {
  const price = num(sellingPrice);
  if (price <= 0) return null;
  return (price - num(cost)) / price;
}

/** CBM per unit to remember for next time, from a line's own boxes only. */
export function cbmPerUnit(ownCbm: number, qty: number): number | null {
  const c = num(ownCbm);
  const q = num(qty);
  return c > 0 && q > 0 ? c / q : null;
}

export interface ReviewLine {
  lineId: string;
  itemId: string | null;
  itemName: string;
  qty: number;
  received: number;
  /** Unit cost in the order's currency. */
  unitCost: number;
  /** CBM of the line's own boxes (not its share of mixed ones). */
  ownCbm: number;
}

export interface ReviewItem {
  itemId: string;
  currentCost: number;
  sellingPrice: number;
  stockNow: number;
}

export interface CostReviewRow {
  itemId: string;
  itemName: string;
  ordered: number;
  received: number;
  stockNow: number;
  oldUnits: number;
  newUnits: number;
  currentCost: number;
  /** This shipment's landed cost per unit. */
  landed: number;
  /** The item's cost once averaged with stock on hand. */
  newCost: number;
  /** Change from the current cost, as a fraction; null when there was none. */
  change: number | null;
  sellingPrice: number;
  margin: number | null;
  belowTarget: boolean;
  /** Unit cost in the order's currency, quantity-weighted across the item's lines. */
  foreignCost: number;
  cbmPerUnit: number | null;
}

/**
 * One review row per item: lines of the same item on one PO are combined, so
 * applying them cannot have the second line overwrite the first.
 * Lines with no inventory item (freight, custom lines) are left out.
 */
export function buildCostReview(
  lines: ReviewLine[],
  allocation: Allocation,
  items: Record<string, ReviewItem>,
  marginTargetPercent: number,
): CostReviewRow[] {
  const byItem = new Map<string, ReviewLine[]>();
  for (const l of lines) {
    if (!l.itemId || !items[l.itemId]) continue;
    byItem.set(l.itemId, [...(byItem.get(l.itemId) || []), l]);
  }

  const rows: CostReviewRow[] = [];
  for (const [itemId, group] of byItem) {
    const item = items[itemId];
    const ordered = group.reduce((s, l) => s + Math.max(num(l.qty), 0), 0);
    const received = group.reduce((s, l) => s + Math.min(Math.max(num(l.received), 0), Math.max(num(l.qty), 0)), 0);
    if (ordered <= 0) continue;

    const landed = group.reduce((s, l) => s + (allocation.lines[l.lineId]?.landedPerUnit ?? 0) * Math.max(num(l.qty), 0), 0) / ordered;
    const foreignCost = group.reduce((s, l) => s + num(l.unitCost) * Math.max(num(l.qty), 0), 0) / ordered;
    const ownCbm = group.reduce((s, l) => s + Math.max(num(l.ownCbm), 0), 0);
    const qtyWithOwnCbm = group.filter((l) => num(l.ownCbm) > 0).reduce((s, l) => s + Math.max(num(l.qty), 0), 0);

    const avg = weightedAverageCost({
      currentCost: item.currentCost,
      stockNow: item.stockNow,
      ordered,
      received,
      landed,
    });
    const margin = marginOf(item.sellingPrice, avg.cost);
    rows.push({
      itemId,
      itemName: group[0].itemName,
      ordered,
      received,
      stockNow: item.stockNow,
      oldUnits: avg.oldUnits,
      newUnits: avg.newUnits,
      currentCost: num(item.currentCost),
      landed,
      newCost: avg.cost,
      change: num(item.currentCost) > 0 ? (avg.cost - num(item.currentCost)) / num(item.currentCost) : null,
      sellingPrice: num(item.sellingPrice),
      margin,
      belowTarget: margin !== null && margin * 100 < marginTargetPercent,
      foreignCost,
      cbmPerUnit: cbmPerUnit(ownCbm, qtyWithOwnCbm),
    });
  }
  return rows.sort((a, b) => a.itemName.localeCompare(b.itemName));
}
