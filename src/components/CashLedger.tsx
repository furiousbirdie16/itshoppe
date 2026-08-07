import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCashAccounts, getCashTransactions, createCashTransaction,
  updateCashTransaction, deleteCashTransaction, createCashTransfer,
  createCashAccount, updateCashAccount, deleteCashAccount,
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
import { Plus, Pencil, Trash2, Search, ArrowLeftRight, TrendingUp, TrendingDown, Wallet, Landmark } from "lucide-react";
import { toast } from "sonner";
import { format, parse, isValid } from "date-fns";
import { peso } from "@/lib/currency";
import type { CashAccount, CashAccountType, CashTransaction } from "@/types/database";
import { BASE_CURRENCY, isForeign, fxPosition, fxPhpAmountById, foreignAmount } from "@/lib/fx";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

const today = () => format(new Date(), "yyyy-MM-dd");
const emptyForm = () => ({
  account_id: "", txn_date: today(), direction: "out" as "in" | "out",
  amount: "", category: "", payee: "", reference: "", notes: "", fx_rate: "",
});
const emptyTransfer = () => ({ from_account_id: "", to_account_id: "", amount: "", amount_to: "", txn_date: today(), notes: "" });
const emptyAccount = () => ({ name: "", account_number: "", opening_balance: "", notes: "", currency: BASE_CURRENCY });

/** Emails are long in a narrow column — show the name part, full address on hover. */
function shortUser(email: string) {
  return email.split("@")[0] || email;
}

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
  const [accountOpen, setAccountOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<CashAccount | null>(null);
  const [accountForm, setAccountForm] = useState(emptyAccount());

  const { data: allAccounts = [] } = useQuery({ queryKey: ["cash-accounts"], queryFn: getCashAccounts });
  // Active accounts drive the pickers and totals...
  const accounts = useMemo(
    () => allAccounts.filter((a) => a.account_type === accountType && a.is_active),
    [allAccounts, accountType],
  );
  // ...while the management cards also show deactivated ones so they can be restored.
  const managedAccounts = useMemo(
    () => allAccounts.filter((a) => a.account_type === accountType),
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
    recorded_by: (r) => r.created_by_email || "",
  });

  // Foreign accounts are valued in PHP from a running weighted-average of the
  // rates paid, so one total can span currencies.
  const fxByAccount = useMemo(() => {
    const out: Record<string, ReturnType<typeof fxPosition>> = {};
    for (const a of managedAccounts) {
      if (isForeign(a)) out[a.id] = fxPosition(txns.filter((t) => t.account_id === a.id));
    }
    return out;
  }, [managedAccounts, txns]);

  const phpAmountById = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of managedAccounts) {
      if (isForeign(a)) Object.assign(out, fxPhpAmountById(txns.filter((t) => t.account_id === a.id)));
    }
    return out;
  }, [managedAccounts, txns]);

  /** Balance in PHP, whatever the account's currency. */
  const phpBalanceOf = (a: CashAccount) =>
    isForeign(a) ? (fxByAccount[a.id]?.phpCost || 0) : balanceOf(a, txns);

  const hasForeign = managedAccounts.some(isForeign);

  /** Amounts render in the account's own currency. */
  const amountLabel = (t: CashTransaction) => {
    const account = allAccounts.find((a) => a.id === t.account_id);
    return account && isForeign(account)
      ? foreignAmount(Number(t.amount), account.currency)
      : peso(Number(t.amount));
  };
  const accountById = useMemo(
    () => Object.fromEntries(allAccounts.map((a) => [a.id, a])),
    [allAccounts],
  );
  const formAccount = accountById[form.account_id];
  const formIsForeign = formAccount ? isForeign(formAccount) : false;

  const visibleAccounts = accountFilter === "all" ? accounts : accounts.filter((a) => a.id === accountFilter);
  const totalBalance = visibleAccounts.reduce((sum, a) => sum + phpBalanceOf(a), 0);
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

  const accountMut = useMutation({
    mutationFn: (data: Partial<CashAccount>) =>
      editingAccount ? updateCashAccount(editingAccount.id, data) : createCashAccount(data),
    onSuccess: () => {
      invalidate();
      setAccountOpen(false);
      setEditingAccount(null);
      toast.success(editingAccount ? "Account updated" : "Account added");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteAccountMut = useMutation({
    mutationFn: deleteCashAccount,
    onSuccess: () => { invalidate(); setAccountFilter("all"); toast.success("Account deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const openAccountCreate = () => { setEditingAccount(null); setAccountForm(emptyAccount()); setAccountOpen(true); };

  const openAccountEdit = (a: CashAccount) => {
    setEditingAccount(a);
    setAccountForm({
      name: a.name,
      account_number: a.account_number || "",
      opening_balance: String(a.opening_balance ?? ""),
      notes: a.notes || "",
      currency: a.currency || BASE_CURRENCY,
    });
    setAccountOpen(true);
  };

  const handleAccountSubmit = () => {
    if (!accountForm.name.trim()) { toast.error("Account name is required"); return; }
    accountMut.mutate({
      name: accountForm.name.trim(),
      account_type: accountType,
      account_number: accountForm.account_number.trim(),
      currency: (accountForm.currency || BASE_CURRENCY).trim().toUpperCase(),
      opening_balance: Number(accountForm.opening_balance) || 0,
      notes: accountForm.notes,
      sort_order: editingAccount?.sort_order ?? accounts.length,
    });
  };

  /**
   * Deleting cascades to every transaction on the account, so refuse when there is
   * history and steer to deactivating instead.
   */
  const handleAccountDelete = (a: CashAccount) => {
    const count = txns.filter((t) => t.account_id === a.id).length;
    if (count > 0) {
      toast.error(
        `${a.name} has ${count} transaction${count === 1 ? "" : "s"}. Deactivate it instead to keep the history.`,
      );
      return;
    }
    if (!window.confirm(`Delete ${a.name}? This cannot be undone.`)) return;
    deleteAccountMut.mutate(a.id);
  };

  const toggleAccountActive = (a: CashAccount) =>
    updateCashAccount(a.id, { is_active: !a.is_active })
      .then(() => { invalidate(); toast.success(a.is_active ? `${a.name} deactivated` : `${a.name} reactivated`); })
      .catch((e: any) => toast.error(e.message));

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
      fx_rate: t.fx_rate == null ? "" : String(t.fx_rate),
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
    const needsRate = formIsForeign && form.direction === "in";
    const rate = Number(form.fx_rate);
    if (needsRate && (!rate || rate <= 0)) {
      toast.error(`Enter the PHP rate paid per 1 ${formAccount?.currency}`);
      return;
    }
    const data: Partial<CashTransaction> = {
      account_id: form.account_id,
      txn_date: form.txn_date,
      direction: form.direction,
      amount,
      fx_rate: needsRate ? rate : null,
      category: form.category.trim(),
      payee: form.payee.trim(),
      reference: form.reference.trim(),
      notes: form.notes,
    };
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  const transferFrom = accountById[transfer.from_account_id];
  const transferTo = accountById[transfer.to_account_id];
  const transferCurrenciesDiffer =
    !!transferFrom && !!transferTo &&
    (transferFrom.currency || BASE_CURRENCY) !== (transferTo.currency || BASE_CURRENCY);

  const handleTransfer = () => {
    const amount = Number(transfer.amount);
    if (!transfer.from_account_id || !transfer.to_account_id) { toast.error("Pick both accounts"); return; }
    if (transfer.from_account_id === transfer.to_account_id) { toast.error("Pick two different accounts"); return; }
    if (!amount || amount <= 0) { toast.error("Enter an amount greater than zero"); return; }

    if (!transferCurrenciesDiffer) {
      transferMut.mutate({ ...transfer, amount, amount_to: amount, fx_rate: null });
      return;
    }
    // An exchange: both sides differ, and the implied rate is what was really paid.
    const amountTo = Number(transfer.amount_to);
    if (!amountTo || amountTo <= 0) { toast.error(`Enter the ${transferTo?.currency} amount received`); return; }
    const toIsForeign = isForeign(transferTo!);
    transferMut.mutate({
      ...transfer,
      amount,
      amount_to: amountTo,
      // Rate only means anything when the destination is the foreign side.
      fx_rate: toIsForeign ? amount / amountTo : null,
    });
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

      {showAccountFilter && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Accounts</h2>
            <Button variant="outline" size="sm" onClick={openAccountCreate} className="h-8 rounded-lg text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Account
            </Button>
          </div>
          {managedAccounts.length === 0 ? (
            <div className="rounded-lg border bg-card">
              <div className="empty-state"><Landmark className="empty-state-icon" /><p className="text-sm">No accounts yet — add your first {accountType === "bank" ? "bank" : "cash account"}</p></div>
            </div>
          ) : (
            <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
              {managedAccounts.map((a) => (
                <div key={a.id} className={`rounded-lg border bg-card px-4 py-3 ${a.is_active ? "" : "opacity-60"}`}>
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground truncate">
                        {a.name}{!a.is_active && " (inactive)"}
                      </p>
                      <p className="text-lg font-semibold">{peso(phpBalanceOf(a))}</p>
                      {isForeign(a) ? (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {foreignAmount(fxByAccount[a.id]?.quantity || 0, a.currency)}
                          {" · avg "}{(fxByAccount[a.id]?.averageRate || 0).toFixed(2)}
                        </p>
                      ) : a.account_number ? (
                        <p className="text-[11px] text-muted-foreground truncate">{a.account_number}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <Button variant="ghost" size="icon" onClick={() => openAccountEdit(a)} className="h-6 w-6 rounded-md" title="Edit">
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => toggleAccountActive(a)} className="h-6 w-6 rounded-md" title={a.is_active ? "Deactivate" : "Reactivate"}>
                        <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleAccountDelete(a)} className="h-6 w-6 rounded-md" title="Delete">
                        <Trash2 className="h-3 w-3 text-destructive/70" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                <Label className="text-xs font-medium">
                  Amount *{formIsForeign && ` (${formAccount?.currency})`}
                </Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-9" />
              </div>
            </div>
            {formIsForeign && form.direction === "in" && (
              <div className="space-y-1.5 rounded-lg border p-3">
                <Label className="text-xs font-medium">PHP per 1 {formAccount?.currency} *</Label>
                <Input type="number" step="0.0001" min="0" value={form.fx_rate} onChange={(e) => setForm({ ...form, fx_rate: e.target.value })} className="h-9" placeholder="e.g. 9.05" />
                <p className="text-[11px] text-muted-foreground">
                  {Number(form.amount) > 0 && Number(form.fx_rate) > 0
                    ? `Costs ${peso(Number(form.amount) * Number(form.fx_rate))}. `
                    : ""}
                  Outflows are valued automatically at the running average.
                </p>
              </div>
            )}
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

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">{editingAccount ? "Edit Account" : "New Account"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Account Name *</Label>
              <Input value={accountForm.name} onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} className="h-9" placeholder={accountType === "bank" ? "e.g. GCash, BDO, Metrobank" : "e.g. Petty Cash, Geraldine Cash"} />
              <p className="text-[11px] text-muted-foreground">This name appears as a payment option when marking invoices paid.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Currency</Label>
              <Input
                value={accountForm.currency}
                onChange={(e) => setAccountForm({ ...accountForm, currency: e.target.value.toUpperCase() })}
                className="h-9"
                placeholder="PHP"
                disabled={!!editingAccount}
              />
              <p className="text-[11px] text-muted-foreground">
                {editingAccount
                  ? "Currency cannot be changed once the account has history."
                  : "Use PHP unless this holds a foreign currency, e.g. RMB. Foreign accounts are valued in PHP at a weighted-average rate."}
              </p>
            </div>
            <div className={accountType === "bank" ? "grid grid-cols-2 gap-3" : ""}>
              {accountType === "bank" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Account Number</Label>
                  <Input value={accountForm.account_number} onChange={(e) => setAccountForm({ ...accountForm, account_number: e.target.value })} className="h-9" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Opening Balance</Label>
                <Input type="number" step="0.01" value={accountForm.opening_balance} onChange={(e) => setAccountForm({ ...accountForm, opening_balance: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={accountForm.notes} onChange={(e) => setAccountForm({ ...accountForm, notes: e.target.value })} className="resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountOpen(false)}>Cancel</Button>
            <Button onClick={handleAccountSubmit} disabled={accountMut.isPending} className="rounded-lg h-9">
              {editingAccount ? "Save Changes" : "Add Account"}
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
                <Label className="text-xs font-medium">
                  Amount Sent *{transferFrom ? ` (${transferFrom.currency || BASE_CURRENCY})` : ""}
                </Label>
                <Input type="number" step="0.01" min="0" value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date *</Label>
                <DateField value={transfer.txn_date} onChange={(v) => setTransfer({ ...transfer, txn_date: v })} />
              </div>
            </div>
            {transferCurrenciesDiffer && (
              <div className="space-y-1.5 rounded-lg border p-3">
                <Label className="text-xs font-medium">
                  Amount Received * ({transferTo?.currency})
                </Label>
                <Input type="number" step="0.01" min="0" value={transfer.amount_to} onChange={(e) => setTransfer({ ...transfer, amount_to: e.target.value })} className="h-9" />
                <p className="text-[11px] text-muted-foreground">
                  {Number(transfer.amount) > 0 && Number(transfer.amount_to) > 0
                    ? `Rate: ${(Number(transfer.amount) / Number(transfer.amount_to)).toFixed(4)} ${transferFrom?.currency || BASE_CURRENCY} per 1 ${transferTo?.currency}`
                    : "An exchange — enter what actually landed in the destination."}
                </p>
              </div>
            )}
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
              {hasForeign && <TableHead className="text-xs text-right">PHP Value</TableHead>}
              <SortableHeader sortKey="recorded_by" label="Recorded By" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={showAccountFilter ? (hasForeign ? 9 : 8) : (hasForeign ? 8 : 7)} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={showAccountFilter ? (hasForeign ? 9 : 8) : (hasForeign ? 8 : 7)}><div className="empty-state"><Wallet className="empty-state-icon" /><p className="text-sm">No transactions yet</p></div></TableCell></TableRow>
            ) : sorted.map((t) => (
              <TableRow key={t.id} className="hover:bg-muted/30">
                <TableCell className="text-sm text-muted-foreground">{formatDate(t.txn_date)}</TableCell>
                {showAccountFilter && <TableCell className="text-sm">{t.cash_accounts?.name || "—"}</TableCell>}
                <TableCell className="text-sm">{t.category || "—"}</TableCell>
                <TableCell className="text-sm font-medium">{t.payee || "—"}</TableCell>
                <TableCell className="text-sm text-right text-emerald-600">{t.direction === "in" ? amountLabel(t) : "—"}</TableCell>
                <TableCell className="text-sm text-right text-destructive/80">{t.direction === "out" ? amountLabel(t) : "—"}</TableCell>
                {hasForeign && (
                  <TableCell className="text-sm text-right text-muted-foreground">
                    {accountById[t.account_id] && isForeign(accountById[t.account_id])
                      ? peso(phpAmountById[t.id] || 0)
                      : "—"}
                  </TableCell>
                )}
                <TableCell className="text-xs text-muted-foreground">
                  {t.created_by_email ? (
                    <span title={t.created_by_email}>{shortUser(t.created_by_email)}</span>
                  ) : "—"}
                  {t.updated_by_email && t.updated_by_email !== t.created_by_email && (
                    <span className="block text-[10px]" title={`Last edited by ${t.updated_by_email}`}>
                      edited by {shortUser(t.updated_by_email)}
                    </span>
                  )}
                </TableCell>
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
