import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCashAccounts, getCashTransactions, createCashTransaction,
  updateCashTransaction, deleteCashTransaction, createCashTransfer,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/DateField";
import { StatCard } from "@/components/StatCard";
import { Plus, Pencil, Trash2, Search, ArrowLeftRight, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { toast } from "sonner";
import { format, parse, isValid } from "date-fns";
import { peso } from "@/lib/currency";
import type { CashAccount, CashAccountType, CashTransaction } from "@/types/database";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

const today = () => format(new Date(), "yyyy-MM-dd");
const emptyForm = () => ({
  account_id: "", txn_date: today(), direction: "out" as "in" | "out",
  amount: "", category: "", payee: "", reference: "", notes: "",
});
const emptyTransfer = () => ({ from_account_id: "", to_account_id: "", amount: "", txn_date: today(), notes: "" });

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = parse(value, "yyyy-MM-dd", new Date());
  return isValid(d) ? format(d, "MM/dd/yyyy") : "—";
}

/** Opening balance plus net movement for one account. */
function balanceOf(account: CashAccount, txns: CashTransaction[]) {
  return txns
    .filter((t) => t.account_id === account.id)
    .reduce(
      (sum, t) => sum + (t.direction === "in" ? Number(t.amount || 0) : -Number(t.amount || 0)),
      Number(account.opening_balance || 0),
    );
}

interface CashLedgerProps {
  accountType: CashAccountType;
  title: string;
  description: string;
  /** Show the per-account filter and transfer button (used by Bank, not Petty Cash). */
  showAccountFilter?: boolean;
}

export function CashLedger({ accountType, title, description, showAccountFilter = false }: CashLedgerProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editing, setEditing] = useState<CashTransaction | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [transfer, setTransfer] = useState(emptyTransfer());
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");

  const { data: allAccounts = [] } = useQuery({ queryKey: ["cash-accounts"], queryFn: getCashAccounts });
  const accounts = useMemo(
    () => allAccounts.filter((a) => a.account_type === accountType && a.is_active),
    [allAccounts, accountType],
  );
  const accountIds = useMemo(() => accounts.map((a) => a.id), [accounts]);

  const { data: txns = [], isLoading } = useQuery({
    queryKey: ["cash-transactions", accountType, accountIds],
    queryFn: () => getCashTransactions(accountIds),
    enabled: accounts.length > 0,
  });

  const scoped = useMemo(
    () => (accountFilter === "all" ? txns : txns.filter((t) => t.account_id === accountFilter)),
    [txns, accountFilter],
  );

  const filtered = scoped.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [t.category, t.payee, t.reference, t.notes].some((v) => (v || "").toLowerCase().includes(q));
  });

  const { sort, toggle, sorted } = useSort<CashTransaction>(filtered, {
    txn_date: (r) => r.txn_date,
    account: (r) => r.cash_accounts?.name || "",
    category: (r) => r.category,
    payee: (r) => r.payee,
    amount: (r) => Number(r.amount),
  });

  const visibleAccounts = accountFilter === "all" ? accounts : accounts.filter((a) => a.id === accountFilter);
  const totalBalance = visibleAccounts.reduce((sum, a) => sum + balanceOf(a, txns), 0);
  const totalIn = scoped.filter((t) => t.direction === "in").reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalOut = scoped.filter((t) => t.direction === "out").reduce((s, t) => s + Number(t.amount || 0), 0);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["cash-transactions"] });
    queryClient.invalidateQueries({ queryKey: ["cash-accounts"] });
  };

  const createMut = useMutation({
    mutationFn: (data: Partial<CashTransaction>) => createCashTransaction(data),
    onSuccess: () => { invalidate(); setOpen(false); toast.success("Transaction recorded"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CashTransaction> }) => updateCashTransaction(id, data),
    onSuccess: () => { invalidate(); setOpen(false); setEditing(null); toast.success("Transaction updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteCashTransaction,
    onSuccess: () => { invalidate(); toast.success("Transaction deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const transferMut = useMutation({
    mutationFn: createCashTransfer,
    onSuccess: () => { invalidate(); setTransferOpen(false); toast.success("Transfer recorded"); },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm(), account_id: accountFilter !== "all" ? accountFilter : accounts[0]?.id || "" });
    setOpen(true);
  };

  const openEdit = (t: CashTransaction) => {
    setEditing(t);
    setForm({
      account_id: t.account_id,
      txn_date: t.txn_date,
      direction: t.direction,
      amount: String(t.amount ?? ""),
      category: t.category || "",
      payee: t.payee || "",
      reference: t.reference || "",
      notes: t.notes || "",
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.account_id) { toast.error("Select an account"); return; }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { toast.error("Enter an amount greater than zero"); return; }
    const data: Partial<CashTransaction> = {
      account_id: form.account_id,
      txn_date: form.txn_date,
      direction: form.direction,
      amount,
      category: form.category.trim(),
      payee: form.payee.trim(),
      reference: form.reference.trim(),
      notes: form.notes,
    };
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  const handleTransfer = () => {
    const amount = Number(transfer.amount);
    if (!transfer.from_account_id || !transfer.to_account_id) { toast.error("Pick both accounts"); return; }
    if (transfer.from_account_id === transfer.to_account_id) { toast.error("Pick two different accounts"); return; }
    if (!amount || amount <= 0) { toast.error("Enter an amount greater than zero"); return; }
    transferMut.mutate({ ...transfer, amount });
  };

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">{title}</h1>
          <p className="page-description">{description}</p>
        </div>
        <div className="toolbar-actions flex gap-2">
          {showAccountFilter && (
            <Button variant="outline" onClick={() => { setTransfer(emptyTransfer()); setTransferOpen(true); }} className="rounded-lg h-9 px-4 text-sm font-medium">
              <ArrowLeftRight className="h-4 w-4 mr-1.5" /> Transfer
            </Button>
          )}
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> Add Transaction
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
        <StatCard title="Current Balance" value={peso(totalBalance)} icon={Wallet} description={accountFilter === "all" ? "All accounts" : visibleAccounts[0]?.name || ""} />
        <StatCard title="Total Inflow" value={peso(totalIn)} icon={TrendingUp} description="Money in" />
        <StatCard title="Total Outflow" value={peso(totalOut)} icon={TrendingDown} description="Money out" />
      </div>

      {showAccountFilter && accounts.length > 0 && (
        <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
          {accounts.map((a) => (
            <div key={a.id} className="rounded-lg border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">{a.name}</p>
              <p className="text-lg font-semibold">{peso(balanceOf(a, txns))}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search transactions..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {showAccountFilter && (
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Transaction" : "New Transaction"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            {accounts.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Account *</Label>
                <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Type *</Label>
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as "in" | "out" })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Inflow (money in)</SelectItem>
                    <SelectItem value="out">Outflow (money out)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Amount *</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date *</Label>
                <DateField value={form.txn_date} onChange={(v) => setForm({ ...form, txn_date: v })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-9" placeholder="e.g. Supplies, Fuel" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payee / Source</Label>
                <Input value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Reference</Label>
                <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="h-9" placeholder="OR / slip no." />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} className="rounded-lg h-9">
              {editing ? "Save Changes" : "Add Transaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">Transfer Between Accounts</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">From *</Label>
                <Select value={transfer.from_account_id} onValueChange={(v) => setTransfer({ ...transfer, from_account_id: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Account" /></SelectTrigger>
                  <SelectContent>
                    {allAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">To *</Label>
                <Select value={transfer.to_account_id} onValueChange={(v) => setTransfer({ ...transfer, to_account_id: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Account" /></SelectTrigger>
                  <SelectContent>
                    {allAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Amount *</Label>
                <Input type="number" step="0.01" min="0" value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date *</Label>
                <DateField value={transfer.txn_date} onChange={(v) => setTransfer({ ...transfer, txn_date: v })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={transfer.notes} onChange={(e) => setTransfer({ ...transfer, notes: e.target.value })} className="resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button onClick={handleTransfer} disabled={transferMut.isPending} className="rounded-lg h-9">Record Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader sortKey="txn_date" label="Date" sort={sort} onToggle={toggle} />
              {showAccountFilter && <SortableHeader sortKey="account" label="Account" sort={sort} onToggle={toggle} />}
              <SortableHeader sortKey="category" label="Category" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="payee" label="Payee / Source" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs text-right">Inflow</TableHead>
              <TableHead className="text-xs text-right">Outflow</TableHead>
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={showAccountFilter ? 7 : 6} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={showAccountFilter ? 7 : 6}><div className="empty-state"><Wallet className="empty-state-icon" /><p className="text-sm">No transactions yet</p></div></TableCell></TableRow>
            ) : sorted.map((t) => (
              <TableRow key={t.id} className="hover:bg-muted/30">
                <TableCell className="text-sm text-muted-foreground">{formatDate(t.txn_date)}</TableCell>
                {showAccountFilter && <TableCell className="text-sm">{t.cash_accounts?.name || "—"}</TableCell>}
                <TableCell className="text-sm">{t.category || "—"}</TableCell>
                <TableCell className="text-sm font-medium">{t.payee || "—"}</TableCell>
                <TableCell className="text-sm text-right text-emerald-600">{t.direction === "in" ? peso(Number(t.amount)) : "—"}</TableCell>
                <TableCell className="text-sm text-right text-destructive/80">{t.direction === "out" ? peso(Number(t.amount)) : "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(t)} className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(t.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
