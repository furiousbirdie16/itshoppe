/**
 * Serial tracking began on this date, so nothing sold before it is short of
 * serials — it was sold under rules that did not ask for any.
 *
 * Without this every invoice in the history reported missing serials, which
 * buried the handful that genuinely need scanning.
 */
export const SERIAL_TRACKING_SINCE = "2026-09-27";

/**
 * Whether an invoice is old enough to be exempt.
 *
 * Read from when the invoice was raised rather than its invoice date: a
 * back-dated invoice written today was still written with the scanner to hand.
 */
export function serialTrackingApplies(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  return createdAt.slice(0, 10) >= SERIAL_TRACKING_SINCE;
}

export interface ShortfallLine {
  id: string;
  quantity: number;
  item_id?: string | null;
  item_name?: string | null;
  items?: { name?: string | null; track_serials?: boolean } | null;
}

export interface Shortfall {
  invoice_item_id: string;
  item_name: string;
  needed: number;
  recorded: number;
}

/**
 * Which line each of one invoice's units belongs to, as a map of unit id to line id.
 *
 * Editing an invoice deletes and rewrites every line, which blanks the link on
 * the units already recorded. Going by the link alone, those serials vanished
 * from the invoice while still counting as sold, so they could not be removed
 * and the invoice read as missing them. A unit whose line is gone is matched
 * back by product instead. One with no such product left maps to nothing.
 */
export function lineForUnits<U extends { id: string; item_id?: string | null; invoice_item_id: string | null }>(
  lines: Pick<ShortfallLine, "id" | "quantity" | "item_id">[],
  units: U[],
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const taken = new Map<string, number>();
  const ids = new Set(lines.map((l) => l.id));

  for (const u of units) {
    if (u.invoice_item_id && ids.has(u.invoice_item_id)) {
      out.set(u.id, u.invoice_item_id);
      taken.set(u.invoice_item_id, (taken.get(u.invoice_item_id) || 0) + 1);
    }
  }
  for (const u of units) {
    if (out.has(u.id)) continue;
    const same = u.item_id ? lines.filter((l) => l.item_id === u.item_id) : [];
    const line = same.find((l) => (taken.get(l.id) || 0) < (Number(l.quantity) || 0)) ?? same[0];
    out.set(u.id, line?.id ?? null);
    if (line) taken.set(line.id, (taken.get(line.id) || 0) + 1);
  }
  return out;
}

/**
 * Which lines on an invoice went out short of serials.
 *
 * Derived on every read rather than stored on the invoice, so it clears itself
 * the moment the missing units are recorded and cannot drift out of step with a
 * quantity edited after the sale. Raising a line from 2 to 3 puts it back in
 * this list without touching the two serials already captured.
 */
export function shortfallFor(
  lines: ShortfallLine[],
  units: { id?: string; item_id?: string | null; invoice_item_id: string | null }[],
): Shortfall[] {
  const keyed = units.map((u, i) => ({ ...u, id: u.id ?? String(i) }));
  const lineOf = lineForUnits(lines, keyed);
  const counted = new Map<string, number>();
  for (const u of keyed) {
    const lineId = lineOf.get(u.id);
    if (lineId) counted.set(lineId, (counted.get(lineId) || 0) + 1);
  }
  const out: Shortfall[] = [];
  for (const l of lines) {
    // A product that does not ask for serials never appears here, and a custom
    // line has no product to ask.
    if (!l.items?.track_serials) continue;
    const needed = Number(l.quantity) || 0;
    const recorded = counted.get(l.id) || 0;
    if (recorded < needed) {
      out.push({
        invoice_item_id: l.id,
        item_name: l.items?.name || l.item_name || "Item",
        needed,
        recorded,
      });
    }
  }
  return out;
}
