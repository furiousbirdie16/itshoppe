import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getPayables, createPayable, updatePayable, deletePayable, getSuppliers } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/DateField";
import { StatCard } from "@/components/StatCard";
import { Plus, Pencil, Trash2, Search, Wallet, CalendarClock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format, parse, isValid, differenceInCalendarDays } from "date-fns";
import { peso } from "@/lib/currency";
import type { Payable } from "@/types/database";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

const NO_SUPPLIER = "none";

const emptyForm = () => ({
  payee: "", supplier_id: NO_SUPPLIER, amount: "", amount_paid: "", due_date: "",
  status: "unpaid" as Payable["status"], is_check: false,
  check_number: "", check_bank: "", date_written: "", category: "", notes: "",
});

const STATUS_LABELS: Record<Payable["status"], string> = {
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
  cleared: "Cleared",
  bounced: "Bounced",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<Payable["status"], "default" | "secondary" | "destructive" | "outline"> = {
  unpaid: "outline",
  partial: "secondary",
  paid: "default",
  cleared: "default",
  bounced: "destructive",
  cancelled: "secondary",
};

/** Statuses that mean the payable is settled and no longer outstanding. */
const SETTLED: Payable["status"][] = ["paid", "cleared", "cancelled"];

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = parse(value, "yyyy-MM-dd", new Date());
  return isValid(d) ? format(d, "MM/dd/yyyy") : "—";
}

function outstandingOf(p: Payable) {
  if (SETTLED.includes(p.status)) return 0;
  return Math.max(Number(p.amount || 0) - Number(p.amount_paid || 0), 0);
}

export default function PayablesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Payable | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "checks" | "bills">("all");

  const { data: payables = [], isLoading } = useQuery({ queryKey: ["payables"], queryFn: getPayables });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: getSuppliers });

  const scoped = payables.filter((p) =>
    tab === "all" ? true : tab === "checks" ? p.is_check : !p.is_check,
  );

  const filtered = scoped.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [p.payee, p.check_number, p.check_bank, p.category, p.notes]
      .some((v) => (v || "").toLowerCase().includes(q));
  });

  const { sort, toggle, sorted } = useSort<Payable>(filtered, {
    payee: (r) => r.payee,
    amount: (r) => Number(r.amount),
    due_date: (r) => r.due_date || "",
    status: (r) => r.status,
  });

  const totalOutstanding = payables.reduce((s, p) => s + outstandingOf(p), 0);
  const checksOutstanding = payables.filter((p) => p.is_check).reduce((s, p) => s + outstandingOf(p), 0);
  const overdue = payables.filter((p) => {
    if (!p.due_date || SETTLED.includes(p.status)) return false;
    const d = parse(p.due_date, "yyyy-MM-dd", new Date());
    return isValid(d) && differenceInCalendarDays(d, new Date()) < 0;
  });
  const overdueTotal = overdue.reduce((s, p) => s + outstandingOf(p), 0);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["payables"] });

  const createMut = useMutation({
    mutationFn: (data: Partial<Payable>) => createPayable(data),
    onSuccess: () => { invalidate(); setOpen(false); toast.success("Payable added"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Payable> }) => updatePayable(id, data),
    onSuccess: () => { invalidate(); setOpen(false); setEditing(null); toast.success("Payable updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deletePayable,
    onSuccess: () => { invalidate(); toast.success("Payable deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm(), is_check: tab === "checks" }); setOpen(true); };

  const openEdit = (p: Payable) => {
    setEditing(p);
    setForm({
      payee: p.payee,
      supplier_id: p.supplier_id || NO_SUPPLIER,
      amount: String(p.amount ?? ""),
      amount_paid: String(p.amount_paid ?? ""),
      due_date: p.due_date || "",
      status: p.status,
      is_check: p.is_check,
      check_number: p.check_number || "",
      check_bank: p.check_bank || "",
      date_written: p.date_written || "",
      category: p.category || "",
      notes: p.notes || "",
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.payee.trim()) { toast.error("Payee is required"); return; }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { toast.error("Enter an amount greater than zero"); return; }
    const data: Partial<Payable> = {
      payee: form.payee.trim(),
      supplier_id: form.supplier_id === NO_SUPPLIER ? null : form.supplier_id,
      amount,
      amount_paid: Number(form.amount_paid) || 0,
      due_date: form.due_date || null,
      status: form.status,
      is_check: form.is_check,
      check_number: form.is_check ? form.check_number.trim() : "",
      check_bank: form.is_check ? form.check_bank.trim() : "",
      date_written: form.is_check && form.date_written ? form.date_written : null,
      category: form.category.trim(),
      notes: form.notes,
    };
    if (editing) updateMut.mutate({ id: editing.id, data });
    else createMut.mutate(data);
  };

  /** Picking a supplier fills the payee field when it is still blank. */
  const handleSupplierChange = (value: string) => {
    const supplier = suppliers.find((s: any) => s.id === value);
    setForm((prev) => ({
      ...prev,
      supplier_id: value,
      payee: prev.payee.trim() || (supplier ? supplier.name : prev.payee),
    }));
  };

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Payables</h1>
          <p className="page-description">Post-dated checks and company payables</p>
        </div>
        <div className="toolbar-actions">
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> Add Payable
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Outstanding" value={peso(totalOutstanding)} icon={Wallet} description="Unpaid and partial" />
        <StatCard title="Post-Dated Checks" value={peso(checksOutstanding)} icon={CalendarClock} description="Not yet cleared" />
        <StatCard title="Overdue" value={peso(overdueTotal)} icon={AlertTriangle} description={`${overdue.length} past due`} />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search payables..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payables</SelectItem>
            <SelectItem value="checks">Post-dated checks</SelectItem>
            <SelectItem value="bills">General payables</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Payable" : "New Payable"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <Label className="text-xs font-medium">Post-dated check</Label>
                <p className="text-[11px] text-muted-foreground">Adds check number, bank, and date written</p>
              </div>
              <Switch checked={form.is_check} onCheckedChange={(v) => setForm({ ...form, is_check: v })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Supplier</Label>
              <Select value={form.supplier_id} onValueChange={handleSupplierChange}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUPPLIER}>Not a supplier</SelectItem>
                  {suppliers.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Payee *</Label>
              <Input value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Amount *</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Amount Paid</Label>
                <Input type="number" step="0.01" min="0" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Due Date</Label>
                <DateField value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Payable["status"] })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.is_check && (
              <div className="grid gap-3 rounded-lg border p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Check Number</Label>
                    <Input value={form.check_number} onChange={(e) => setForm({ ...form, check_number: e.target.value })} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Check Bank</Label>
                    <Input value={form.check_bank} onChange={(e) => setForm({ ...form, check_bank: e.target.value })} className="h-9" placeholder="e.g. BDO" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Date Written</Label>
                  <DateField value={form.date_written} onChange={(v) => setForm({ ...form, date_written: v })} placeholder="Optional" />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Category</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-9" placeholder="e.g. Rent, Utilities" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} className="rounded-lg h-9">
              {editing ? "Save Changes" : "Add Payable"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader sortKey="payee" label="Payee" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs">Check No.</TableHead>
              <SortableHeader sortKey="amount" label="Amount" sort={sort} onToggle={toggle} align="right" />
              <TableHead className="text-xs text-right">Outstanding</TableHead>
              <SortableHeader sortKey="due_date" label="Due Date" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="status" label="Status" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><Wallet className="empty-state-icon" /><p className="text-sm">No payables yet</p></div></TableCell></TableRow>
            ) : sorted.map((p) => (
              <TableRow key={p.id} className="hover:bg-muted/30">
                <TableCell className="text-sm font-medium">
                  {p.payee}
                  {p.category && <span className="ml-2 text-xs text-muted-foreground">{p.category}</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {p.is_check ? `${p.check_number || "—"}${p.check_bank ? ` · ${p.check_bank}` : ""}` : "—"}
                </TableCell>
                <TableCell className="text-sm text-right">{peso(Number(p.amount))}</TableCell>
                <TableCell className="text-sm text-right font-medium">{peso(outstandingOf(p))}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDate(p.due_date)}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[p.status]} className="text-xs font-normal">{STATUS_LABELS[p.status]}</Badge></TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)} className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(p.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
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
