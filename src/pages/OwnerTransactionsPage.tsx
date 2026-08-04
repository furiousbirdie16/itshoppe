import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOwnerTransactions, createOwnerTransaction, updateOwnerTransaction, deleteOwnerTransaction,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/DateField";
import { StatCard } from "@/components/StatCard";
import { Plus, Pencil, Trash2, Search, HandCoins, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { format, parse, isValid } from "date-fns";
import { peso } from "@/lib/currency";
import type { OwnerTransaction } from "@/types/database";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

const today = () => format(new Date(), "yyyy-MM-dd");
const emptyForm = () => ({
  txn_date: today(), txn_type: "owner_paid" as OwnerTransaction["txn_type"],
  amount: "", method: "credit_card" as OwnerTransaction["method"],
  description: "", category: "", reference: "", notes: "",
});

const METHOD_LABELS: Record<OwnerTransaction["method"], string> = {
  credit_card: "Credit Card",
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = parse(value, "yyyy-MM-dd", new Date());
  return isValid(d) ? format(d, "MM/dd/yyyy") : "—";
}

export default function OwnerTransactionsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OwnerTransaction | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [search, setSearch] = useState("");

  const { data: txns = [], isLoading } = useQuery({
    queryKey: ["owner-transactions"],
    queryFn: getOwnerTransactions,
  });

  const filtered = txns.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [t.description, t.category, t.reference, t.notes].some((v) => (v || "").toLowerCase().includes(q));
  });

  const { sort, toggle, sorted } = useSort<OwnerTransaction>(filtered, {
    txn_date: (r) => r.txn_date,
    description: (r) => r.description,
    method: (r) => r.method,
    amount: (r) => Number(r.amount),
  });

  const totalOwnerPaid = txns.filter((t) => t.txn_type === "owner_paid").reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalRepaid = txns.filter((t) => t.txn_type === "company_repaid").reduce((s, t) => s + Number(t.amount || 0), 0);
  const balanceOwed = totalOwnerPaid - totalRepaid;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["owner-transactions"] });

  const createMut = useMutation({
    mutationFn: (data: Partial<OwnerTransaction>) => createOwnerTransaction(data),
    onSuccess: () => { invalidate(); setOpen(false); toast.success("Transaction recorded"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<OwnerTransaction> }) => updateOwnerTransaction(id, data),
    onSuccess: () => { invalidate(); setOpen(false); setEditing(null); toast.success("Transaction updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteOwnerTransaction,
    onSuccess: () => { invalidate(); toast.success("Transaction deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setOpen(true); };

  const openEdit = (t: OwnerTransaction) => {
    setEditing(t);
    setForm({
      txn_date: t.txn_date,
      txn_type: t.txn_type,
      amount: String(t.amount ?? ""),
      method: t.method,
      description: t.description || "",
      category: t.category || "",
      reference: t.reference || "",
      notes: t.notes || "",
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { toast.error("Enter an amount greater than zero"); return; }
    if (!form.description.trim()) { toast.error("Description is required"); return; }
    const data: Partial<OwnerTransaction> = {
      txn_date: form.txn_date,
      txn_type: form.txn_type,
      amount,
      method: form.method,
      description: form.description.trim(),
      category: form.category.trim(),
      reference: form.reference.trim(),
      notes: form.notes,
    };
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Owner's Transactions</h1>
          <p className="page-description">Owner spending for the company and repayments back to the owner</p>
        </div>
        <div className="toolbar-actions">
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> Add Transaction
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
        <StatCard title="Balance Owed to Owner" value={peso(balanceOwed)} icon={HandCoins} description={balanceOwed >= 0 ? "Company still owes the owner" : "Owner has been overpaid"} />
        <StatCard title="Owner Paid" value={peso(totalOwnerPaid)} icon={TrendingUp} description="Spent for the company" />
        <StatCard title="Company Repaid" value={peso(totalRepaid)} icon={TrendingDown} description="Paid back to the owner" />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search transactions..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Transaction" : "New Transaction"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Type *</Label>
              <Select value={form.txn_type} onValueChange={(v) => setForm({ ...form, txn_type: v as OwnerTransaction["txn_type"] })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner_paid">Owner paid for the company</SelectItem>
                  <SelectItem value="company_repaid">Company repaid the owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Description *</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="h-9" placeholder="e.g. Supplier deposit via personal card" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Amount *</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Method</Label>
                <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v as OwnerTransaction["method"] })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHOD_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date *</Label>
                <DateField value={form.txn_date} onChange={(v) => setForm({ ...form, txn_date: v })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-9" placeholder="e.g. Travel, Supplies" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Reference</Label>
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="h-9" placeholder="Card last 4, OR no." />
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

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader sortKey="txn_date" label="Date" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="description" label="Description" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="method" label="Method" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs text-right">Owner Paid</TableHead>
              <TableHead className="text-xs text-right">Company Repaid</TableHead>
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={6}><div className="empty-state"><HandCoins className="empty-state-icon" /><p className="text-sm">No owner transactions yet</p></div></TableCell></TableRow>
            ) : sorted.map((t) => (
              <TableRow key={t.id} className="hover:bg-muted/30">
                <TableCell className="text-sm text-muted-foreground">{formatDate(t.txn_date)}</TableCell>
                <TableCell className="text-sm font-medium">
                  {t.description}
                  {t.category && <span className="ml-2 text-xs text-muted-foreground">{t.category}</span>}
                </TableCell>
                <TableCell><Badge variant="secondary" className="text-xs font-normal">{METHOD_LABELS[t.method]}</Badge></TableCell>
                <TableCell className="text-sm text-right text-emerald-600">{t.txn_type === "owner_paid" ? peso(Number(t.amount)) : "—"}</TableCell>
                <TableCell className="text-sm text-right text-destructive/80">{t.txn_type === "company_repaid" ? peso(Number(t.amount)) : "—"}</TableCell>
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
