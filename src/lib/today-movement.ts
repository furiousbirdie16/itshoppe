/**
 * Today's movement sheet: every product whose stock moved today at a branch,
 * with what sold and what is left, and a blank column to fill in by hand.
 */

export interface MovementLike {
  item_id: string | null;
  branch_id: string | null;
  type: string;
  quantity: number | string | null;
  unit: string | null;
  reference_type: string | null;
}

export interface TodayRow {
  Branch: string;
  "Product Name": string;
  "Sold Today": number | string;
  "Quantity Left": number | string;
  /** Left blank, to fill in by hand. */
  "Actual Count": string;
}

const SALE_TYPES = new Set(["out_invoice", "out_online_sale"]);
/** Stock put back by undoing a sale. */
const SALE_UNDO_REFS = new Set(["invoice_cancel", "invoice_revert", "invoice_delete", "online_sale_returned", "online_sale_cancelled"]);

const fmt = (n: number) => Math.round(n * 1000) / 1000;

/** Net units sold per unit ("pcs", "m"), sales less anything undone today. */
export function netSold(movements: MovementLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    const unit = (m.unit || "pcs").toLowerCase();
    const q = Number(m.quantity || 0);
    if (SALE_TYPES.has(m.type)) out.set(unit, (out.get(unit) || 0) + q);
    else if (m.reference_type && SALE_UNDO_REFS.has(m.reference_type)) out.set(unit, (out.get(unit) || 0) - q);
  }
  return out;
}

/** A plain number for pieces (so the sheet can add it up), "50 m" otherwise. */
export function soldLabel(byUnit: Map<string, number>): number | string {
  const parts = [...byUnit].filter(([, q]) => fmt(q) !== 0);
  if (parts.length === 0) return 0;
  if (parts.length === 1 && (parts[0][0] === "pcs" || parts[0][0] === "pc")) return fmt(parts[0][1]);
  return parts.map(([u, q]) => `${fmt(q)} ${u}`).join(" + ");
}

export function buildTodayRows(
  movements: MovementLike[],
  look: {
    itemName: (itemId: string) => string;
    branchCode: (branchId: string | null) => string;
    /** Stock left at the branch, a number or "9 + 255m open". */
    left: (itemId: string, branchId: string | null) => number | string;
  },
): TodayRow[] {
  const groups = new Map<string, MovementLike[]>();
  for (const m of movements) {
    if (!m.item_id) continue;
    const key = `${m.branch_id ?? ""}|${m.item_id}`;
    groups.set(key, [...(groups.get(key) || []), m]);
  }
  const rows: TodayRow[] = [];
  for (const [key, ms] of groups) {
    const [branchId, itemId] = key.split("|");
    const b = branchId || null;
    rows.push({
      Branch: look.branchCode(b),
      "Product Name": look.itemName(itemId),
      "Sold Today": soldLabel(netSold(ms)),
      "Quantity Left": look.left(itemId, b),
      "Actual Count": "",
    });
  }
  return rows.sort((a, c) => a.Branch.localeCompare(c.Branch) || a["Product Name"].localeCompare(c["Product Name"]));
}
