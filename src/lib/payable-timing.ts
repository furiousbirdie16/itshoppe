import { endOfMonth, addDays, parseISO } from "date-fns";

/**
 * When a payable counts against net worth and spendable cash.
 *
 * Most payables are owed the moment they exist: a supplier check for goods
 * already received is a debt now, whatever date is on it. Some are not — a
 * year of post-dated rent checks is twelve months of rent, of which only the
 * current month is owed. Payables in the categories listed (Rent, by default)
 * count toward Net Asset Value only once due by the end of this month, and
 * against spendable cash only once due within 30 days. Undated ones count.
 */

export const DEFAULT_DEFERRED_CATEGORIES = ["Rent"];
export const CASH_WINDOW_DAYS = 30;

export interface PayableLike {
  category: string | null;
  due_date: string | null;
  /** What is still owed on it; 0 when settled. */
  outstanding: number;
}

export interface PayableTiming {
  /** Counted as owed now, for Net Asset Value. */
  owedNow: number;
  /** Counted against cash: everything owed now except deferred ones due after the cash window. */
  dueSoon: number;
  /** Deferred-category payables dated after this month: not yet counted. */
  later: number;
  /** Deferred-category payables dated beyond the cash window. */
  laterForCash: number;
}

const key = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

export function payableTiming(payables: PayableLike[], deferredCategories: string[], today: Date): PayableTiming {
  const deferred = new Set(deferredCategories.map(key).filter(Boolean));
  const monthEnd = endOfMonth(today);
  const cashEnd = addDays(today, CASH_WINDOW_DAYS);
  const out: PayableTiming = { owedNow: 0, dueSoon: 0, later: 0, laterForCash: 0 };
  for (const p of payables) {
    const amt = Number(p.outstanding || 0);
    if (amt <= 0) continue;
    const due = p.due_date ? parseISO(p.due_date) : null;
    if (!deferred.has(key(p.category)) || !due) {
      out.owedNow += amt;
      out.dueSoon += amt;
      continue;
    }
    if (due <= monthEnd) out.owedNow += amt; else out.later += amt;
    if (due <= cashEnd) out.dueSoon += amt; else out.laterForCash += amt;
  }
  return out;
}
