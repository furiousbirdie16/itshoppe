/**
 * Reading Shopee's balance transaction report (My Balance → Transaction
 * Report) for the bulk payment upload.
 *
 * The report opens with an account summary; the transactions table starts
 * further down under a "Date | Transaction Type | Description | Order ID |
 * Money Direction | Amount | Status | …" header. Only rows with an Order ID
 * are used — withdrawals carry "-" and are not order payments.
 *
 * An order can have more than one row (its income, and later an adjustment
 * when a refund is taken back), so amounts are added up per order.
 */

export type Cell = string | number | boolean | Date | null | undefined;

export interface BalanceOrder {
  orderId: string;
  /** Net of every row for the order; negative when the order cost money. */
  amount: number;
  /** Sum of the rows that were not plain order income (refund adjustments). */
  adjustments: number;
  rows: number;
}

export interface BalanceParse {
  orders: BalanceOrder[];
  /** Rows with an order ID that are not completed yet, left out. */
  notCompleted: number;
}

const norm = (v: Cell) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Where the transactions table's header row is, or -1 if this is not the report. */
export function balanceHeaderIndex(sheet: Cell[][]): number {
  return sheet.findIndex((row) => {
    const names = row.map(norm);
    return names.includes("order id") && names.includes("amount") && names.includes("transaction type");
  });
}

export function isShopeeBalanceReport(sheet: Cell[][]): boolean {
  return balanceHeaderIndex(sheet) >= 0;
}

const toNumber = (v: Cell) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseShopeeBalanceReport(sheet: Cell[][]): BalanceParse {
  const h = balanceHeaderIndex(sheet);
  if (h < 0) return { orders: [], notCompleted: 0 };
  const names = sheet[h].map(norm);
  const col = (name: string) => names.indexOf(name);
  const iOrder = col("order id");
  const iAmount = col("amount");
  const iType = col("transaction type");
  const iStatus = col("status");

  const byOrder = new Map<string, BalanceOrder>();
  let notCompleted = 0;
  for (const row of sheet.slice(h + 1)) {
    const orderId = String(row[iOrder] ?? "").trim();
    if (!orderId || orderId === "-") continue;
    if (iStatus >= 0) {
      const status = norm(row[iStatus]);
      if (status && !status.includes("completed")) { notCompleted++; continue; }
    }
    const amount = toNumber(row[iAmount]);
    const isIncome = norm(row[iType]) === "order income";
    const o = byOrder.get(orderId) ?? { orderId, amount: 0, adjustments: 0, rows: 0 };
    o.amount = round2(o.amount + amount);
    if (!isIncome) o.adjustments = round2(o.adjustments + amount);
    o.rows++;
    byOrder.set(orderId, o);
  }
  return { orders: [...byOrder.values()], notCompleted };
}
