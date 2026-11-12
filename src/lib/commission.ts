/**
 * Agent commission: the codes, and how a sold price is coded against the
 * dealer price (DP). The database does the month's calculation
 * (commission_lines); this is the same rule for the screens — the invoice
 * form's warning, the item form's DP2 — so they say what the commission will.
 */

export type CommissionCode = "B" | "O" | "TP" | "BD1" | "BD2" | "N";
export type PriceBand = "N" | "BD1" | "BD2";

/** Codes fixed by an item's category, whatever the price. */
export const CATEGORY_CODES: CommissionCode[] = ["B", "O", "TP"];
export const ALL_CODES: CommissionCode[] = ["B", "O", "TP", "BD1", "BD2", "N"];

export const CODE_LABELS: Record<CommissionCode, string> = {
  B: "Brands (Hikvision / Dahua)",
  O: "Wires",
  TP: "TP-Link",
  BD1: "Below DP",
  BD2: "Below DP2",
  N: "Normal (DP or above)",
};

/** DP2 is 5% below DP. */
export const DP2_FACTOR = 0.95;

export const dp2Of = (dp: number) => Math.round(dp * DP2_FACTOR * 100) / 100;

/**
 * Below DP2 → BD2; below DP (DP2 itself included) → BD1; DP or above → N.
 * Null when there is no DP to compare with.
 */
export function priceBand(price: number, dp: number | null | undefined): PriceBand | null {
  if (dp == null || !Number.isFinite(Number(dp)) || Number(dp) <= 0) return null;
  const d = Number(dp);
  if (price < d * DP2_FACTOR) return "BD2";
  if (price < d) return "BD1";
  return "N";
}

/**
 * A variation's DP: its own when set, else the item's scaled the way a
 * variation's cost is — DP × factor / units per stock.
 */
export function dealerPriceOf(
  item: { dealer_price?: number | null; units_per_stock?: number | null } | null | undefined,
  variation?: { dealer_price?: number | null; factor?: number | null } | null,
): number | null {
  if (variation?.dealer_price != null) return Number(variation.dealer_price);
  if (item?.dealer_price == null) return null;
  const dp = Number(item.dealer_price);
  if (!variation) return dp;
  const factor = Number(variation.factor) || 1;
  const perStock = Number(item.units_per_stock) || 1;
  return Math.round((dp * factor / perStock) * 100) / 100;
}

/** Matched the way the database matches it: no case, no outer spaces. */
export const categoryKey = (c: string | null | undefined) => (c ?? "").trim().toLowerCase();

/** The month's first day, as the database keys months: "2026-11-01". */
export const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;

export interface CodedLine {
  code: CommissionCode | null;
  rate: number | null;
  sales: number;
  commission: number;
}

export interface CodeSummary {
  code: CommissionCode;
  sales: number;
  commission: number;
  /** Every rate the month's lines used: more than one when a rate changed mid-month. */
  rates: number[];
  lineCount: number;
}

/**
 * The month by code, in the Commission tab's order. Commission is summed from
 * the lines and rounded once, at the end, the way the sheet multiplied each
 * category's total — so the two agree to the centavo.
 */
export function summarizeByCode(lines: CodedLine[]): { codes: CodeSummary[]; sales: number; commission: number; uncounted: number } {
  const by = new Map<CommissionCode, CodeSummary>();
  let uncounted = 0;
  for (const l of lines) {
    if (!l.code || l.rate == null) { uncounted += l.sales; continue; }
    const s = by.get(l.code) ?? { code: l.code, sales: 0, commission: 0, rates: [], lineCount: 0 };
    s.sales += l.sales;
    s.commission += l.commission;
    s.lineCount += 1;
    if (!s.rates.includes(l.rate)) s.rates.push(l.rate);
    by.set(l.code, s);
  }
  const codes = ALL_CODES.filter((c) => by.has(c)).map((c) => {
    const s = by.get(c)!;
    return { ...s, commission: round2(s.commission), rates: s.rates.sort((a, b) => a - b) };
  });
  return {
    codes,
    sales: codes.reduce((t, c) => t + c.sales, 0),
    commission: round2(codes.reduce((t, c) => t + c.commission, 0)),
    uncounted,
  };
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** What each problem on a line means, for the page's warnings. */
export const PROBLEM_LABELS: Record<string, string> = {
  no_dp: "No DP and no commission category, so not counted",
  not_inventory_item: "Typed in, not an inventory item, so not counted",
  no_rate: "No rate set for this code on the day it was paid",
  no_account: "Paid, but no cash or bank account recorded",
  other_petty_cash: "Cash went into another person's petty cash",
};

export interface SoldLine extends CodedLine {
  invoice_id: string;
  customer_id?: string | null;
  customer: string | null;
  item_id: string | null;
  item_name: string | null;
  quantity: number;
}

/**
 * The month at a glance. Customers are counted by id, falling back to the
 * name for months saved before the id was kept; a sale with no customer is a
 * walk-in, counted apart rather than as one customer.
 */
export function agentMonthStats(lines: SoldLine[]) {
  const orders = new Set<string>();
  const customers = new Set<string>();
  const walkIns = new Set<string>();
  let sales = 0;
  for (const l of lines) {
    orders.add(l.invoice_id);
    sales += l.sales;
    const key = l.customer_id || (l.customer ? `name:${l.customer.trim().toLowerCase()}` : "");
    if (key) customers.add(key);
    else walkIns.add(l.invoice_id);
  }
  return { orders: orders.size, customers: customers.size, walkInOrders: walkIns.size, sales };
}

export interface ProductRow {
  key: string;
  name: string;
  codes: CommissionCode[];
  quantity: number;
  sales: number;
  commission: number;
  orders: number;
  /** Some of it earned nothing: no DP and no commission category. */
  uncounted: boolean;
}

/** Every product sold in the month, most sales first. */
export function productBreakdown(lines: SoldLine[]): ProductRow[] {
  const by = new Map<string, ProductRow & { invoices: Set<string> }>();
  for (const l of lines) {
    const name = (l.item_name || "—").trim();
    const key = `${l.item_id ?? ""}|${name.toLowerCase()}`;
    const r = by.get(key) ?? { key, name, codes: [], quantity: 0, sales: 0, commission: 0, orders: 0, uncounted: false, invoices: new Set<string>() };
    r.quantity += l.quantity;
    r.sales += l.sales;
    r.commission += l.code && l.rate != null ? l.commission : 0;
    if (l.code && !r.codes.includes(l.code)) r.codes.push(l.code);
    if (!l.code || l.rate == null) r.uncounted = true;
    r.invoices.add(l.invoice_id);
    by.set(key, r);
  }
  return [...by.values()]
    .map(({ invoices, ...r }) => ({
      ...r,
      orders: invoices.size,
      commission: round2(r.commission),
      codes: ALL_CODES.filter((c) => r.codes.includes(c)),
    }))
    .sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name));
}
