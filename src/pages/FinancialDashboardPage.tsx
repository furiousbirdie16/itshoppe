import { useFinanceSummary } from "@/hooks/use-finance-summary";
import { StatCard } from "@/components/StatCard";
import { peso } from "@/lib/currency";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Wallet, Landmark, PiggyBank, HandCoins, CircleDollarSign, Scale, TrendingUp, AlertTriangle,
} from "lucide-react";
import { format, parse, isValid, differenceInCalendarDays } from "date-fns";
import type { CashAccount, CashTransaction, Payable } from "@/types/database";
import { isForeign, fxPosition, foreignAmount, BASE_CURRENCY } from "@/lib/fx";

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
  const {
    accounts, txns, payables, fxByAccount, phpBalanceOf,
    cashAccounts, bankAccounts, cashTotal, bankTotal, foreignNote,
    receivables, dueToOwner, billsAndChecks, loansOutstanding, monthlyLoanPayment,
  } = useFinanceSummary();

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

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
        <StatCard title="Cash" value={peso(cashTotal)} icon={Wallet} tone="asset" description={`${cashAccounts.length} account${cashAccounts.length === 1 ? "" : "s"}`} />
        <StatCard title="Bank Total" value={peso(bankTotal)} icon={Landmark} tone="asset" description={foreignNote ? `incl. ${foreignNote}` : `${bankAccounts.length} account${bankAccounts.length === 1 ? "" : "s"}`} />
        <StatCard title="Receivables" value={peso(receivables)} icon={CircleDollarSign} tone="asset" description="Unpaid invoices + manual" />
        <StatCard title="Loans Outstanding" value={peso(loansOutstanding)} icon={PiggyBank} tone="liability" description={`${peso(monthlyLoanPayment)}/mo`} />
        <StatCard title="Due to Owner" value={peso(dueToOwner)} icon={HandCoins} tone="liability" description={dueToOwner >= 0 ? "Not yet repaid" : "Overpaid"} />
        <StatCard title="Payables" value={peso(billsAndChecks)} icon={Landmark} tone="liability" description={`Bills & checks · ${overdueCount} overdue`} />
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
                  <TableCell className="text-sm font-medium">
                    {a.name}
                    {isForeign(a) && (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {foreignAmount(fxByAccount[a.id]?.quantity || 0, a.currency)}
                        {" @ "}{(fxByAccount[a.id]?.averageRate || 0).toFixed(2)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs font-normal">
                      {isForeign(a) ? a.currency : a.account_type === "petty_cash" ? "Cash" : "Bank"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-right font-medium">{peso(phpBalanceOf(a))}</TableCell>
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
