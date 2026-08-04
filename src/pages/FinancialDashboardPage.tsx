import { useQuery } from "@tanstack/react-query";
import {
  getCashAccounts, getCashTransactions, getOwnerTransactions,
  getPayables, getLoans, getAccountsReceivable,
} from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { peso } from "@/lib/currency";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Wallet, Landmark, PiggyBank, HandCoins, CircleDollarSign, Scale, TrendingUp, AlertTriangle,
} from "lucide-react";
import { format, parse, isValid, differenceInCalendarDays } from "date-fns";
import type { CashAccount, CashTransaction, Payable } from "@/types/database";

const SETTLED: Payable["status"][] = ["paid", "cleared", "cancelled"];

function balanceOf(account: CashAccount, txns: CashTransaction[]) {
  return txns
    .filter((t) => t.account_id === account.id)
    .reduce(
      (sum, t) => sum + (t.direction === "in" ? Number(t.amount || 0) : -Number(t.amount || 0)),
      Number(account.opening_balance || 0),
    );
}

function outstandingOf(p: Payable) {
  if (SETTLED.includes(p.status)) return 0;
  return Math.max(Number(p.amount || 0) - Number(p.amount_paid || 0), 0);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = parse(value, "yyyy-MM-dd", new Date());
  return isValid(d) ? format(d, "MM/dd/yyyy") : "—";
}

export default function FinancialDashboardPage() {
  const { data: accounts = [] } = useQuery({ queryKey: ["cash-accounts"], queryFn: getCashAccounts });
  const { data: txns = [] } = useQuery({ queryKey: ["cash-transactions", "all"], queryFn: () => getCashTransactions() });
  const { data: ownerTxns = [] } = useQuery({ queryKey: ["owner-transactions"], queryFn: getOwnerTransactions });
  const { data: payables = [] } = useQuery({ queryKey: ["payables"], queryFn: getPayables });
  const { data: loans = [] } = useQuery({ queryKey: ["loans"], queryFn: getLoans });
  const { data: receivables = 0 } = useQuery({ queryKey: ["accounts-receivable"], queryFn: () => getAccountsReceivable() });

  const pettyAccounts = accounts.filter((a) => a.account_type === "petty_cash");
  const bankAccounts = accounts.filter((a) => a.account_type === "bank");

  const pettyTotal = pettyAccounts.reduce((s, a) => s + balanceOf(a, txns), 0);
  const bankTotal = bankAccounts.reduce((s, a) => s + balanceOf(a, txns), 0);
  const cashOnHand = pettyTotal + bankTotal;

  const ownerPaid = ownerTxns.filter((t) => t.txn_type === "owner_paid").reduce((s, t) => s + Number(t.amount || 0), 0);
  const ownerRepaid = ownerTxns.filter((t) => t.txn_type === "company_repaid").reduce((s, t) => s + Number(t.amount || 0), 0);
  const ownerBalance = ownerPaid - ownerRepaid;

  const payablesTotal = payables.reduce((s, p) => s + outstandingOf(p), 0);
  const loanPrincipal = loans.reduce((s, l) => s + Number(l.principal_amount || 0), 0);
  const monthlyLoanPayment = loans.reduce((s, l) => s + Number(l.monthly_payment || 0), 0);

  const totalAssets = cashOnHand + Number(receivables || 0);
  const totalLiabilities = payablesTotal + loanPrincipal + Math.max(ownerBalance, 0);
  const netPosition = totalAssets - totalLiabilities;

  // Anything unsettled with a due date, soonest first.
  const upcoming = payables
    .filter((p) => p.due_date && !SETTLED.includes(p.status))
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))
    .slice(0, 8);

  const overdueCount = upcoming.filter((p) => {
    const d = parse(p.due_date!, "yyyy-MM-dd", new Date());
    return isValid(d) && differenceInCalendarDays(d, new Date()) < 0;
  }).length;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Financial Dashboard</h1>
        <p className="page-description">Summary of cash, receivables, payables, loans, and owner balances</p>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard title="Cash on Hand" value={peso(cashOnHand)} icon={Wallet} description="Petty cash + all banks" />
        <StatCard title="Receivables" value={peso(Number(receivables || 0))} icon={CircleDollarSign} description="Unpaid invoices + manual" />
        <StatCard title="Payables" value={peso(payablesTotal)} icon={Landmark} description={`${overdueCount} overdue`} />
        <StatCard title="Net Position" value={peso(netPosition)} icon={Scale} description={netPosition >= 0 ? "Assets exceed liabilities" : "Liabilities exceed assets"} />
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard title="Petty Cash" value={peso(pettyTotal)} icon={Wallet} description="Current balance" />
        <StatCard title="Bank Total" value={peso(bankTotal)} icon={Landmark} description={`${bankAccounts.length} accounts`} />
        <StatCard title="Loans Outstanding" value={peso(loanPrincipal)} icon={PiggyBank} description={`${peso(monthlyLoanPayment)}/mo`} />
        <StatCard title="Owed to Owner" value={peso(ownerBalance)} icon={HandCoins} description={ownerBalance >= 0 ? "Not yet repaid" : "Overpaid"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Account Balances</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Account</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow><TableCell colSpan={3}><div className="empty-state"><Wallet className="empty-state-icon" /><p className="text-sm">No accounts yet</p></div></TableCell></TableRow>
              ) : accounts.map((a) => (
                <TableRow key={a.id} className="hover:bg-muted/30">
                  <TableCell className="text-sm font-medium">{a.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs font-normal">
                      {a.account_type === "petty_cash" ? "Petty Cash" : "Bank"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-right font-medium">{peso(balanceOf(a, txns))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Upcoming Payables</h2>
            {overdueCount > 0 && (
              <Badge variant="destructive" className="text-xs font-normal">
                <AlertTriangle className="h-3 w-3 mr-1" />{overdueCount} overdue
              </Badge>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Payee</TableHead>
                <TableHead className="text-xs">Due</TableHead>
                <TableHead className="text-xs text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {upcoming.length === 0 ? (
                <TableRow><TableCell colSpan={3}><div className="empty-state"><TrendingUp className="empty-state-icon" /><p className="text-sm">Nothing due</p></div></TableCell></TableRow>
              ) : upcoming.map((p) => {
                const d = parse(p.due_date!, "yyyy-MM-dd", new Date());
                const isOverdue = isValid(d) && differenceInCalendarDays(d, new Date()) < 0;
                return (
                  <TableRow key={p.id} className="hover:bg-muted/30">
                    <TableCell className="text-sm font-medium">
                      {p.payee}
                      {p.is_check && <span className="ml-2 text-xs text-muted-foreground">check</span>}
                    </TableCell>
                    <TableCell className={`text-sm ${isOverdue ? "text-destructive" : "text-muted-foreground"}`}>
                      {formatDate(p.due_date)}
                    </TableCell>
                    <TableCell className="text-sm text-right">{peso(outstandingOf(p))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
