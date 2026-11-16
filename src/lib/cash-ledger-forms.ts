/** The starting values of the add/edit boxes on the Bank and Cash pages. */
import { format } from "date-fns";
import { BASE_CURRENCY } from "@/lib/fx";
import type { CashAccount, CashTransaction } from "@/types/database";

const today = () => format(new Date(), "yyyy-MM-dd");

export interface TxnForm {
  account_id: string;
  txn_date: string;
  direction: "in" | "out";
  amount: string;
  category: string;
  payee: string;
  reference: string;
  notes: string;
  fx_rate: string;
}

export const emptyTxnForm = (account_id = ""): TxnForm => ({
  account_id, txn_date: today(), direction: "out",
  amount: "", category: "", payee: "", reference: "", notes: "", fx_rate: "",
});

export function txnFormFrom(t: CashTransaction): TxnForm {
  return {
    account_id: t.account_id,
    txn_date: t.txn_date,
    direction: t.direction,
    amount: String(t.amount ?? ""),
    fx_rate: t.fx_rate == null ? "" : String(t.fx_rate),
    category: t.category || "",
    payee: t.payee || "",
    reference: t.reference || "",
    notes: t.notes || "",
  };
}

export interface AccountForm {
  name: string;
  account_number: string;
  opening_balance: string;
  notes: string;
  currency: string;
}

export const emptyAccountForm = (): AccountForm => ({ name: "", account_number: "", opening_balance: "", notes: "", currency: BASE_CURRENCY });

export function accountFormFrom(a: CashAccount): AccountForm {
  return {
    name: a.name,
    account_number: a.account_number || "",
    opening_balance: String(a.opening_balance ?? ""),
    notes: a.notes || "",
    currency: a.currency || BASE_CURRENCY,
  };
}

/** The category a balance correction is filed under. Not an expense or income: it only fixes the balance. */
export const BALANCE_ADJUSTMENT = "Balance adjustment";

/**
 * The entry that brings an account to the balance typed in its Edit box.
 *
 * The opening balance can change in the same save, which moves the balance by
 * the same amount, so that is allowed for first: the typed figure is what the
 * account ends up showing. Null when nothing needs recording.
 */
export function balanceAdjustment(p: {
  current: number;
  oldOpening: number;
  newOpening: number;
  target: number;
}): { direction: "in" | "out"; amount: number } | null {
  const after = p.current + (p.newOpening - p.oldOpening);
  const diff = Math.round((p.target - after) * 100) / 100;
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.005) return null;
  return { direction: diff > 0 ? "in" : "out", amount: Math.abs(diff) };
}
