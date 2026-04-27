import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/currency";
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, Users, Search } from "lucide-react";
import { toast } from "sonner";
import type { Customer } from "@/types/database";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

type Period = "all" | "daily" | "weekly" | "monthly";

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: "", contact_person: "", email: "", phone: "", address: "" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<Period>("all");

  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    if (period === "daily") return { dateFrom: startOfDay(now), dateTo: endOfDay(now) };
    if (period === "weekly") return { dateFrom: startOfWeek(now, { weekStartsOn: 1 }), dateTo: endOfWeek(now, { weekStartsOn: 1 }) };
    if (period === "monthly") return { dateFrom: startOfMonth(now), dateTo: endOfMonth(now) };
    return { dateFrom: null as Date | null, dateTo: null as Date | null };
  }, [period]);

  const fromStr = dateFrom ? format(dateFrom, "yyyy-MM-dd") : null;
  const toStr = dateTo ? format(dateTo, "yyyy-MM-dd") : null;

  const { data: customers = [], isLoading } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });

  // Aggregate invoice stats per customer for selected period
  const { data: customerStats = {} } = useQuery({
    queryKey: ["customer_invoice_stats", fromStr, toStr],
    queryFn: async () => {
      let q = supabase
        .from("invoices")
        .select("id, customer_id, total_amount, invoice_date")
        .in("status", ["confirmed", "paid"]);
      if (fromStr) q = q.gte("invoice_date", fromStr);
      if (toStr) q = q.lte("invoice_date", toStr);
      const { data } = await q;
      const map: Record<string, { orders: number; total: number }> = {};
      for (const inv of (data || []) as any[]) {
        if (!inv.customer_id) continue;
        const e = map[inv.customer_id] || { orders: 0, total: 0 };
        e.orders += 1;
        e.total += Number(inv.total_amount || 0);
        map[inv.customer_id] = e;
      }
      return map;
    },
  });

  type CustomerWithStats = Customer & { _orders: number; _total: number };
  const enriched: CustomerWithStats[] = useMemo(
    () => customers.map((c) => ({
      ...c,
      _orders: customerStats[c.id]?.orders || 0,
      _total: customerStats[c.id]?.total || 0,
    })),
    [customers, customerStats],
  );

  const filtered = enriched.filter((customer) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [customer.name, customer.contact_person, customer.email, customer.phone, customer.address]
      .some((value) => (value || "").toLowerCase().includes(q));
  });

  const toggleAll = () => {
    if (filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const bulkDeleteMut = useMutation({
    mutationFn: async () => { for (const id of selectedIds) await deleteCustomer(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); setSelectedIds(new Set()); toast.success(`Deleted ${selectedIds.size} customers`); },
  });

  const { sort, toggle, sorted: sortedCustomers } = useSort<CustomerWithStats>(filtered, {
    name: (r) => r.name,
    contact_person: (r) => r.contact_person,
    email: (r) => r.email,
    phone: (r) => r.phone,
    _orders: (r) => r._orders,
    _total: (r) => r._total,
  });

  const createMut = useMutation({
    mutationFn: (data: Partial<Customer>) => createCustomer(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); setOpen(false); toast.success("Customer created"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Customer> }) => updateCustomer(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); setOpen(false); setEditing(null); toast.success("Updated"); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteCustomer,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["customers"] }); toast.success("Deleted"); },
  });

  const openCreate = () => { setEditing(null); setForm({ name: "", contact_person: "", email: "", phone: "", address: "" }); setOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm({ name: c.name, contact_person: c.contact_person, email: c.email, phone: c.phone, address: c.address }); setOpen(true); };

  const handleSubmit = () => {
    if (editing) updateMut.mutate({ id: editing.id, data: form });
    else createMut.mutate(form);
  };

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Customers</h1>
          <p className="page-description">{filtered.length} customer{filtered.length !== 1 ? "s" : ""}{filtered.length !== customers.length ? ` (filtered from ${customers.length})` : ""}</p>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (
            <>
              <BulkEditDialog
                selectedIds={Array.from(selectedIds)}
                entityLabel="customers"
                fields={[
                  { key: "contact_person", label: "Contact Person", type: "text" },
                  { key: "email", label: "Email", type: "text" },
                  { key: "phone", label: "Phone", type: "text" },
                  { key: "address", label: "Address", type: "textarea" },
                ] as BulkField[]}
                updateOne={async (id, patch) => { await updateCustomer(id, patch as Partial<Customer>); }}
                onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["customers"] }); setSelectedIds(new Set()); }}
              />
              <Button variant="destructive" size="sm" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete {selectedIds.size} selected
              </Button>
            </>
          )}
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> Add Customer
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          {(["all", "daily", "weekly", "monthly"] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs capitalize"
              onClick={() => setPeriod(p)}
            >
              {p === "all" ? "All time" : p}
            </Button>
          ))}
        </div>
        {dateFrom && dateTo && (
          <span className="text-xs text-muted-foreground">
            {format(dateFrom, "MMM d")} — {format(dateTo, "MMM d, yyyy")}
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Customer" : "New Customer"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Name</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Contact Person</Label>
                <Input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Phone</Label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Email</Label>
              <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Address</Label>
              <Textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="resize-none" rows={2} />
            </div>
            <Button onClick={handleSubmit} className="mt-2 rounded-lg h-9">{editing ? "Update" : "Create Customer"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))} onCheckedChange={toggleAll} /></TableHead>
              <SortableHeader sortKey="name" label="Name" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="contact_person" label="Contact" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="email" label="Email" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="phone" label="Phone" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="_orders" label="# Orders" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="_total" label="Total Orders ₱" sort={sort} onToggle={toggle} align="right" />
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : sortedCustomers.length === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="empty-state"><Users className="empty-state-icon" /><p className="text-sm">No customers yet</p></div></TableCell></TableRow>
            ) : sortedCustomers.map(c => (
              <TableRow key={c.id} className={selectedIds.has(c.id) ? "bg-muted/40" : "hover:bg-muted/30"}>
                <TableCell><Checkbox checked={selectedIds.has(c.id)} onCheckedChange={() => toggleOne(c.id)} /></TableCell>
                <TableCell className="font-medium text-sm">{c.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.contact_person}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.email}</TableCell>
                <TableCell className="text-sm">{c.phone}</TableCell>
                <TableCell className="text-sm text-right font-medium">{c._orders || "—"}</TableCell>
                <TableCell className="text-sm text-right font-semibold">{c._total ? peso(c._total) : "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)} className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(c.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
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
