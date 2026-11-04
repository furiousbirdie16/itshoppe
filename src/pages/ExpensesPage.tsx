import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Receipt, TrendingDown, CalendarClock, Tags, Repeat, Plus, Pencil, Trash2, CheckCircle2, Undo2, SkipForward, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/StatCard";
import { DateField } from "@/components/DateField";
import { CategorySelect } from "@/components/CategorySelect";
import { getCashAccounts } from "@/lib/api";
import {
  EXPENSE_CATEGORIES_KEY, getExpenseCategories, createExpenseCategory, updateExpenseCategory,
  renameExpenseCategory, mergeExpenseCategory, getOutflows, getRecurringExpenses, saveRecurringExpense,
  deleteRecurringExpense, getRecurringSkips, skipRecurring, unskipRecurring, payRecurring,
  getRecurringPayments, setTransactionCategory, type ExpenseRow, type RecurringExpense,
} from "@/lib/expenses-api";
import {
  summariseExpenses, uncountedOutflows, monthsEnding, changePct, dueDateIn, recurringState,
  expenseCategoryNames, categoryKey, isExpense, type ExpenseCategory,
} from "@/lib/expenses";
import { isForeign } from "@/lib/fx";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { CashAccount } from "@/types/database";

/** Months shown side by side, ending with the one picked. */
const MONTHS_SHOWN = 6;

const monthLabel = (period: string, long = false) => {
  const [y, m] = period.split("-").map(Number);
  return format(new Date(y, m - 1, 1), long ? "MMMM yyyy" : "MMM yy");
};
const lastDayOf = (period: string) => dueDateIn(31, period);
const todayIso = () => format(new Date(), "yyyy-MM-dd");
const accountLabel = (a: Pick<CashAccount, "name" | "account_type">) => (a.account_type === "owner" ? "Owner (paid personally)" : a.name);

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(() => todayIso().slice(0, 7));
  const months = useMemo(() => monthsEnding(period, MONTHS_SHOWN), [period]);
  const prevPeriod = months[months.length - 2];
  const fromDate = `${months[0]}-01`;
  const toDate = lastDayOf(period);

  const [drill, setDrill] = useState<{ title: string; rows: ExpenseRow[] } | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [paying, setPaying] = useState<RecurringExpense | null>(null);

  const { data: categories = [] } = useQuery({ queryKey: EXPENSE_CATEGORIES_KEY, queryFn: getExpenseCategories });
  const { data: outflows = [], isPending } = useQuery({
    queryKey: ["expenses", "outflows", fromDate, toDate],
    queryFn: () => getOutflows(fromDate, toDate),
  });
  const { data: accounts = [] } = useQuery({ queryKey: ["cash-accounts"], queryFn: getCashAccounts });
  const { data: recurring = [] } = useQuery({ queryKey: ["recurring-expenses"], queryFn: getRecurringExpenses });
  const { data: skips = [] } = useQuery({ queryKey: ["recurring-skips", period], queryFn: () => getRecurringSkips(period) });
  const { data: payments = [] } = useQuery({ queryKey: ["recurring-payments", period], queryFn: () => getRecurringPayments(period) });

  const activeAccounts = accounts.filter((a) => a.is_active);
  const accountById = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["expenses"] });
    queryClient.invalidateQueries({ queryKey: EXPENSE_CATEGORIES_KEY });
    queryClient.invalidateQueries({ queryKey: ["recurring-expenses"] });
    queryClient.invalidateQueries({ queryKey: ["recurring-skips"] });
    queryClient.invalidateQueries({ queryKey: ["recurring-payments"] });
    queryClient.invalidateQueries({ queryKey: ["cash-transactions"] });
    queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
  };

  const summary = useMemo(() => summariseExpenses(outflows, categories, months), [outflows, categories, months]);
  const counted = useMemo(() => expenseCategoryNames(categories), [categories]);
  const uncounted = useMemo(() => uncountedOutflows(outflows, categories, period), [outflows, categories, period]);
  const thisMonth = summary.totals[period] || 0;
  const lastMonth = summary.totals[prevPeriod] || 0;
  const change = changePct(lastMonth, thisMonth);

  // Biggest spend this month first; categories with nothing this month after.
  const rows = useMemo(
    () => [...summary.byCategory.entries()].sort((a, b) => (b[1][period] || 0) - (a[1][period] || 0) || a[0].localeCompare(b[0])),
    [summary, period],
  );

  // ---- Bills this month ----
  const today = todayIso();
  const bills = useMemo(() => recurring.filter((r) => r.is_active).map((r) => {
    const payment = payments.find((p) => p.recurring_expense_id === r.id) || null;
    const state = recurringState({
      dayOfMonth: r.day_of_month, period, today, paid: !!payment, skipped: skips.includes(r.id),
    });
    return { r, payment, state, due: dueDateIn(r.day_of_month, period) };
  }), [recurring, payments, skips, period, today]);
  const billsOutstanding = bills.filter((b) => b.state === "due" || b.state === "upcoming");
  const outstandingTotal = billsOutstanding.reduce((s, b) => s + Number(b.r.amount || 0), 0);

  const skipMut = useMutation({
    mutationFn: ({ id, undo }: { id: string; undo?: boolean }) => (undo ? unskipRecurring(id, period) : skipRecurring(id, period)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recurring-skips", period] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const openDrill = (title: string, filter: (t: ExpenseRow) => boolean) =>
    setDrill({ title, rows: outflows.filter(filter) });

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Expenses</h1>
          <p className="page-description">Money out under expense categories, from every bank, cash account and the owner</p>
        </div>
        <div className="toolbar-actions flex flex-wrap gap-2">
          <Input
            type="month"
            value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            className="h-9 w-[150px]"
          />
          <Button variant="outline" className="h-9" onClick={() => setRecurringOpen(true)}>
            <Repeat className="h-4 w-4 mr-1.5" /> Recurring bills
          </Button>
          <Button variant="outline" className="h-9" onClick={() => setCategoriesOpen(true)}>
            <Tags className="h-4 w-4 mr-1.5" /> Categories
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
        <StatCard
          title={`Expenses · ${monthLabel(period, true)}`}
          value={peso(thisMonth)}
          icon={Receipt}
          description={`${monthLabel(prevPeriod, true)}: ${peso(lastMonth)}`}
          delta={change == null ? null : change / 100}
          deltaInverse
        />
        <StatCard
          title="Average per month"
          value={peso(months.reduce((s, m) => s + (summary.totals[m] || 0), 0) / months.length)}
          icon={TrendingDown}
          description={`Over ${monthLabel(months[0])} – ${monthLabel(period)}`}
        />
        <StatCard
          title="Bills still to pay"
          value={peso(outstandingTotal)}
          icon={CalendarClock}
          description={`${billsOutstanding.length} recurring bill${billsOutstanding.length === 1 ? "" : "s"} this month`}
          variant={bills.some((b) => b.state === "due") ? "warning" : "default"}
        />
      </div>

      {/* Bills this month */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recurring bills · {monthLabel(period, true)}</h2>
          {recurring.length === 0 && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setRecurringOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add salary, accounting, electricity…
            </Button>
          )}
        </div>
        {bills.length === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border bg-card p-4">
            No recurring bills yet. Rent paid by post-dated check stays in Payables and is counted when you mark it paid.
          </p>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {bills.map(({ r, payment, state, due }) => {
              const acct = r.account_id ? accountById[r.account_id] : null;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {r.name}
                      {r.auto_post && <span className="ml-2 text-[10px] font-normal text-muted-foreground">auto</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {r.category || "No category"} · due {format(new Date(`${due}T00:00:00`), "MMM d")}
                      {acct ? ` · ${accountLabel(acct)}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm tabular-nums font-medium">{peso(payment ? Number(payment.amount) : Number(r.amount))}</p>
                    {payment && <p className="text-[11px] text-muted-foreground">paid {format(new Date(`${payment.txn_date}T00:00:00`), "MMM d")}</p>}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[10px] font-medium w-[70px] justify-center",
                      state === "paid" && "bg-success/15 text-success border-success/30",
                      state === "due" && "bg-warning/15 text-warning border-warning/30",
                      state === "skipped" && "text-muted-foreground",
                    )}
                  >
                    {state === "paid" ? "Paid" : state === "due" ? "Due" : state === "skipped" ? "Skipped" : "Upcoming"}
                  </Badge>
                  <div className="flex gap-1 shrink-0">
                    {(state === "due" || state === "upcoming") && (
                      <>
                        <Button size="sm" className="h-7 text-xs" onClick={() => setPaying(r)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Paid
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="No bill this month" onClick={() => skipMut.mutate({ id: r.id })}>
                          <SkipForward className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {state === "skipped" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Undo skip" onClick={() => skipMut.mutate({ id: r.id, undo: true })}>
                        <Undo2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* By category */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">By category</h2>
        <div className="data-table-wrapper overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs min-w-[160px]">Category</TableHead>
                {months.map((m) => (
                  <TableHead key={m} className={cn("text-xs text-right whitespace-nowrap", m === period && "text-foreground font-semibold")}>
                    {monthLabel(m)}
                  </TableHead>
                ))}
                <TableHead className="text-xs text-right whitespace-nowrap">vs last month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                <TableRow><TableCell colSpan={months.length + 2} className="h-24 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={months.length + 2} className="h-24 text-center text-sm text-muted-foreground">No expenses in these months.</TableCell></TableRow>
              ) : (
                <>
                  {rows.map(([name, byMonth]) => {
                    const pct = changePct(byMonth[prevPeriod] || 0, byMonth[period] || 0);
                    return (
                      <TableRow key={name} className="hover:bg-muted/30">
                        <TableCell className="text-sm font-medium">{name}</TableCell>
                        {months.map((m) => (
                          <TableCell key={m} className={cn("text-sm text-right tabular-nums", m === period && "font-semibold")}>
                            {byMonth[m] ? (
                              <button
                                type="button"
                                className="hover:underline underline-offset-2"
                                onClick={() => openDrill(`${name} · ${monthLabel(m, true)}`, (t) =>
                                  t.txn_date.startsWith(m) && isExpense(t, counted) && categoryKey(t.category) === categoryKey(name))}
                              >
                                {peso(byMonth[m])}
                              </button>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        ))}
                        <TableCell className={cn("text-xs text-right tabular-nums", pct == null ? "text-muted-foreground" : pct > 0 ? "text-destructive" : "text-success")}>
                          {pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell className="text-sm">Total</TableCell>
                    {months.map((m) => (
                      <TableCell key={m} className="text-sm text-right tabular-nums">
                        <button
                          type="button"
                          className="hover:underline underline-offset-2"
                          onClick={() => openDrill(`All expenses · ${monthLabel(m, true)}`, (t) => t.txn_date.startsWith(m) && isExpense(t, counted))}
                        >
                          {peso(summary.totals[m] || 0)}
                        </button>
                      </TableCell>
                    ))}
                    <TableCell className={cn("text-xs text-right tabular-nums", change == null ? "text-muted-foreground" : change > 0 ? "text-destructive" : "text-success")}>
                      {change == null ? "—" : `${change > 0 ? "+" : ""}${change}%`}
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Not counted */}
      {uncounted.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
            <div>
              <h2 className="text-sm font-semibold">Money out not counted · {monthLabel(period, true)}</h2>
              <p className="text-xs text-muted-foreground">
                Outflows with no category, or one that is not an expense (supplier payments, loan principal). Open one to re-file its entries, or mark its category as an expense.
              </p>
            </div>
          </div>
          <div className="divide-y rounded-lg border bg-card">
            {uncounted.map((u) => {
              const cat = categories.find((c) => categoryKey(c.name) === categoryKey(u.category));
              return (
                <div key={u.category || "__blank"} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm truncate", !u.category && "italic text-muted-foreground")}>{u.category || "No category"}</p>
                    <p className="text-[11px] text-muted-foreground">{u.count} entr{u.count === 1 ? "y" : "ies"}</p>
                  </div>
                  <span className="text-sm tabular-nums">{peso(u.total)}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDrill(`${u.category || "No category"} · ${monthLabel(period, true)}`, (t) =>
                      t.txn_date.startsWith(period) && !t.transfer_group_id && categoryKey(t.category) === categoryKey(u.category))}>
                      Open
                    </Button>
                    {cat && !cat.is_expense && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => {
                        try { await updateExpenseCategory(cat.id, { is_expense: true }); refreshAll(); toast.success(`${cat.name} now counts as an expense`); }
                        catch (e) { toast.error((e as Error).message); }
                      }}>
                        Count as expense
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <DrillDialog drill={drill} onClose={() => setDrill(null)} onRefiled={() => { refreshAll(); setDrill(null); }} />
      <CategoriesDialog open={categoriesOpen} onOpenChange={setCategoriesOpen} categories={categories} onChanged={refreshAll} />
      <RecurringDialog open={recurringOpen} onOpenChange={setRecurringOpen} recurring={recurring} accounts={activeAccounts} onChanged={refreshAll} />
      <PayBillDialog bill={paying} period={period} accounts={activeAccounts} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); refreshAll(); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The entries behind a figure, each re-fileable on the spot.
// ---------------------------------------------------------------------------
function DrillDialog({ drill, onClose, onRefiled }: {
  drill: { title: string; rows: ExpenseRow[] } | null; onClose: () => void; onRefiled: () => void;
}) {
  const [changes, setChanges] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const pending = Object.entries(changes).filter(([id, v]) => drill?.rows.find((r) => r.id === id)?.category !== v);

  const save = async () => {
    setSaving(true);
    try {
      for (const [id, category] of pending) await setTransactionCategory(id, category);
      toast.success(`${pending.length} entr${pending.length === 1 ? "y" : "ies"} re-filed`);
      setChanges({});
      onRefiled();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSaving(false);
  };

  return (
    <Dialog open={!!drill} onOpenChange={(o) => { if (!o) { setChanges({}); onClose(); } }}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">{drill?.title}</DialogTitle></DialogHeader>
        {drill && (
          <div className="space-y-2">
            {drill.rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
            {drill.rows.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{t.payee || t.notes || "—"}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {format(new Date(`${t.txn_date}T00:00:00`), "MMM d, yyyy")} · {t.account_name || "—"}
                    {t.payable_id ? " · from Payables" : t.recurring_expense_id ? " · recurring bill" : ""}
                    {t.payee && t.notes ? ` · ${t.notes}` : ""}
                  </p>
                </div>
                <div className="w-[180px]">
                  <CategorySelect value={changes[t.id] ?? t.category ?? ""} onChange={(v) => setChanges((p) => ({ ...p, [t.id]: v }))} className="h-8 text-xs" />
                </div>
                <span className="text-sm tabular-nums w-[100px] text-right">{peso(t.php)}</span>
              </div>
            ))}
            <p className="text-right text-sm font-semibold tabular-nums pt-1">
              Total {peso(drill.rows.reduce((s, t) => s + t.php, 0))}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => { setChanges({}); onClose(); }}>Close</Button>
          {pending.length > 0 && (
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : `Save ${pending.length} change${pending.length === 1 ? "" : "s"}`}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Managing the list.
// ---------------------------------------------------------------------------
function CategoriesDialog({ open, onOpenChange, categories, onChanged }: {
  open: boolean; onOpenChange: (o: boolean) => void; categories: ExpenseCategory[]; onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [merging, setMerging] = useState<ExpenseCategory | null>(null);
  const [mergeInto, setMergeInto] = useState("");

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); onChanged(); toast.success(ok); } catch (e) { toast.error((e as Error).message); }
  };

  const sorted = [...categories].sort((a, b) => Number(b.is_expense) - Number(a.is_expense) || a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">Categories</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Money out under a category marked <span className="font-medium text-foreground">Expense</span> counts on this page.
          Renaming or merging updates every bank, cash and payable entry that uses it.
        </p>
        <div className="flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category" className="h-9" />
          <Button className="h-9 shrink-0" disabled={!newName.trim()} onClick={() => run(async () => { await createExpenseCategory(newName, true); setNewName(""); }, "Category added")}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
        <div className="divide-y rounded-lg border">
          {sorted.map((c) => (
            <div key={c.id} className={cn("flex items-center gap-2 px-3 py-2", !c.is_active && "opacity-60")}>
              {renaming?.id === c.id ? (
                <Input
                  autoFocus
                  value={renaming.name}
                  onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") run(() => renameExpenseCategory(c.id, renaming.name), "Renamed").then(() => setRenaming(null));
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={() => setRenaming(null)}
                  className="h-8 flex-1"
                />
              ) : (
                <span className="flex-1 text-sm truncate">{c.name}</span>
              )}
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch checked={c.is_expense} onCheckedChange={(v) => run(() => updateExpenseCategory(c.id, { is_expense: v }), v ? `${c.name} counts as an expense` : `${c.name} no longer counts`)} />
                Expense
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch checked={c.is_active} onCheckedChange={(v) => run(() => updateExpenseCategory(c.id, { is_active: v }), v ? "Shown in the dropdown" : "Hidden from the dropdown")} />
                Shown
              </label>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Rename" onClick={() => setRenaming({ id: c.id, name: c.name })}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={() => { setMerging(c); setMergeInto(""); }}>
                Merge
              </Button>
            </div>
          ))}
        </div>

        <Dialog open={!!merging} onOpenChange={(o) => !o && setMerging(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle className="text-base">Merge {merging?.name}</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground">Every entry under {merging?.name} moves to the category you pick, and {merging?.name} is removed.</p>
            <Select value={mergeInto} onValueChange={setMergeInto}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Merge into…" /></SelectTrigger>
              <SelectContent>
                {sorted.filter((c) => c.id !== merging?.id).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMerging(null)}>Cancel</Button>
              <Button disabled={!mergeInto} onClick={() => merging && run(() => mergeExpenseCategory(merging.id, mergeInto), "Merged").then(() => setMerging(null))}>
                Merge
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Recurring bills: set up once.
// ---------------------------------------------------------------------------
const emptyBill = () => ({
  id: "", name: "", category: "", payee: "", account_id: "", amount: "", day_of_month: "1", auto_post: false, is_active: true, notes: "",
});

function RecurringDialog({ open, onOpenChange, recurring, accounts, onChanged }: {
  open: boolean; onOpenChange: (o: boolean) => void; recurring: RecurringExpense[]; accounts: CashAccount[]; onChanged: () => void;
}) {
  const [form, setForm] = useState<ReturnType<typeof emptyBill> | null>(null);
  const account = accounts.find((a) => a.id === form?.account_id);
  const canAuto = !!account && !isForeign(account);

  const save = async () => {
    if (!form) return;
    const day = Number(form.day_of_month);
    if (!form.name.trim()) { toast.error("Name the bill"); return; }
    if (!(day >= 1 && day <= 31)) { toast.error("Pick a day from 1 to 31"); return; }
    const amount = Number(form.amount) || 0;
    if (form.auto_post && (!canAuto || amount <= 0)) { toast.error("Auto-post needs a peso account and a fixed amount"); return; }
    try {
      await saveRecurringExpense({
        id: form.id || undefined,
        name: form.name.trim(),
        category: form.category,
        payee: form.payee.trim(),
        account_id: form.account_id || null,
        amount,
        day_of_month: day,
        auto_post: form.auto_post && canAuto,
        is_active: form.is_active,
        notes: form.notes,
      });
      toast.success(form.id ? "Bill updated" : "Bill added");
      setForm(null);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base">{form ? (form.id ? "Edit bill" : "New recurring bill") : "Recurring bills"}</DialogTitle></DialogHeader>
        {!form ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Bills that come every month. Each shows on the Expenses page in its month; click Paid and it is withdrawn from the account. Auto-post ones are withdrawn on their day without a click.
            </p>
            <div className="divide-y rounded-lg border">
              {recurring.length === 0 && <p className="p-3 text-sm text-muted-foreground">None yet.</p>}
              {recurring.map((r) => (
                <div key={r.id} className={cn("flex items-center gap-2 px-3 py-2", !r.is_active && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.name}{!r.is_active && " (stopped)"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Day {r.day_of_month} · {r.category || "No category"} · {peso(Number(r.amount))}{r.auto_post ? " · auto" : ""}
                    </p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setForm({
                    id: r.id, name: r.name, category: r.category, payee: r.payee, account_id: r.account_id || "",
                    amount: String(r.amount ?? ""), day_of_month: String(r.day_of_month), auto_post: r.auto_post, is_active: r.is_active, notes: r.notes || "",
                  })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => {
                    if (!window.confirm(`Delete ${r.name}? Payments already made stay in the ledger.`)) return;
                    try { await deleteRecurringExpense(r.id); onChanged(); toast.success("Deleted"); } catch (e) { toast.error((e as Error).message); }
                  }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button className="w-full h-9" onClick={() => setForm(emptyBill())}><Plus className="h-4 w-4 mr-1" /> Add a bill</Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9" placeholder="e.g. Salary (15th), Meralco, Accountant" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Category</Label>
                <CategorySelect value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payee</Label>
                <Input value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs font-medium">Paid from</Label>
                <Select value={form.account_id || "none"} onValueChange={(v) => setForm({ ...form, account_id: v === "none" ? "" : v, auto_post: v === "none" ? false : form.auto_post })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Choose when paying</SelectItem>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{accountLabel(a)}{isForeign(a) ? ` (${a.currency})` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Day of month *</Label>
                <Input type="number" min={1} max={31} value={form.day_of_month} onChange={(e) => setForm({ ...form, day_of_month: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Usual amount</Label>
              <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-9" placeholder="Leave blank if it changes every month" />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <Label className="text-xs font-medium">Post automatically on its day</Label>
                <p className="text-[11px] text-muted-foreground">
                  {canAuto ? "For a fixed amount, like a retainer. No Telegram message is sent for these." : "Needs a peso account and an amount."}
                </p>
              </div>
              <Switch checked={form.auto_post} disabled={!canAuto} onCheckedChange={(v) => setForm({ ...form, auto_post: v })} />
            </div>
            {form.id && (
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <Label className="text-xs font-medium">Active</Label>
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="resize-none" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setForm(null)}>Back</Button>
              <Button onClick={save}>{form.id ? "Save" : "Add bill"}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Paying one bill for the month.
// ---------------------------------------------------------------------------
function PayBillDialog({ bill, period, accounts, onClose, onPaid }: {
  bill: RecurringExpense | null; period: string; accounts: CashAccount[]; onClose: () => void; onPaid: () => void;
}) {
  const [form, setForm] = useState({ account_id: "", amount: "", date: "", notes: "" });
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = bill ? `${bill.id}:${period}` : null;
  if (bill && openedFor !== key) {
    const today = todayIso();
    setOpenedFor(key);
    setForm({
      account_id: bill.account_id || accounts.find((a) => a.account_type === "bank")?.id || "",
      amount: Number(bill.amount) > 0 ? String(bill.amount) : "",
      // Today when paying in the bill's own month; otherwise its due day.
      date: today.startsWith(period) ? today : dueDateIn(bill.day_of_month, period),
      notes: "",
    });
  }
  if (!bill && openedFor) setOpenedFor(null);

  const payMut = useMutation({
    mutationFn: async () => {
      if (!bill) return;
      const amount = Number(form.amount);
      if (!form.account_id) throw new Error("Pick the account it was paid from");
      if (!amount || amount <= 0) throw new Error("Enter the amount paid");
      if (!form.date) throw new Error("Pick the date it was paid");
      await payRecurring(bill, { period, accountId: form.account_id, amount, date: form.date, notes: form.notes });
    },
    onSuccess: () => { toast.success(`${bill?.name} paid`); onPaid(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!bill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="text-base">Pay {bill?.name} · {monthLabel(period, true)}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Paid from</Label>
            <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Pick an account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{accountLabel(a)}{isForeign(a) ? ` (${a.currency})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Amount</Label>
              <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-9" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Date paid</Label>
              <DateField value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="h-9" placeholder={`Recurring: ${bill?.name || ""}`} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Recorded as a withdrawal under {bill?.category || "no category"}, like any other bank entry.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => payMut.mutate()} disabled={payMut.isPending}>{payMut.isPending ? "Saving…" : "Mark paid"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
