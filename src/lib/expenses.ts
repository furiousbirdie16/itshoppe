/**
 * Company expenses, worked out from the books rather than kept separately.
 *
 * An expense is money out of any account (bank, cash or the owner) under a
 * category marked as an expense. A transfer between accounts is never one,
 * which is what keeps repaying the owner for a credit-card charge from
 * counting that charge twice. A paid payable is counted through the withdrawal
 * that paying it records, on the day it was marked paid.
 */

export interface ExpenseCategory {
  id: string;
  name: string;
  is_expense: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface ExpenseTxn {
  id: string;
  txn_date: string;
  direction: "in" | "out";
  category: string | null;
  transfer_group_id?: string | null;
  /** The peso amount: the amount itself, or its PHP value on a foreign account. */
  php: number;
}

/** How a category is matched: case and surrounding spaces do not matter. */
export const categoryKey = (name: string | null | undefined) => String(name ?? "").trim().toLowerCase();

/** "2026-11" for a date. */
export const periodOf = (date: string) => date.slice(0, 7);

/** The last `n` months ending with `end` ("YYYY-MM"), oldest first. */
export function monthsEnding(end: string, n: number): string[] {
  const [y, m] = end.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** The categories that count, by key, to their display name. */
export function expenseCategoryNames(categories: Pick<ExpenseCategory, "name" | "is_expense">[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of categories) if (c.is_expense) out.set(categoryKey(c.name), c.name);
  return out;
}

/** Money out that is not a transfer between accounts. */
export const isOutflow = (t: Pick<ExpenseTxn, "direction" | "transfer_group_id">) =>
  t.direction === "out" && !t.transfer_group_id;

export function isExpense(t: ExpenseTxn, counted: Map<string, string>): boolean {
  return isOutflow(t) && counted.has(categoryKey(t.category));
}

export interface ExpenseSummary {
  /** Category display name → month → total. Only categories with spending. */
  byCategory: Map<string, Record<string, number>>;
  /** Month → total of every category. */
  totals: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summariseExpenses(txns: ExpenseTxn[], categories: ExpenseCategory[], months: string[]): ExpenseSummary {
  const counted = expenseCategoryNames(categories);
  const inRange = new Set(months);
  const byCategory = new Map<string, Record<string, number>>();
  const totals: Record<string, number> = Object.fromEntries(months.map((m) => [m, 0]));
  for (const t of txns) {
    if (!isExpense(t, counted)) continue;
    const month = periodOf(t.txn_date);
    if (!inRange.has(month)) continue;
    const name = counted.get(categoryKey(t.category))!;
    const row = byCategory.get(name) ?? Object.fromEntries(months.map((m) => [m, 0]));
    row[month] = round2(row[month] + t.php);
    byCategory.set(name, row);
    totals[month] = round2(totals[month] + t.php);
  }
  return { byCategory, totals };
}

/**
 * Money out in a month that is not being counted: no category, or one not
 * marked as an expense. Shown so a mis-filed bill is noticed rather than
 * silently left out of the month.
 */
export function uncountedOutflows(
  txns: ExpenseTxn[],
  categories: ExpenseCategory[],
  month: string,
): { category: string; total: number; count: number }[] {
  const counted = expenseCategoryNames(categories);
  const groups = new Map<string, { category: string; total: number; count: number }>();
  for (const t of txns) {
    if (!isOutflow(t) || periodOf(t.txn_date) !== month) continue;
    const key = categoryKey(t.category);
    if (counted.has(key)) continue;
    const g = groups.get(key) ?? { category: (t.category || "").trim(), total: 0, count: 0 };
    g.total = round2(g.total + t.php);
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

/** Percent change from one month to the next; null when there is nothing to compare with. */
export function changePct(previous: number, current: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Recurring bills.
// ---------------------------------------------------------------------------

/** The day a bill falls due in a month: the 31st is the 30th in November. */
export function dueDateIn(dayOfMonth: number, period: string): string {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Math.floor(dayOfMonth)), last);
  return `${period}-${String(day).padStart(2, "0")}`;
}

export type RecurringState = "paid" | "skipped" | "due" | "upcoming";

export function recurringState(args: {
  dayOfMonth: number;
  period: string;
  today: string;
  paid: boolean;
  skipped: boolean;
}): RecurringState {
  if (args.paid) return "paid";
  if (args.skipped) return "skipped";
  return dueDateIn(args.dayOfMonth, args.period) <= args.today ? "due" : "upcoming";
}
