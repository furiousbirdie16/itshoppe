/**
 * Reading Shopee Seller Centre's own order export (My Orders → Export).
 *
 * Only five things are taken from it, by the owner's decision: the ship time
 * (as the sale date), the order ID, the SKU Reference No., the deal price and
 * the quantity. Order status and tracking number are read only to leave out
 * orders that are not sales — cancelled, unpaid, or never handed to a courier
 * — and are not stored.
 *
 * One row per product per order: an order of two items is two rows sharing an
 * order ID, told apart by their SKU.
 *
 * Headers are matched loosely (case, spacing, a trailing "*" or "(PHP)").
 */

export type Cell = string | number | boolean | Date | null | undefined;

export interface ShopeeRow {
  orderId: string;
  /** Ship time, as YYYY-MM-DD; empty if the row has none. */
  date: string;
  sku: string;
  /** Per unit. */
  dealPrice: number;
  quantity: number;
}

export type SkipReason = "Cancelled" | "Unpaid" | "No tracking number";

export interface ShopeeParse {
  rows: ShopeeRow[];
  /** Lines left out, with why. */
  skipped: { orderId: string; reason: SkipReason }[];
}

const norm = (v: Cell) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\(php\)|\(₱\)|\*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const COLUMNS = {
  orderId: ["order id"],
  status: ["order status"],
  tracking: ["tracking number"],
  shipTime: ["ship time"],
  sku: ["sku reference no", "sku reference number"],
  dealPrice: ["deal price"],
  quantity: ["quantity"],
} as const;

type Key = keyof typeof COLUMNS;

function indexColumns(header: Cell[]): Record<Key, number> {
  const names = header.map(norm);
  const out = {} as Record<Key, number>;
  for (const key of Object.keys(COLUMNS) as Key[]) {
    out[key] = -1;
    for (const candidate of COLUMNS[key]) {
      const i = names.indexOf(candidate);
      if (i >= 0) { out[key] = i; break; }
    }
  }
  return out;
}

/** The columns a Shopee export must have for the upload to read it. */
export const REQUIRED_COLUMNS = ["Order ID", "Order Status", "Tracking Number", "Ship Time", "SKU Reference No.", "Deal Price", "Quantity"];

/** Which required columns a header row lacks. */
export function missingShopeeColumns(header: Cell[]): string[] {
  const ix = indexColumns(header);
  const keys: Key[] = ["orderId", "status", "tracking", "shipTime", "sku", "dealPrice", "quantity"];
  return keys.filter((k) => ix[k] < 0).map((k) => REQUIRED_COLUMNS[keys.indexOf(k)]);
}

/** Whether a sheet looks like a Shopee order export at all. */
export function isShopeeExport(header: Cell[]): boolean {
  const ix = indexColumns(header);
  return ix.orderId >= 0 && ix.sku >= 0;
}

const toNumber = (v: Cell) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-21 14:09", "21/10/2026 14:09" or an Excel serial → "2026-10-21"; "" if none. */
export function shopeeDate(v: Cell): string {
  if (typeof v === "number" && v > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v ?? "").trim();
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${pad(+iso[2])}-${pad(+iso[3])}`;
  // Shopee PH writes day first when it does not write ISO.
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${pad(+dmy[2])}-${pad(+dmy[1])}`;
  return "";
}

/** Why a line is not a sale, or null if it is one. */
export function skipReason(status: string, tracking: string): SkipReason | null {
  const s = norm(status);
  if (s.includes("cancel")) return "Cancelled";
  if (s === "unpaid" || s.includes("to pay")) return "Unpaid";
  // No tracking number means not yet printed and packed — not a sale yet. A
  // placeholder ("-", "N/A") is as good as blank.
  const t = String(tracking ?? "").trim().toLowerCase();
  if (!t || /^[-–—./\s]+$/.test(t) || ["n/a", "na", "none", "null", "nil", "tbd"].includes(t)) return "No tracking number";
  return null;
}

export function parseShopeeExport(sheet: Cell[][]): ShopeeParse {
  const [header = [], ...data] = sheet;
  const ix = indexColumns(header);
  const get = (row: Cell[], key: Key) => (ix[key] >= 0 ? row[ix[key]] : "");

  const rows: ShopeeRow[] = [];
  const skipped: ShopeeParse["skipped"] = [];
  for (const row of data) {
    const orderId = String(get(row, "orderId") ?? "").trim();
    if (!orderId) continue;
    const reason = skipReason(String(get(row, "status") ?? ""), String(get(row, "tracking") ?? ""));
    if (reason) {
      skipped.push({ orderId, reason });
      continue;
    }
    rows.push({
      orderId,
      date: shopeeDate(get(row, "shipTime")),
      sku: String(get(row, "sku") ?? "").trim(),
      dealPrice: toNumber(get(row, "dealPrice")),
      quantity: Math.max(toNumber(get(row, "quantity")), 0),
    });
  }
  return { rows, skipped };
}

/**
 * The inventory item a SKU Reference No. is: a variation's SKU first (a
 * Shopee variation is usually one of ours), then an item's. Case and spacing
 * do not matter.
 */
export function matchShopeeSku<
  I extends { id: string; sku: string | null },
  V extends { id: string; item_id: string; sku: string | null },
>(sku: string, items: I[], variations: V[]): { itemId: string | null; variationId: string | null } {
  const key = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
  const k = key(sku);
  if (!k) return { itemId: null, variationId: null };
  const v = variations.find((x) => key(x.sku) === k);
  if (v) return { itemId: v.item_id, variationId: v.id };
  const i = items.find((x) => key(x.sku) === k);
  if (i) return { itemId: i.id, variationId: null };
  return { itemId: null, variationId: null };
}
