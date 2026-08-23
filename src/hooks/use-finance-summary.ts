import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getCashAccounts, getCashTransactions, getOwnerTransactions,
  getPayables, getLoans, getAccountsReceivable,
} from "@/lib/api";
import { isForeign, fxPosition, foreignAmount } from "@/lib/fx";
import type { CashAccount, CashTransaction, Payable } from "@/types/database";

/** Payable statuses that are settled and no longer outstanding. */
const SETTLED: Payable["status"][] = ["paid", "cleared", "cancelled"];

export function payableOutstanding(p: Payable) {
  if (SETTLED.includes(p.status)) return 0;
  return Math.max(Number(p.amount || 0) - Number(p.amount_paid || 0), 0);
}

function plainBalance(account: CashAccount, txns: CashTransaction[]) {
  return txns
    .filter((t) => t.account_id === account.id)
    .reduce(
      (sum, t) => sum + (t.direction === "in" ? Number(t.amount || 0) : -Number(t.amount || 0)),
      Number(account.opening_balance || 0),
    );
}

/**
 * One source of truth for the finance figures, so the main Dashboard and the
 * Financial Dashboard cannot drift apart.
 *
 * Everything is in PHP: foreign-currency accounts are carried at their weighted
 * average cost (see lib/fx).
 */
export function useFinanceSummary() {
  const { data: allAccounts = [] } = useQuery({ queryKey: ["cash-accounts"], queryFn: getCashAccounts });
  // Active accounts only, as the Cash and Bank pages total. A deactivated
  // account was still counted here, so the Dashboard could claim more cash than
  // the Bank page did — and money in a closed account is not available to spend.
  const accounts = useMemo(() => allAccounts.filter((a) => a.is_active), [allAccounts]);
  const { data: txns = [] } = useQuery({ queryKey: ["cash-transactions", "all"], queryFn: () => getCashTransactions() });
  const { data: ownerTxns = [] } = useQuery({ queryKey: ["owner-transactions"], queryFn: getOwnerTransactions });
  const { data: payables = [] } = useQuery({ queryKey: ["payables"], queryFn: getPayables });
  const { data: loans = [] } = useQuery({ queryKey: ["loans"], queryFn: getLoans });
  const { data: receivables = 0 } = useQuery({ queryKey: ["accounts-receivable"], queryFn: () => getAccountsReceivable() });

  return useMemo(() => {
    const fxByAccount: Record<string, ReturnType<typeof fxPosition>> = {};
    for (const a of accounts) {
      if (isForeign(a)) fxByAccount[a.id] = fxPosition(txns.filter((t) => t.account_id === a.id));
    }
    const phpBalanceOf = (a: CashAccount) =>
      isForeign(a) ? (fxByAccount[a.id]?.phpCost || 0) : plainBalance(a, txns);

    const cashAccounts = accounts.filter((a) => a.account_type === "petty_cash");
    const bankAccounts = accounts.filter((a) => a.account_type === "bank");
    const cashTotal = cashAccounts.reduce((s, a) => s + phpBalanceOf(a), 0);
    const bankTotal = bankAccounts.reduce((s, a) => s + phpBalanceOf(a), 0);

    // How much of each foreign currency is actually held, for the side note.
    const foreignNote = accounts
      .filter(isForeign)
      .map((a) => ({ account: a, ...(fxByAccount[a.id] || { quantity: 0, averageRate: 0 }) }))
      .filter((h) => h.quantity > 0)
      .map((h) => `${foreignAmount(h.quantity, h.account.currency)} @ ${h.averageRate.toFixed(2)}`)
      .join(" · ");

    const ownerPaid = ownerTxns.filter((t) => t.txn_type === "owner_paid").reduce((s, t) => s + Number(t.amount || 0), 0);
    const ownerRepaid = ownerTxns.filter((t) => t.txn_type === "company_repaid").reduce((s, t) => s + Number(t.amount || 0), 0);

    const billsAndChecks = payables.reduce((s, p) => s + payableOutstanding(p), 0);

    return {
      accounts,
      txns,
      payables,
      loans,
      fxByAccount,
      phpBalanceOf,
      cashAccounts,
      bankAccounts,
      cashTotal,
      bankTotal,
      /** Cash + every bank account, in PHP. */
      totalCashAvailable: cashTotal + bankTotal,
      foreignNote,
      receivables: Number(receivables || 0),
      /** Net still owed to the owner; negative means the owner was overpaid. */
      dueToOwner: ownerPaid - ownerRepaid,
      /** Outstanding bills and post-dated checks — NOT supplier purchase orders. */
      billsAndChecks,
      loansOutstanding: loans.reduce((s, l) => s + Number(l.principal_amount || 0), 0),
      monthlyLoanPayment: loans.reduce((s, l) => s + Number(l.monthly_payment || 0), 0),
    };
  }, [accounts, txns, ownerTxns, payables, loans, receivables]);
}
