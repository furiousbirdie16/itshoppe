/**
 * Quantities on quotation and invoice lines.
 *
 * A line can hold a decimal quantity (2.5) when it is cut to length (sold by
 * the metre through a "cut" variation) or not linked to inventory at all.
 * A line linked to a stocked item otherwise has to be whole: stock is counted
 * in whole pieces, and 2.5 pieces would be rounded to 3 when deducted.
 */

/** A typed quantity or price as a number, to 3 decimal places; 0 when blank or not a number. */
export function parseQty(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

/** A typed price as a number, to 2 decimal places (centavos); 0 when blank or not a number. */
export function parsePrice(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Whether this line must have a whole-number quantity. */
export function needsWholeQty(
  line: { item_id?: string | null; variation_id?: string | null },
  variations: { id: string; type: string }[],
): boolean {
  if (!line.item_id) return false;
  if (!line.variation_id) return true;
  const v = variations.find((x) => x.id === line.variation_id);
  return v?.type !== "cut";
}

/** The message for a decimal quantity on a whole-only line, or null when fine. */
export function wholeQtyError(name: string, qty: number, whole: boolean): string | null {
  if (!whole || Number.isInteger(qty)) return null;
  return `"${name}" is counted in whole pieces, so its quantity cannot be ${qty}. Only items cut by the metre, or lines not linked to inventory, can have decimals.`;
}
