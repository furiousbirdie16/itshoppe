/**
 * Reading Lazada's account statement transaction export (Finance → Account
 * Statements → export) for the bulk payment upload.
 *
 * Lazada lists every fee on every unit: one "Order Line ID" per unit sold,
 * each with an Item Price Credit and its fees (Commission, Payment Fee, …).
 * Added up per Order Number, those rows give the order's net payout. Rows
 * with no order number (withholding tax, wrong-weight adjustments) are
 * shop-level charges and are kept apart.
 *
 * An order's fees can land in different statements, so an export cut by
 * statement date may hold only an order's late fees. Such an order carries
 * no Item Price Credit row and is marked partial, so it is never taken for
 * the order's whole payout.
 */

export type Cell = string | number | boolean | Date | null | undefined;

const colLetters = (n: number) => {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/**
 * Lazada's export states its sheet size as "A1:A3055" though it fills
 * columns A to S, and the spreadsheet reader trusts that, reading column A
 * only. Work the real size out from the cells themselves and set it.
 */
export function fixSheetRange(ws: Record<string, unknown>): void {
  let maxRow = 0;
  let maxCol = 0;
  for (const key of Object.keys(ws)) {
    const m = /^([A-Z]+)(\d+)$/.exec(key);
    if (!m) continue;
    let c = 0;
    for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
    maxCol = Math.max(maxCol, c - 1);
    maxRow = Math.max(maxRow, Number(m[2]));
  }
  if (maxRow > 0) ws["!ref"] = `A1:${colLetters(maxCol)}${maxRow}`;
}

export interface LazadaOrder {
  orderId: string;
  /** Net of every released row for the order; negative when it cost money. */
  amount: number;
  /** Order Line IDs seen, one per unit sold. */
  units: number;
  /** Statements the order's rows came from. */
  statements: string[];
  /** false when the file has none of the order's Item Price Credit rows. */
  complete: boolean;
  returned: boolean;
}

export interface LazadaShopCharge {
  feeName: string;
  amount: number;
  statement: string;
}

export interface LazadaParse {
  orders: LazadaOrder[];
  /** Released rows with no order number. */
  shopCharges: LazadaShopCharge[];
  /** Rows not yet released to the balance, left out. */
  notReleased: number;
  /** Net of every released row, per statement — matches the wallet ledger. */
  statementTotals: Record<string, number>;
}

const norm = (v: Cell) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Where the header row is, or -1 if this is not the statement export. */
export function lazadaHeaderIndex(sheet: Cell[][]): number {
  return sheet.findIndex((row) => {
    const names = row.map(norm);
    return names.includes("statement number") && names.includes("fee name") && names.includes("order number");
  });
}

export function isLazadaStatement(sheet: Cell[][]): boolean {
  return lazadaHeaderIndex(sheet) >= 0;
}

const toNumber = (v: Cell) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseLazadaStatement(sheet: Cell[][]): LazadaParse {
  const empty: LazadaParse = { orders: [], shopCharges: [], notReleased: 0, statementTotals: {} };
  const h = lazadaHeaderIndex(sheet);
  if (h < 0) return empty;
  const names = sheet[h].map(norm);
  const col = (...options: string[]) => {
    for (const o of options) {
      const i = names.indexOf(o);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iOrder = col("order number");
  const iLine = col("order line id");
  const iFee = col("fee name");
  const iAmount = col("amount include tax", "amount");
  const iStatement = col("statement number");
  const iRelease = col("release status");
  const iStatus = col("order status");
  if (iAmount < 0) return empty;

  type Acc = { orderId: string; amount: number; lines: Set<string>; statements: Set<string>; complete: boolean; returned: boolean };
  const byOrder = new Map<string, Acc>();
  const shopCharges: LazadaShopCharge[] = [];
  const statementTotals: Record<string, number> = {};
  let notReleased = 0;

  for (const row of sheet.slice(h + 1)) {
    if (!row.some((c) => norm(c) !== "")) continue;
    if (iRelease >= 0) {
      const release = norm(row[iRelease]);
      // "Released to My Balance"; anything else ("Not Released", pending) waits.
      if (release && !release.startsWith("released")) { notReleased++; continue; }
    }
    const amount = toNumber(row[iAmount]);
    const statement = String(row[iStatement] ?? "").trim();
    const feeName = String(row[iFee] ?? "").trim();
    if (statement) statementTotals[statement] = round2((statementTotals[statement] ?? 0) + amount);

    const orderId = String(row[iOrder] ?? "").trim();
    if (!orderId || orderId === "-") {
      shopCharges.push({ feeName, amount: round2(amount), statement });
      continue;
    }
    const o = byOrder.get(orderId)
      ?? { orderId, amount: 0, lines: new Set<string>(), statements: new Set<string>(), complete: false, returned: false };
    o.amount = round2(o.amount + amount);
    const line = iLine >= 0 ? String(row[iLine] ?? "").trim() : "";
    if (line) o.lines.add(line);
    if (statement) o.statements.add(statement);
    if (norm(feeName) === "item price credit") o.complete = true;
    if (iStatus >= 0 && norm(row[iStatus]) === "returned") o.returned = true;
    byOrder.set(orderId, o);
  }

  return {
    orders: [...byOrder.values()].map((o) => ({
      orderId: o.orderId,
      amount: o.amount,
      units: o.lines.size,
      statements: [...o.statements].sort(),
      complete: o.complete,
      returned: o.returned,
    })),
    shopCharges,
    notReleased,
    statementTotals,
  };
}
