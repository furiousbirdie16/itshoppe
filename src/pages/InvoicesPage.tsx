import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInvoices, createInvoice, deleteInvoice, getCustomers, getItems, createInvoiceItems, getInvoiceItems, confirmInvoice, revertInvoice, updateInvoice, generateInvoiceNumber, deleteInvoiceItems, getSalesAgents, createSalesAgent } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Trash2, Eye, CheckCircle, DollarSign, Receipt, FileDown, Undo2, Pencil, Filter, Search } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import { ItemSearch } from "@/components/ItemSearch";
import { CustomerSearch } from "@/components/CustomerSearch";
import { toast } from "sonner";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";
import { useAuth } from "@/contexts/AuthContext";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { DateField } from "@/components/DateField";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";
import { format, addDays, parseISO } from "date-fns";

interface LineItem { item_id: string; item_name: string; quantity: number; unit_price: number; variation_id: string | null; }

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const filterDateToRef = useRef<HTMLInputElement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewInv, setViewInv] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DocumentData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", notes: "", due_date: "", sales_agent: "", payment_terms: "" });
  const [lines, setLines] = useState<LineItem[]>([{ item_id: "", item_name: "", quantity: 1, unit_price: 0, variation_id: null }]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filters
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [filterAgent, setFilterAgent] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: getInvoices });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: invItems = [] } = useQuery({ queryKey: ["invoice_items", viewInv], queryFn: () => getInvoiceItems(viewInv!), enabled: !!viewInv });
  const { data: salesAgents = [] } = useQuery({ queryKey: ["sales_agents"], queryFn: getSalesAgents });
  const [newAgentName, setNewAgentName] = useState("");
  const [addingAgent, setAddingAgent] = useState(false);

  const addAgentMut = useMutation({
    mutationFn: (name: string) => createSalesAgent(name),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["sales_agents"] });
      setForm(f => ({ ...f, sales_agent: data.name }));
      setNewAgentName("");
      setAddingAgent(false);
      toast.success("Sales agent added");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return invoices.filter((inv: any) => {
      if (filterDateFrom && (inv.invoice_date || "") < filterDateFrom) return false;
      if (filterDateTo && (inv.invoice_date || "") > filterDateTo) return false;
      if (filterCustomer !== "all" && inv.customer_id !== filterCustomer) return false;
      if (filterAgent !== "all" && (inv.sales_agent || "") !== filterAgent) return false;
      if (filterStatus !== "all" && inv.status !== filterStatus) return false;
      if (q) {
        const hay = [
          inv.invoice_number,
          inv.customers?.name,
          inv.sales_agent,
          inv.notes,
        ].map((x: any) => String(x || "").toLowerCase()).join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, filterDateFrom, filterDateTo, filterCustomer, filterAgent, filterStatus, searchQuery]);

  const { sort, toggle, sorted: sortedInvoices } = useSort<any>(filtered, {
    invoice_number: (r) => r.invoice_number,
    customer: (r) => r.customers?.name || "",
    sales_agent: (r) => r.sales_agent || "",
    invoice_date: (r) => r.invoice_date,
    status: (r) => r.status,
    total_amount: (r) => Number(r.total_amount),
  });

  // Total sales (admin only) — sum of confirmed/paid invoices in current filter
  const totalSales = useMemo(() => {
    return filtered
      .filter((inv: any) => inv.status === "confirmed" || inv.status === "paid")
      .reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0);
  }, [filtered]);

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((i: any) => i.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const bulkDeleteMut = useMutation({
    mutationFn: async () => { for (const id of selectedIds) await deleteInvoice(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setSelectedIds(new Set()); toast.success(`Deleted ${selectedIds.size} invoices`); },
  });

  const openPreview = async (inv: any) => {
    const lineItems = await getInvoiceItems(inv.id);
    setPreviewData({
      type: "invoice",
      number: inv.invoice_number,
      date: inv.invoice_date,
      status: inv.status,
      notes: inv.notes,
      recipientLabel: "Customer",
      recipientName: inv.customers?.name || "—",
      recipientContact: inv.customers?.contact_person,
      recipientEmail: inv.customers?.email,
      recipientPhone: inv.customers?.phone,
      recipientAddress: inv.customers?.address,
      extraFields: [
        ...(inv.due_date ? [{ label: "Due Date", value: inv.due_date }] : []),
        ...(inv.sales_agent ? [{ label: "Sales Agent", value: inv.sales_agent }] : []),
      ],
      items: lineItems.map((li: any) => ({
        name: li.item_variations?.name || li.item_name || li.items?.name || "—",
        sku: li.item_variations?.sku || li.items?.sku,
        quantity: li.quantity,
        unitPrice: Number(li.unit_price),
        total: li.quantity * Number(li.unit_price),
      })),
      totalAmount: Number(inv.total_amount),
    });
    setPreviewOpen(true);
  };

  const openEdit = async (inv: any) => {
    const lineItems = await getInvoiceItems(inv.id);
    setForm({
      customer_id: inv.customer_id || "",
      notes: inv.notes || "",
      due_date: inv.due_date || "",
      sales_agent: inv.sales_agent || "",
    });
    setLines(
      lineItems.length > 0
        ? lineItems.map((li: any) => ({
            item_id: li.item_id || "",
            item_name: li.item_name || li.items?.name || "",
            quantity: li.quantity,
            unit_price: Number(li.unit_price),
            variation_id: li.variation_id || null,
          }))
        : [{ item_id: "", item_name: "", quantity: 1, unit_price: 0, variation_id: null }]
    );
    setEditId(inv.id);
    setCreateOpen(true);
  };

  const validateLines = () => {
    const saved = lines.filter(l => l.item_id || l.item_name);
    if (saved.length === 0) throw new Error("Add at least one item");
    for (const l of saved) {
      const name = l.item_name || "Item";
      if (!l.quantity || Number(l.quantity) <= 0) throw new Error(`"${name}" must have a quantity greater than 0`);
      if (!l.unit_price || Number(l.unit_price) <= 0) throw new Error(`"${name}" must have a price greater than 0`);
    }
    return saved;
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const saved = validateLines();
      const total = saved.reduce((s, l) => s + l.quantity * l.unit_price, 0);
      const inv = await createInvoice({ invoice_number: await generateInvoiceNumber(), customer_id: form.customer_id || null, notes: form.notes, due_date: form.due_date || null, total_amount: total, sales_agent: form.sales_agent });
      await createInvoiceItems(saved.map(l => ({ invoice_id: inv.id, item_id: l.item_id || null, item_name: l.item_name || null, quantity: l.quantity, unit_price: l.unit_price, variation_id: l.variation_id || null })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setCreateOpen(false); toast.success("Invoice created"); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const editMut = useMutation({
    mutationFn: async () => {
      if (!editId) return;
      const saved = validateLines();
      const total = saved.reduce((s, l) => s + l.quantity * l.unit_price, 0);
      await updateInvoice(editId, { customer_id: form.customer_id || null, notes: form.notes, due_date: form.due_date || null, total_amount: total, sales_agent: form.sales_agent });
      await deleteInvoiceItems(editId);
      await createInvoiceItems(saved.map(l => ({ invoice_id: editId, item_id: l.item_id || null, item_name: l.item_name || null, quantity: l.quantity, unit_price: l.unit_price, variation_id: l.variation_id || null })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setCreateOpen(false); setEditId(null); toast.success("Invoice updated"); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteInvoice,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); toast.success("Deleted"); },
  });

  const confirmMut = useMutation({
    mutationFn: confirmInvoice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Invoice confirmed — stock deducted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const markPaidMut = useMutation({
    mutationFn: (id: string) => updateInvoice(id, { status: "paid" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); toast.success("Marked as paid"); },
  });

  const revertMut = useMutation({
    mutationFn: revertInvoice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Invoice reverted to draft — stock restored");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => { setForm({ customer_id: "", notes: "", due_date: "", sales_agent: "" }); setLines([{ item_id: "", item_name: "", quantity: 1, unit_price: 0, variation_id: null }]); setEditId(null); };
  const handleClose = () => { setCreateOpen(false); setEditId(null); resetForm(); };
  const addLine = () => setLines([...lines, { item_id: "", item_name: "", quantity: 1, unit_price: 0, variation_id: null }]);
  const updateLine = (idx: number, field: string, value: any) => {
    const newLines = [...lines];
    (newLines[idx] as any)[field] = value;
    if (field === "item_id") {
      const item = items.find(i => i.id === value);
      if (item) {
        newLines[idx].unit_price = Number(item.selling_price);
        newLines[idx].item_name = item.name;
      }
    }
    setLines(newLines);
  };
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const clearFilters = () => { setFilterDateFrom(""); setFilterDateTo(""); setFilterCustomer("all"); setFilterAgent("all"); setFilterStatus("all"); };

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Invoices</h1>
          <p className="page-description">{filtered.length} invoice{filtered.length !== 1 ? "s" : ""}{filtered.length !== invoices.length ? ` (filtered from ${invoices.length})` : ""}</p>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (
            <>
              <BulkEditDialog
                selectedIds={Array.from(selectedIds)}
                entityLabel="invoices"
                fields={[
                  { key: "status", label: "Status", type: "select", options: [
                    { value: "draft", label: "Not Shipped" },
                    { value: "confirmed", label: "Shipped" },
                    { value: "paid", label: "Paid" },
                    { value: "unpaid", label: "Unpaid" },
                  ]},
                  { key: "sales_agent", label: "Sales Agent", type: "select", options: salesAgents.map((a: any) => ({ value: a.name, label: a.name })) },
                  { key: "due_date", label: "Due Date", type: "date" },
                  { key: "notes", label: "Notes", type: "textarea" },
                ] as BulkField[]}
                updateOne={async (id, patch) => { await updateInvoice(id, patch as any); }}
                onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setSelectedIds(new Set()); }}
              />
              <Button variant="destructive" size="sm" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete {selectedIds.size} selected
              </Button>
            </>
          )}
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search invoice #, customer, agent..."
              className="h-9 pl-8 text-sm w-[260px]"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="rounded-lg h-9 px-3 text-sm">
            <Filter className="h-4 w-4 mr-1.5" /> Filters
          </Button>
          <ExportButton
            data={filtered}
            columns={{
              "Invoice #": (r: any) => r.invoice_number,
              "Date": (r: any) => r.invoice_date,
              "Customer": (r: any) => r.customers?.name || "",
              "Sales Agent": (r: any) => r.sales_agent || "",
              "Status": (r: any) => r.status,
              "Due Date": (r: any) => r.due_date || "",
              "Invoice Total": (r: any) => r.total_amount,
              "Notes": (r: any) => r.notes || "",
            }}
            childItems={{
              table: "invoice_items",
              foreignKey: "invoice_id",
              select: "*, items(name, sku), item_variations(name, sku)",
              columns: {
                "Item Name": (li: any) => li.item_variations?.name || li.item_name || li.items?.name || "",
                "SKU": (li: any) => li.item_variations?.sku || li.items?.sku || "",
                "Variation": (li: any) => li.item_variations?.name || "",
                "Quantity": (li: any) => Number(li.quantity || 0),
                "Unit Price": (li: any) => Number(li.unit_price || 0),
                "Line Total": (li: any) => Number(li.quantity || 0) * Number(li.unit_price || 0),
              },
            }}
            dateField={(r: any) => r.invoice_date || ""}
            fileName="Invoices"
          />
          <Button onClick={() => { resetForm(); setCreateOpen(true); }} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> New Invoice
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="filter-bar">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Date From</Label>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setFilterDateFrom(e.target.value);
                if (!e.target.value) return;
                requestAnimationFrame(() => {
                  filterDateToRef.current?.focus();
                  filterDateToRef.current?.showPicker?.();
                });
              }}
              className="h-9 sm:h-8 sm:w-36 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Date To</Label>
            <Input ref={filterDateToRef} type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="h-9 sm:h-8 sm:w-36 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Customer</Label>
            <Select value={filterCustomer} onValueChange={setFilterCustomer}>
              <SelectTrigger className="h-9 sm:h-8 sm:w-44 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Sales Agent</Label>
            <Select value={filterAgent} onValueChange={setFilterAgent}>
              <SelectTrigger className="h-9 sm:h-8 sm:w-44 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {salesAgents.map((a: any) => <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Status</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-9 sm:h-8 sm:w-40 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Not Shipped</SelectItem>
                <SelectItem value="confirmed">Shipped</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">Clear</Button>
        </div>
      )}

      {isAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 sm:p-4 rounded-lg border bg-primary/5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Sales</p>
            <p className="text-xs text-muted-foreground mt-0.5">Sum of shipped &amp; paid invoices in current filter</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums truncate">{peso(totalSales)}</p>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">{editId ? "Edit Invoice" : "New Invoice"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Customer</Label>
                <CustomerSearch customers={customers} value={form.customer_id} onChange={v => setForm({ ...form, customer_id: v })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Sales Agent</Label>
                {!addingAgent ? (
                  <div className="flex gap-1.5">
                    <Select value={form.sales_agent} onValueChange={v => setForm({ ...form, sales_agent: v })}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Select agent" /></SelectTrigger>
                      <SelectContent>
                        {salesAgents.map((a: any) => <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setAddingAgent(true)} title="Add new agent"><Plus className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <Input value={newAgentName} onChange={e => setNewAgentName(e.target.value)} className="h-9" placeholder="New agent name" autoFocus />
                    <Button type="button" size="sm" className="h-9 px-3 text-xs" disabled={!newAgentName.trim() || addAgentMut.isPending} onClick={() => addAgentMut.mutate(newAgentName.trim())}>Save</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={() => { setAddingAgent(false); setNewAgentName(""); }}>Cancel</Button>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Due Date</Label>
              <DateField value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="resize-none" rows={2} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-medium">Line Items</Label>
                <Button variant="outline" size="sm" onClick={addLine} className="h-7 rounded-md text-xs"><Plus className="h-3 w-3 mr-1" /> Add</Button>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => {
                  const selectedItem = items.find(i => i.id === line.item_id);
                  return (
                    <div key={idx}>
                      <div className="grid grid-cols-[1fr_70px_90px_32px] gap-2">
                        <ItemSearch
                          items={items}
                          value={line.item_id}
                          variationId={line.variation_id}
                          customName={line.item_name}
                          onChange={(itemId, item, customName, variation) => {
                            const newLines = [...lines];
                            if (variation && item) {
                              newLines[idx].item_id = item.id;
                              newLines[idx].item_name = variation.name;
                              newLines[idx].variation_id = variation.id;
                              newLines[idx].unit_price = Number(variation.selling_price);
                            } else if (itemId) {
                              newLines[idx].item_id = itemId;
                              newLines[idx].item_name = item?.name || "";
                              newLines[idx].variation_id = null;
                              if (item) newLines[idx].unit_price = Number(item.selling_price);
                            } else {
                              newLines[idx].item_id = "";
                              newLines[idx].item_name = customName || "";
                              newLines[idx].variation_id = null;
                            }
                            setLines(newLines);
                          }}
                          placeholder="Search item or variation..."
                          allowCustom
                        />
                        <Input type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, "quantity", parseInt(e.target.value) || 1)} className="h-9 text-sm" placeholder="Qty" />
                        <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, "unit_price", parseFloat(e.target.value) || 0)} className="h-9 text-sm" placeholder="Price" />
                        <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-9 w-8"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                      </div>
                      {selectedItem && <p className="text-[11px] text-muted-foreground mt-0.5 ml-1">In stock: {selectedItem.quantity}{(selectedItem.units_per_stock ?? 1) > 1 && (selectedItem.open_roll_remaining ?? 0) > 0 ? ` + ${selectedItem.open_roll_remaining}${selectedItem.base_unit || 'm'} open` : ''}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">Total: {peso(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0))}</span>
              </div>
            </div>
            <Button
              onClick={() => editId ? editMut.mutate() : createMut.mutate()}
              disabled={createMut.isPending || editMut.isPending}
              className="rounded-lg h-9"
            >
              {editId ? "Update Invoice" : "Create Invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewInv} onOpenChange={() => setViewInv(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">Invoice Details</DialogTitle></DialogHeader>
          <div className="data-table-wrapper mt-2">
            <Table>
              <TableHeader><TableRow><TableHead className="text-xs">SKU</TableHead><TableHead className="text-xs">Item</TableHead><TableHead className="text-xs">Qty</TableHead><TableHead className="text-xs text-right">Price</TableHead><TableHead className="text-xs text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {invItems.map(ii => (
                  <TableRow key={ii.id}>
                     <TableCell className="font-mono text-xs text-primary font-medium">{(ii as any).item_variations?.sku || ii.items?.sku || "—"}</TableCell>
                     <TableCell className="text-sm font-medium">{(ii as any).item_variations?.name || (ii as any).item_name || ii.items?.name || "—"}</TableCell>
                    <TableCell className="text-sm">{ii.quantity}</TableCell>
                    <TableCell className="text-sm text-right">{peso(Number(ii.unit_price))}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{peso(ii.quantity * Number(ii.unit_price))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={filtered.length > 0 && selectedIds.size === filtered.length} onCheckedChange={toggleAll} /></TableHead>
              <SortableHeader sortKey="invoice_number" label="Invoice #" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="customer" label="Customer" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="sales_agent" label="Sales Agent" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="invoice_date" label="Date" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="status" label="Status" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="total_amount" label="Total" sort={sort} onToggle={toggle} align="right" />
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedInvoices.length === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="empty-state"><Receipt className="empty-state-icon" /><p className="text-sm">No invoices</p></div></TableCell></TableRow>
            ) : sortedInvoices.map((inv: any) => (
              <TableRow key={inv.id} className={selectedIds.has(inv.id) ? "bg-muted/40" : "hover:bg-muted/30"}>
                <TableCell><Checkbox checked={selectedIds.has(inv.id)} onCheckedChange={() => toggleOne(inv.id)} /></TableCell>
                <TableCell className="font-mono text-xs font-semibold">{inv.invoice_number}</TableCell>
                <TableCell className="text-sm">{inv.customers?.name || "—"}</TableCell>
                <TableCell className="text-sm">{inv.sales_agent || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{inv.invoice_date}</TableCell>
                <TableCell><StatusBadge status={inv.status} context="invoice" /></TableCell>
                <TableCell className="text-right text-sm font-medium">{peso(Number(inv.total_amount))}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openPreview(inv)} title="Preview & Download PDF" className="h-7 w-7 rounded-md"><FileDown className="h-3.5 w-3.5 text-primary" /></Button>
                    {(inv.status === "draft" || inv.status === "paid" || isAdmin) && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(inv)} title="Edit" className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setViewInv(inv.id)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    {inv.status === "draft" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => confirmMut.mutate(inv.id)} title="Confirm & Deduct Stock (Mark Shipped)" className="h-7 w-7 rounded-md"><CheckCircle className="h-3.5 w-3.5 text-success" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => markPaidMut.mutate(inv.id)} title="Mark as Paid (without shipping)" className="h-7 w-7 rounded-md"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                      </>
                    )}
                    {inv.status === "confirmed" && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => markPaidMut.mutate(inv.id)} title="Mark as Paid" className="h-7 w-7 rounded-md"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => revertMut.mutate(inv.id)} title="Revert to Draft" className="h-7 w-7 rounded-md"><Undo2 className="h-3.5 w-3.5 text-amber-500" /></Button>
                      </>
                    )}
                    {(inv.status === "paid" || inv.status === "unpaid") && (
                      <Button variant="ghost" size="icon" onClick={() => revertMut.mutate(inv.id)} title="Revert to Draft" className="h-7 w-7 rounded-md"><Undo2 className="h-3.5 w-3.5 text-amber-500" /></Button>
                    )}
                    {(inv.status === "draft" || isAdmin) && (
                      <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(inv.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <DocumentPreview open={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} />
    </div>
  );
}
