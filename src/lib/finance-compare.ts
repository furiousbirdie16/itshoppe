/**
 * Why Free to spend or Net Asset Value moved: the same figures then and now,
 * line by line, each with the effect it had on the total. The lines always add
 * up to the change, because both totals are worked out from them.
 */

export interface FinanceFigures {
  inventory: number;
  reserved: number;
  receivables: number;
  incoming: number;
  cash: number;
  supplierPos: number;
  billsOwedNow: number;
  billsDueSoon: number;
  /** Positive: the company owes the owner. Negative: the owner owes the company. */
  dueToOwner: number;
  loans: number;
}

export interface FinanceSnapshot extends FinanceFigures {
  date: string;
  capturedAt: string;
  /** From the older chart snapshots, which were worked out differently. */
  approximate: boolean;
}

export type FinanceMetric = "free" | "nav";
export type LineKey = keyof FinanceFigures;

export interface ChangeLine {
  key: LineKey;
  label: string;
  then: number;
  now: number;
  /** What this line did to the total: positive helped, negative hurt. */
  effect: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function freeToSpend(f: FinanceFigures): number {
  return f.cash - f.supplierPos - f.billsDueSoon;
}

export function netAssetValue(f: FinanceFigures): number {
  return f.inventory + f.reserved + f.receivables + f.incoming + f.cash - f.billsOwedNow - f.dueToOwner - f.loans;
}

export const metricValue = (m: FinanceMetric, f: FinanceFigures) => (m === "free" ? freeToSpend(f) : netAssetValue(f));

/** sign: +1 counts for the total, −1 against it. */
const LINES: Record<FinanceMetric, { key: LineKey; label: string; sign: 1 | -1 }[]> = {
  free: [
    { key: "cash", label: "Cash and bank", sign: 1 },
    { key: "supplierPos", label: "Supplier POs owed", sign: -1 },
    { key: "billsDueSoon", label: "Bills & checks due in 30 days", sign: -1 },
  ],
  nav: [
    { key: "inventory", label: "Inventory", sign: 1 },
    { key: "reserved", label: "Reserved stock", sign: 1 },
    { key: "receivables", label: "Customer receivables", sign: 1 },
    { key: "incoming", label: "Incoming goods", sign: 1 },
    { key: "cash", label: "Cash and bank", sign: 1 },
    { key: "billsOwedNow", label: "Bills & checks owed", sign: -1 },
    { key: "dueToOwner", label: "Owner's account (owed to owner)", sign: -1 },
    { key: "loans", label: "Loans", sign: -1 },
  ],
};

export function changeLines(metric: FinanceMetric, then: FinanceFigures, now: FinanceFigures): ChangeLine[] {
  return LINES[metric].map(({ key, label, sign }) => ({
    key,
    label,
    then: then[key],
    now: now[key],
    effect: round2(sign * (now[key] - then[key])),
  }));
}

const dayOffset = (today: string, days: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/**
 * The record to compare with for "N days ago": that day's, else the nearest
 * before it, else the earliest there is. Snapshots oldest first.
 */
export function snapshotForDaysAgo<S extends { date: string }>(snapshots: S[], today: string, days: number): S | null {
  if (snapshots.length === 0) return null;
  const target = dayOffset(today, days);
  let found: S | null = null;
  for (const s of snapshots) if (s.date <= target) found = s;
  return found ?? snapshots[0];
}
