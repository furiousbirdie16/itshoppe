/**
 * Which online sale lines still need serials.
 *
 * An online_sales row is one product line of an order, so "line" here is a
 * sale row and an order is the rows sharing an order number.
 */

/**
 * Serials on online sales began on this date. Orders recorded before it went
 * out under rules that did not ask for any, so they are not short of serials.
 * Read from when the row was recorded, not its order date: a Shopee upload
 * done today of last week's orders was still done with the scanner to hand.
 */
export const ONLINE_SERIALS_SINCE = "2026-11-04";

export interface OnlineSerialLine {
  id: string;
  quantity: number | null;
  status?: string | null;
  created_at?: string | null;
  items?: { track_serials?: boolean | null } | null;
}

/** Whether this line asks for serials at all: a product that tracks them, on a live sale. */
export function lineTracksSerials(line: OnlineSerialLine): boolean {
  return !!line.items?.track_serials && (line.status || "completed") === "completed";
}

/** How many units of this line need a serial. */
export function serialsNeeded(line: OnlineSerialLine): number {
  return lineTracksSerials(line) ? Math.max(Number(line.quantity) || 0, 0) : 0;
}

/** Whether a short line should be counted as missing, as opposed to simply older than the feature. */
export function onlineSerialsApply(line: OnlineSerialLine): boolean {
  return !!line.created_at && line.created_at.slice(0, 10) >= ONLINE_SERIALS_SINCE;
}

/** Recorded and needed serials across some lines (an order, usually). */
export function serialProgress(
  lines: OnlineSerialLine[],
  counts: Record<string, number>,
): { recorded: number; needed: number } {
  let recorded = 0;
  let needed = 0;
  for (const l of lines) {
    const need = serialsNeeded(l);
    if (!need) continue;
    needed += need;
    recorded += Math.min(counts[l.id] || 0, need);
  }
  return { recorded, needed };
}

/**
 * Units still missing a serial, per order number. Only lines recorded since
 * the feature began count, so the history does not bury the real gaps.
 */
export function ordersMissingSerials(
  lines: (OnlineSerialLine & { order_number: string })[],
  counts: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (!onlineSerialsApply(l)) continue;
    const short = serialsNeeded(l) - (counts[l.id] || 0);
    if (short > 0) out[l.order_number] = (out[l.order_number] || 0) + short;
  }
  return out;
}

/**
 * The line a scan should go to: the first, in order, that still needs a
 * serial. Null when the order is complete.
 */
export function nextLineNeedingSerial<L extends OnlineSerialLine>(
  lines: L[],
  counts: Record<string, number>,
): L | null {
  return lines.find((l) => (counts[l.id] || 0) < serialsNeeded(l)) ?? null;
}

const CHANNEL_LABEL: Record<string, string> = { shopee: "Shopee", lazada: "Lazada", others: "Online" };

/** "Shopee 2511040ABC" — how an online order is named wherever a serial points at it. */
export function onlineOrderLabel(sale: { order_number?: string | null; sales_channel?: string | null } | null | undefined): string {
  if (!sale) return "";
  const channel = CHANNEL_LABEL[sale.sales_channel || ""] || "Online";
  return `${channel} ${sale.order_number || ""}`.trim();
}
