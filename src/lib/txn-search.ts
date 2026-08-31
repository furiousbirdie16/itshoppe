/** The fields a ledger search looks at. */
export interface SearchableTxn {
  category?: string | null;
  payee?: string | null;
  reference?: string | null;
  notes?: string | null;
  amount?: number | string | null;
}

/**
 * Whether a transaction matches what was typed into the ledger search.
 *
 * Text fields match on a substring, as you would expect. Amounts match too —
 * typing a figure you remember is the obvious way to find a transaction, and it
 * used to return nothing at all.
 *
 * The amount query is stripped of the punctuation people type amounts with
 * ("₱1,500" and "1500" are the same search) and matched against both the plain
 * and two-decimal forms, so 1500 is found by "1500" and by "1500.00".
 * Deliberately a substring match, not equality: half-remembered figures are the
 * point, so "1500" also finds 21,500.
 */
export function matchesTransactionSearch(txn: SearchableTxn, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const text = [txn.category, txn.payee, txn.reference, txn.notes];
  if (text.some((v) => (v || "").toLowerCase().includes(q))) return true;

  const numeric = q.replace(/[₱,\s]/g, "");
  // Anything that is not a bare number is a text search that already missed.
  if (!numeric || !/^\d*\.?\d*$/.test(numeric)) return false;

  const amount = Number(txn.amount || 0);
  return String(amount).includes(numeric) || amount.toFixed(2).includes(numeric);
}
