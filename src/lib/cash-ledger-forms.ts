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
