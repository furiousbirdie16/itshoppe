/**
 * Marketplace Receivables — estimate money owed by marketplace platforms
 * (Shopee, Lazada, others) for Online Sales that are not yet paid out.
 *
 * Read-only helpers: nothing here writes to the database and no existing
 * Online Sales logic is changed. Total Sales reuses the same value Online
 * Sales already displays for an order line.
 */

/** Fallback marketplace fee percentage when an order has no override. */
export const DEFAULT_MARKETPLACE_FEE_PCT = 22;

export type MarketplaceChannel = "shopee" | "lazada" | "others";

export interface MarketplaceReceivableRow {
  id: string;
  order_date: string;
  order_number: string;
  product_name: string;
  quantity: number;
  sales_channel: MarketplaceChannel;
  /** Total Sales as shown in Online Sales. */
  totalSales: number;
  /** Effective fee % (per-order override, else the 22% default). */
  feePct: number;
  /** true when the order carries its own fee % override. */
  hasFeeOverride: boolean;
  estimatedFee: number;
  estimatedPayout: number;
  daysOutstanding: number;
}

/** Total Sales for an online sale line — same value Online Sales shows. */
export function totalSalesForSale(sale: any): number {
  return Number(sale?.posted_price || 0) * Number(sale?.quantity || 1);
}

/** Effective fee % for an order: per-order override, else the default. */
export function feePctForSale(sale: any): number {
  const raw = sale?.marketplace_fee_pct;
  const n = Number(raw);
  if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0) return n;
  return DEFAULT_MARKETPLACE_FEE_PCT;
}

/** An online sale is a pending marketplace receivable when it is not yet paid. */
export function isPendingMarketplaceReceivable(sale: any): boolean {
  const paymentStatus = sale?.payment_status || "unpaid";
  if (paymentStatus === "paid") return false;
  // Respect the existing Online Sales lifecycle: only live orders are owed.
  const status = sale?.status || "completed";
  if (status === "returned" || status === "cancelled") return false;
  return true;
}

function daysBetween(from: string, to: Date): number {
  if (!from) return 0;
  const start = new Date(`${from}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  const diff = to.getTime() - start.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

export function toReceivableRow(sale: any, now = new Date()): MarketplaceReceivableRow {
  const totalSales = totalSalesForSale(sale);
  const feePct = feePctForSale(sale);
  const estimatedFee = (totalSales * feePct) / 100;
  return {
    id: sale.id,
    order_date: sale.order_date,
    order_number: sale.order_number,
    product_name: sale.product_name,
    quantity: Number(sale.quantity || 1),
    sales_channel: (sale.sales_channel || "others") as MarketplaceChannel,
    totalSales,
    feePct,
    hasFeeOverride:
      sale?.marketplace_fee_pct !== null &&
      sale?.marketplace_fee_pct !== undefined &&
      sale?.marketplace_fee_pct !== "",
    estimatedFee,
    estimatedPayout: totalSales - estimatedFee,
    daysOutstanding: daysBetween(sale.order_date, now),
  };
}

/** Build the pending receivable rows from raw online sales. */
export function buildReceivables(sales: any[], now = new Date()): MarketplaceReceivableRow[] {
  return sales.filter(isPendingMarketplaceReceivable).map((s) => toReceivableRow(s, now));
}

export interface ReceivableTotals {
  total: number;
  shopee: number;
  lazada: number;
  others: number;
  totalSales: number;
  totalFees: number;
  count: number;
}

export function sumReceivables(rows: MarketplaceReceivableRow[]): ReceivableTotals {
  const totals: ReceivableTotals = {
    total: 0,
    shopee: 0,
    lazada: 0,
    others: 0,
    totalSales: 0,
    totalFees: 0,
    count: rows.length,
  };
  for (const r of rows) {
    totals.total += r.estimatedPayout;
    totals.totalSales += r.totalSales;
    totals.totalFees += r.estimatedFee;
    if (r.sales_channel === "shopee") totals.shopee += r.estimatedPayout;
    else if (r.sales_channel === "lazada") totals.lazada += r.estimatedPayout;
    else totals.others += r.estimatedPayout;
  }
  return totals;
}

export const channelLabel = (c: string) =>
  c === "shopee" ? "Shopee" : c === "lazada" ? "Lazada" : "Others";

export const channelBadgeClass = (c: string) =>
  c === "shopee"
    ? "bg-orange-500/10 text-orange-600"
    : c === "lazada"
      ? "bg-blue-500/10 text-blue-600"
      : "bg-muted text-muted-foreground";
