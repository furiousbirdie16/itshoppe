import type { CashAccount, CashTransaction } from "@/types/database";

export const BASE_CURRENCY = "PHP";

export const isForeign = (account: Pick<CashAccount, "currency">) =>
  (account.currency || BASE_CURRENCY) !== BASE_CURRENCY;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface FxState {
  /** Units of the foreign currency still held. */
  quantity: number;
  /** PHP those units cost, at the rounded average. */
  phpCost: number;
  /** Weighted average PHP paid per unit, rounded to 2 decimals. */
  averageRate: number;
}

export interface FxStep extends FxState {
  transaction: CashTransaction;
  /** PHP value of this single movement. */
  phpAmount: number;
}

/**
 * Replays a foreign-currency account's transactions oldest-first, maintaining a
 * weighted-average cost.
 *
 * Inflows add units at the rate paid; outflows are valued at the average in force
 * at that moment. The average is re-rounded to 2 decimals after every event and the
 * running cost re-based onto it, so the displayed rate and the displayed PHP value
 * always agree.
 *
 * Worked example:
 *   +1000 @ 9.00  -> 1000 units, avg 9.00
 *   +1000 @ 9.10  -> 2000 units, avg 9.05
 *   -500          -> 1500 units at 9.05 (₱4,525 consumed)
 *   +2000 @ 9.20  -> 3500 units, avg 9.14
 */
export function replayFx(transactions: CashTransaction[]): FxStep[] {
  // Oldest first; created_at breaks ties within a day.
  const ordered = [...transactions].sort((a, b) => {
    if (a.txn_date !== b.txn_date) return a.txn_date < b.txn_date ? -1 : 1;
    return (a.created_at || "") < (b.created_at || "") ? -1 : 1;
  });

  let quantity = 0;
  let phpCost = 0;
  let averageRate = 0;
  const steps: FxStep[] = [];

  for (const transaction of ordered) {
    const units = Number(transaction.amount || 0);
    let phpAmount = 0;

    if (transaction.direction === "in") {
      // Fall back to the running average when a rate is missing, so a legacy or
      // half-filled row cannot corrupt the series.
      const rate = Number(transaction.fx_rate || 0) || averageRate;
      phpAmount = round2(units * rate);
      quantity += units;
      phpCost += phpAmount;
    } else {
      phpAmount = round2(units * averageRate);
      quantity -= units;
      phpCost -= phpAmount;
    }

    if (quantity <= 0) {
      // Drained exactly: keep the rate for reference. Overdrawn: the series is
      // broken, so reset rather than carry a nonsense average.
      const overdrawn = quantity < 0;
      quantity = 0;
      phpCost = 0;
      if (overdrawn) averageRate = 0;
    } else {
      // Full precision is kept internally so rounding cannot accumulate across
      // hundreds of movements; averageRate is the 2-decimal figure to display.
      averageRate = round2(phpCost / quantity);
    }

    steps.push({ transaction, phpAmount, quantity, phpCost, averageRate });
  }

  return steps;
}

/** Final position of a foreign-currency account. */
export function fxPosition(transactions: CashTransaction[]): FxState {
  const steps = replayFx(transactions);
  const last = steps[steps.length - 1];
  return last
    ? { quantity: last.quantity, phpCost: last.phpCost, averageRate: last.averageRate }
    : { quantity: 0, phpCost: 0, averageRate: 0 };
}

/** PHP value of each transaction, keyed by id, for rendering a ledger row. */
export function fxPhpAmountById(transactions: CashTransaction[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const step of replayFx(transactions)) out[step.transaction.id] = step.phpAmount;
  return out;
}

/** Formats a foreign amount, e.g. "¥1,200.00" — falls back to the code itself. */
const SYMBOLS: Record<string, string> = { RMB: "¥", CNY: "¥", USD: "$", HKD: "HK$", EUR: "€" };

export function foreignAmount(value: number, currency: string) {
  const symbol = SYMBOLS[currency] || `${currency} `;
  return `${symbol}${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
