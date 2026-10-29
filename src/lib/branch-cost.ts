/**
 * Which cost to show for an item, from its branch stock rows.
 *
 * Each branch has its own cost (item_branch_stock.cost_price). One branch
 * picked: that branch's cost. "All branches": the branches blended by how
 * much stock each holds — what the company's stock cost on average. A branch
 * with no cost of its own yet uses the company figure.
 */
export function costFromRows(
  itemCost: number,
  rows: { quantity: number | string | null; cost_price: number | string | null }[],
): number {
  const base = Number(itemCost || 0);
  if (rows.length === 0) return base;
  if (rows.length === 1) return rows[0].cost_price == null ? base : Number(rows[0].cost_price);
  let qty = 0;
  let value = 0;
  for (const r of rows) {
    const q = Math.max(Number(r.quantity || 0), 0);
    const c = r.cost_price == null ? base : Number(r.cost_price);
    qty += q;
    value += q * c;
  }
  if (qty > 0) return value / qty;
  const costs = rows.map((r) => (r.cost_price == null ? base : Number(r.cost_price)));
  return costs.reduce((s, c) => s + c, 0) / costs.length;
}
