import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getLoans, createLoan, updateLoan, deleteLoan,
  getLoanPayments, createLoanPayment, deleteLoanPayment, getCashAccounts,
} from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/DateField";
import { StatCard } from "@/components/StatCard";
import { FinanceMobileCard } from "@/components/FinanceMobileCard";
import { Plus, Pencil, Trash2, PiggyBank, Search, Wallet, Percent, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { format, parse, isValid, differenceInCalendarDays } from "date-fns";
import { peso } from "@/lib/currency";
import type { Loan, LoanPayment } from "@/types/database";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

const emptyForm = { lender: "", principal_amount: "", interest_rate: "", due_date: "", notes: "" };

// Radix Select cannot hold an empty string, so "no account" needs a sentinel.
const NO_ACCOUNT = "none";

// Interest-only: the monthly payment covers interest, principal stays outstanding.
function monthlyInterest(principal: number, annualRate: number) {
  if (!principal || !annualRate) return 0;
  return (principal * (annualRate / 100)) / 12;
}

function formatDueDate(value: string | null) {
  if (!value) return "—";
  const d = parse(value, "yyyy-MM-dd", new Date());
  return isValid(d) ? format(d, "MM/dd/yyyy") : "—";
}

export default function LoansPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");

  const { data: loans = [], isLoading } = useQuery({ queryKey: ["loans"], queryFn: getLoans });
  const { data: payments = [] } = useQuery({ queryKey: ["loan-payments"], queryFn: getLoanPayments });
  const { data: allAccounts = [] } = useQuery({ queryKey: ["cash-accounts"], queryFn: getCashAccounts });
  // Interest is paid from real money, so the owner account is not an option.
  const payableAccounts = allAccounts.filter((a) => a.is_active && a.account_type !== "owner");

  // ---- Interest payments ----
  const [payLoan, setPayLoan] = useState<Loan | null>(null);
  const [payForm, setPayForm] = useState({ payment_date: "", amount: "", cash_account_id: "", notes: "" });

  const paymentsByLoan = useMemo(() => {
    const map = new Map<string, LoanPayment[]>();
    for (const p of payments) {
      const list = map.get(p.loan_id) || [];
      list.push(p);
      map.set(p.loan_id, list);
    }
    return map;
  }, [payments]);

  const interestPaidFor = (loanId: string) =>
    (paymentsByLoan.get(loanId) || []).reduce((s, p) => s + Number(p.amount || 0), 0);

  // Paying interest moves money, so the Cash and Bank views have to refetch or
  // their balances go stale behind this page.
  const invalidatePayments = () => {
    queryClient.invalidateQueries({ queryKey: ["loan-payments"] });
    queryClient.invalidateQueries({ queryKey: ["cash-transactions"] });
    queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
  };

  const payCreateMut = useMutation({
    mutationFn: (data: Partial<LoanPayment>) => createLoanPayment(data),
    onSuccess: () => { invalidatePayments(); setPayLoan(null); toast.success("Interest payment recorded"); },
    onError: (e: any) => toast.error(e?.message || "Failed to record payment"),
  });
  const payDeleteMut = useMutation({
    mutationFn: deleteLoanPayment,
    onSuccess: () => { invalidatePayments(); toast.success("Payment removed"); },
    onError: (e: any) => toast.error(e?.message || "Failed to remove payment"),
  });

  const openPayDialog = (loan: Loan) => {
    setPayLoan(loan);
    setPayForm({
      payment_date: format(new Date(), "yyyy-MM-dd"),
      // Seeded with this loan's monthly interest — the usual amount, still editable.
      amount: String(Math.round(monthlyInterest(Number(loan.principal_amount), Number(loan.interest_rate)) * 100) / 100 || ""),
      cash_account_id: "",
      notes: "",
    });
  };

  const submitPayment = () => {
    if (!payLoan) return;
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) { toast.error("Enter an amount greater than zero"); return; }
    if (!payForm.payment_date) { toast.error("Pick the date it was paid"); return; }
    payCreateMut.mutate({
      loan_id: payLoan.id,
      payment_date: payForm.payment_date,
      amount,
      cash_account_id: payForm.cash_account_id || null,
      notes: payForm.notes,
    });
  };

  const filtered = loans.filter((loan) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [loan.lender, loan.notes].some((value) => (value || "").toLowerCase().includes(q));
  });

  const { sort, toggle, sorted: sortedLoans } = useSort<Loan>(filtered, {
    lender: (r) => r.lender,
    principal_amount: (r) => r.principal_amount,
    interest_rate: (r) => r.interest_rate,
    monthly_payment: (r) => r.monthly_payment,
    due_date: (r) => r.due_date || "",
  });

  const totalPrincipal = loans.reduce((sum, l) => sum + Number(l.principal_amount || 0), 0);
  const totalMonthlyPayment = loans.reduce((sum, l) => sum + Number(l.monthly_payment || 0), 0);
  const avgInterestRate = loans.length ? loans.reduce((sum, l) => sum + Number(l.interest_rate || 0), 0) / loans.length : 0;
  const nextDue = loans
    .filter((l) => l.due_date)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0];
  const nextDueDescription = nextDue
    ? (() => {
        const d = parse(nextDue.due_date!, "yyyy-MM-dd", new Date());
        if (!isValid(d)) return "—";
        const days = differenceInCalendarDays(d, new Date());
        return days < 0 ? `${nextDue.lender} — overdue` : `${nextDue.lender} — in ${days}d`;
      })()
    : "No upcoming due dates";

  const createMut = useMutation({
    mutationFn: (data: Partial<Loan>) => createLoan(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["loans"] }); setOpen(false); toast.success("Loan added"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Loan> }) => updateLoan(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["loans"] }); setOpen(false); setEditing(null); toast.success("Loan updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteLoan,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["loans"] }); toast.success("Loan deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (l: Loan) => {
    setEditing(l);
    setForm({
      lender: l.lender,
      principal_amount: String(l.principal_amount ?? ""),
      interest_rate: String(l.interest_rate ?? ""),
      due_date: l.due_date || "",
      notes: l.notes || "",
    });
    setOpen(true);
  };

  const computedMonthlyPayment = useMemo(
    () => monthlyInterest(Number(form.principal_amount) || 0, Number(form.interest_rate) || 0),
    [form.principal_amount, form.interest_rate],
  );

  const handleSubmit = () => {
    if (!form.lender.trim()) { toast.error("Lender / loan name is required"); return; }
    const data: Partial<Loan> = {
      lender: form.lender.trim(),
      principal_amount: Number(form.principal_amount) || 0,
      interest_rate: Number(form.interest_rate) || 0,
      monthly_payment: computedMonthlyPayment,
      due_date: form.due_date || null,
      notes: form.notes,
    };
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Loans</h1>
          <p className="page-description">{filtered.length} loan{filtered.length !== 1 ? "s" : ""}{filtered.length !== loans.length ? ` (filtered from ${loans.length})` : ""}</p>
        </div>
        <div className="toolbar-actions">
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> Add Loan
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Principal" value={peso(totalPrincipal)} icon={PiggyBank} description="Across all loans" />
        <StatCard title="Total Monthly Payment" value={peso(totalMonthlyPayment)} icon={Wallet} description="Combined monthly obligation" />
        <StatCard title="Avg. Interest Rate" value={`${avgInterestRate.toFixed(2)}%`} icon={Percent} description="Simple average" />
        <StatCard title="Next Due" value={nextDue ? formatDueDate(nextDue.due_date) : "—"} icon={CalendarClock} description={nextDueDescription} />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search loans..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Loan" : "New Loan"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Lender / Loan Name *</Label>
              <Input value={form.lender} onChange={e => setForm({ ...form, lender: e.target.value })} className="h-9" placeholder="e.g. BDO, Metrobank, Owner Loan" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Principal Amount</Label>
                <Input type="number" step="0.01" min="0" value={form.principal_amount} onChange={e => setForm({ ...form, principal_amount: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Interest Rate (%)</Label>
                <Input type="number" step="0.01" min="0" value={form.interest_rate} onChange={e => setForm({ ...form, interest_rate: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Monthly Payment</Label>
                <Input readOnly tabIndex={-1} value={peso(computedMonthlyPayment)} className="h-9 bg-muted text-muted-foreground" />
                <p className="text-[11px] text-muted-foreground">Interest-only, calculated automatically</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Due Date</Label>
                <DateField value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} placeholder="Optional" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} className="rounded-lg h-9">{editing ? "Save Changes" : "Add Loan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phones get stacked cards rather than a six-column horizontal scroll. */}
      <div className="md:hidden space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedLoans.length === 0 ? (
          <div className="rounded-xl border bg-card">
            <div className="empty-state"><PiggyBank className="empty-state-icon" /><p className="text-sm">No loans yet</p></div>
          </div>
        ) : (
          sortedLoans.map((l) => (
            <FinanceMobileCard
              key={l.id}
              title={l.lender}
              subtitle={`${peso(Number(l.monthly_payment))}/mo · ${Number(l.interest_rate).toFixed(2)}%`}
              amount={peso(Number(l.principal_amount))}
              amountSub="principal"
              meta={
                <>
                  <span>Due {formatDueDate(l.due_date)}</span>
                  {interestPaidFor(l.id) > 0 && <span>· {peso(interestPaidFor(l.id))} interest paid</span>}
                </>
              }
              actions={
                <>
                  <Button variant="ghost" size="icon" onClick={() => openPayDialog(l)} className="h-8 w-8 rounded-md" aria-label="Record interest payment">
                    <Percent className="h-3.5 w-3.5 text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(l)} className="h-8 w-8 rounded-md" aria-label="Edit">
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(l.id)} className="h-8 w-8 rounded-md" aria-label="Delete">
                    <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                  </Button>
                </>
              }
            />
          ))
        )}
      </div>

      <div className="data-table-wrapper hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader sortKey="lender" label="Lender" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="principal_amount" label="Principal" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="interest_rate" label="Interest Rate" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="monthly_payment" label="Monthly Payment" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="due_date" label="Due Date" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs text-right">Interest Paid</TableHead>
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : sortedLoans.length === 0 ? (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><PiggyBank className="empty-state-icon" /><p className="text-sm">No loans yet</p></div></TableCell></TableRow>
            ) : sortedLoans.map(l => (
              <TableRow key={l.id} className="hover:bg-muted/30">
                <TableCell className="font-medium text-sm">{l.lender}</TableCell>
                <TableCell className="text-sm text-right">{peso(Number(l.principal_amount))}</TableCell>
                <TableCell className="text-sm text-right">{Number(l.interest_rate).toFixed(2)}%</TableCell>
                <TableCell className="text-sm text-right">{peso(Number(l.monthly_payment))}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDueDate(l.due_date)}</TableCell>
                <TableCell className="text-sm text-right tabular-nums">
                  {interestPaidFor(l.id) > 0 ? peso(interestPaidFor(l.id)) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openPayDialog(l)} className="h-7 w-7 rounded-md" title="Record interest payment"><Percent className="h-3.5 w-3.5 text-primary" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(l)} className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(l.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!payLoan} onOpenChange={(v) => { if (!v) setPayLoan(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Interest payment — {payLoan?.lender}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date Paid *</Label>
                <DateField value={payForm.payment_date} onChange={(v) => setPayForm({ ...payForm, payment_date: v })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Amount *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Paid From</Label>
              <Select
                value={payForm.cash_account_id || NO_ACCOUNT}
                onValueChange={(v) => setPayForm({ ...payForm, cash_account_id: v === NO_ACCOUNT ? "" : v })}
              >
                <SelectTrigger className="h-9"><SelectValue placeholder="No account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ACCOUNT}>No account — don't touch balances</SelectItem>
                  {payableAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{a.account_type === "bank" ? "" : " (cash)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {payForm.cash_account_id
                  ? "Recording this withdraws the interest from this account."
                  : "Without an account, this is recorded against the loan only."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className="resize-none" rows={2} />
            </div>

            {payLoan && (paymentsByLoan.get(payLoan.id) || []).length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Paid so far — {peso(interestPaidFor(payLoan.id))}
                </Label>
                <div className="max-h-[160px] overflow-auto rounded-lg border divide-y">
                  {(paymentsByLoan.get(payLoan.id) || []).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground">{p.payment_date}</span>
                      <span className="tabular-nums font-medium">{peso(Number(p.amount))}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md shrink-0"
                        aria-label="Remove payment"
                        onClick={() => payDeleteMut.mutate(p.id)}
                      >
                        <Trash2 className="h-3 w-3 text-destructive/70" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayLoan(null)}>Cancel</Button>
            <Button onClick={submitPayment} disabled={payCreateMut.isPending} className="rounded-lg h-9">
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
