/** The fields a running balance needs; anything else on the row is ignored. */
export interface BalanceTxn {
  id: string;
  txn_date: string;
  created_at?: string | null;
  direction: string;
  amount: number | string;
}

/**
 * Balance after each transaction on one account, keyed by transaction id.
 *
 * Only ever for a single account: running a total across several would add up
 * movements that start from different balances. Callers must pass every
 * transaction on the account rather than the filtered view — a balance that
 * skipped the rows above the current date window would be a number that never
 * existed on the statement.
 *
 * Rows are replayed oldest-first, tie-broken on created_at then id so that two
 * transactions on the same date land in a stable order and the sequence does not
 * shuffle between renders.
 */
export function runningBalances(openingBalance: number, txns: BalanceTxn[]): Record<string, number> {
  const ordered = txns.slice().sort((a, b) =>
    a.txn_date.localeCompare(b.txn_date) ||
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
    a.id.localeCompare(b.id),
  );

  const out: Record<string, number> = {};
  let balance = Number(openingBalance || 0);
  for (const t of ordered) {
    balance += t.direction === "in" ? Number(t.amount) : -Number(t.amount);
    out[t.id] = balance;
  }
  return out;
}
