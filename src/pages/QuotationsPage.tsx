import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQuotations, createQuotation, updateQuotation, deleteQuotation, getCustomers, getItems, createQuotationItems, deleteQuotationItems, getQuotationItems, convertQuotationToInvoice, generateQuotationNumber, getSalesAgents, createSalesAgent } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Trash2, Eye, ArrowRight, FileText, FileDown, Pencil, Filter, AlertCircle } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import { ItemSearch } from "@/components/ItemSearch";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";
import { format, addDays, isBefore, isToday, parseISO } from "date-fns";

interface LineItem { item_id: string; item_name: string; quantity: string; unit_price: string; }

export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewQ, setViewQ] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DocumentData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", notes: "", valid_until: "", sales_agent: "", payment_terms: "", payment_due_date: "" });
  const [lines, setLines] = useState<LineItem[]>([{ item_id: "", item_name: "", quantity: "", unit_price: "" }]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("all");

  // Filters
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [filterAgent, setFilterAgent] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const { data: quotations = [] } = useQuery({ queryKey: ["quotations"], queryFn: getQuotations });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: qItems = [] } = useQuery({ queryKey: ["quotation_items", viewQ], queryFn: () => getQuotationItems(viewQ!), enabled: !!viewQ });

  // Derive unique sales agents for filter dropdown
  const uniqueAgents = useMemo(() => {
    const agents = new Set<string>();
    quotations.forEach((q: any) => { if (q.sales_agent) agents.add(q.sales_agent); });
    return Array.from(agents).sort();
  }, [quotations]);

  // Compute due date for a quotation
  const getDueDate = (q: any): string | null => {
    if (q.payment_due_date) return q.payment_due_date;
    if (q.payment_terms && q.quotation_date) {
      return format(addDays(parseISO(q.quotation_date), q.payment_terms), "yyyy-MM-dd");
    }
    return null; // no terms = due immediately
  };

  const isDue = (q: any): boolean => {
    const due = getDueDate(q);
    if (!due) return true; // no terms = due immediately
    const dueDate = parseISO(due);
    return isBefore(dueDate, new Date()) || isToday(dueDate);
  };

  // Pending payments: accepted/sent quotations that are not yet paid (status != rejected, and due)
  const pendingPayments = useMemo(() => {
    return quotations.filter((q: any) => {
      if (q.status === "rejected") return false;
      if (q.status === "draft") return false;
      // Sent or accepted quotations with pending payment
      return true;
    });
  }, [quotations]);

  // Apply filters
  const applyFilters = (list: any[]) => {
    return list.filter((q: any) => {
      if (filterDateFrom && q.quotation_date < filterDateFrom) return false;
      if (filterDateTo && q.quotation_date > filterDateTo) return false;
      if (filterCustomer !== "all" && q.customer_id !== filterCustomer) return false;
      if (filterAgent !== "all" && (q.sales_agent || "") !== filterAgent) return false;
      return true;
    });
  };

  const filtered = useMemo(() => applyFilters(quotations), [quotations, filterDateFrom, filterDateTo, filterCustomer, filterAgent]);
  const filteredPending = useMemo(() => applyFilters(pendingPayments), [pendingPayments, filterDateFrom, filterDateTo, filterCustomer, filterAgent]);

  const currentList = activeTab === "pending" ? filteredPending : filtered;

  const toggleAll = () => {
    if (selectedIds.size === currentList.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(currentList.map((q: any) => q.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const bulkDeleteMut = useMutation({
    mutationFn: async () => { for (const id of selectedIds) await deleteQuotation(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); setSelectedIds(new Set()); toast.success(`Deleted ${selectedIds.size} quotations`); },
  });

  const parseQty = (v: string) => parseInt(v) || 0;
  const parsePrice = (v: string) => parseFloat(v) || 0;
  const lineTotal = (l: LineItem) => parseQty(l.quantity) * parsePrice(l.unit_price);

  const openPreview = async (q: any) => {
    const lineItems = await getQuotationItems(q.id);
    const dueDate = getDueDate(q);
    setPreviewData({
      type: "quotation",
      number: q.quotation_number,
      date: q.quotation_date,
      status: q.status,
      notes: q.notes,
      recipientLabel: "Customer",
      recipientName: q.customers?.name || "—",
      recipientContact: q.customers?.contact_person,
      recipientEmail: q.customers?.email,
      recipientPhone: q.customers?.phone,
      recipientAddress: q.customers?.address,
      extraFields: [
        ...(q.valid_until ? [{ label: "Valid Until", value: q.valid_until }] : []),
        ...(q.sales_agent ? [{ label: "Sales Agent", value: q.sales_agent }] : []),
        ...(q.payment_terms ? [{ label: "Payment Terms", value: `${q.payment_terms} days` }] : []),
        ...(dueDate ? [{ label: "Payment Due", value: dueDate }] : []),
      ],
      items: lineItems.map((li: any) => ({
        name: li.items?.name || li.item_name || "—",
        sku: li.items?.sku,
        quantity: li.quantity,
        unitPrice: Number(li.unit_price),
        total: li.quantity * Number(li.unit_price),
      })),
      totalAmount: Number(q.total_amount),
    });
    setPreviewOpen(true);
  };

  const openEdit = async (q: any) => {
    const lineItems = await getQuotationItems(q.id);
    setForm({
      customer_id: q.customer_id || "",
      notes: q.notes || "",
      valid_until: q.valid_until || "",
      sales_agent: q.sales_agent || "",
      payment_terms: q.payment_terms != null ? String(q.payment_terms) : "",
      payment_due_date: q.payment_due_date || "",
    });
    setLines(
      lineItems.length > 0
        ? lineItems.map((li: any) => ({
            item_id: li.item_id || "",
            item_name: li.item_name || li.items?.name || "",
            quantity: String(li.quantity),
            unit_price: String(Number(li.unit_price)),
          }))
        : [{ item_id: "", item_name: "", quantity: "", unit_price: "" }]
    );
    setEditId(q.id);
    setCreateOpen(true);
  };

  const buildPayload = () => {
    const total = lines.reduce((s, l) => s + lineTotal(l), 0);
    const paymentTerms = form.payment_terms ? parseInt(form.payment_terms) : null;
    let paymentDueDate = form.payment_due_date || null;
    // Auto-calculate due date from terms if not manually set
    if (!paymentDueDate && paymentTerms && form.valid_until) {
      // We'll use quotation_date (today for new) to compute
    }
    return {
      customer_id: form.customer_id || null,
      notes: form.notes,
      valid_until: form.valid_until || null,
      total_amount: total,
      sales_agent: form.sales_agent,
      payment_terms: paymentTerms,
      payment_due_date: paymentDueDate,
    } as any;
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const total = lines.reduce((s, l) => s + lineTotal(l), 0);
      const payload = buildPayload();
      payload.quotation_number = await generateQuotationNumber();
      payload.total_amount = total;
      const q = await createQuotation(payload);
      await createQuotationItems(lines.filter(l => l.item_id || l.item_name).map(l => ({ quotation_id: q.id, item_id: l.item_id || null, item_name: l.item_name || null, quantity: parseQty(l.quantity), unit_price: parsePrice(l.unit_price) })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); setCreateOpen(false); toast.success("Quotation created"); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const editMut = useMutation({
    mutationFn: async () => {
      if (!editId) return;
      const payload = buildPayload();
      payload.total_amount = lines.reduce((s, l) => s + lineTotal(l), 0);
      await updateQuotation(editId, payload);
      await deleteQuotationItems(editId);
      await createQuotationItems(lines.filter(l => l.item_id || l.item_name).map(l => ({ quotation_id: editId, item_id: l.item_id || null, item_name: l.item_name || null, quantity: parseQty(l.quantity), unit_price: parsePrice(l.unit_price) })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); setCreateOpen(false); setEditId(null); toast.success("Quotation updated"); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteQuotation,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); toast.success("Deleted"); },
  });

  const convertMut = useMutation({
    mutationFn: convertQuotationToInvoice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Converted to invoice");
      navigate("/invoices");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => { setForm({ customer_id: "", notes: "", valid_until: "", sales_agent: "", payment_terms: "", payment_due_date: "" }); setLines([{ item_id: "", item_name: "", quantity: "", unit_price: "" }]); setEditId(null); };
  const addLine = () => setLines([...lines, { item_id: "", item_name: "", quantity: "", unit_price: "" }]);
  const updateLine = (idx: number, field: string, value: any) => {
    const newLines = [...lines];
    (newLines[idx] as any)[field] = value;
    if (field === "item_id") {
      const item = items.find(i => i.id === value);
      if (item) {
        newLines[idx].unit_price = String(Number(item.selling_price));
        newLines[idx].item_name = item.name;
      }
    }
    setLines(newLines);
  };
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  const handleClose = () => { setCreateOpen(false); setEditId(null); resetForm(); };
  const clearFilters = () => { setFilterDateFrom(""); setFilterDateTo(""); setFilterCustomer("all"); setFilterAgent("all"); };

  const renderTable = (list: any[], isPendingTab: boolean) => (
    <div className="data-table-wrapper">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"><Checkbox checked={list.length > 0 && selectedIds.size === list.length} onCheckedChange={toggleAll} /></TableHead>
            <TableHead className="text-xs">Quotation #</TableHead>
            <TableHead className="text-xs">Customer</TableHead>
            <TableHead className="text-xs">Sales Agent</TableHead>
            <TableHead className="text-xs">Date</TableHead>
            {isPendingTab && <TableHead className="text-xs">Terms</TableHead>}
            {isPendingTab && <TableHead className="text-xs">Due Date</TableHead>}
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs text-right">Total</TableHead>
            <TableHead className="text-xs text-right w-28">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.length === 0 ? (
            <TableRow><TableCell colSpan={isPendingTab ? 10 : 8}><div className="empty-state"><FileText className="empty-state-icon" /><p className="text-sm">{isPendingTab ? "No pending payments" : "No quotations"}</p></div></TableCell></TableRow>
          ) : list.map((q: any) => {
            const dueDate = getDueDate(q);
            const overdue = isPendingTab && isDue(q);
            return (
              <TableRow key={q.id} className={selectedIds.has(q.id) ? "bg-muted/40" : overdue ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/30"}>
                <TableCell><Checkbox checked={selectedIds.has(q.id)} onCheckedChange={() => toggleOne(q.id)} /></TableCell>
                <TableCell className="font-mono text-xs font-semibold">{q.quotation_number}</TableCell>
                <TableCell className="text-sm">{q.customers?.name || "—"}</TableCell>
                <TableCell className="text-sm">{q.sales_agent || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{q.quotation_date}</TableCell>
                {isPendingTab && (
                  <TableCell className="text-sm">
                    {q.payment_terms ? `${q.payment_terms} days` : <span className="text-destructive font-medium">Due now</span>}
                  </TableCell>
                )}
                {isPendingTab && (
                  <TableCell className="text-sm">
                    {dueDate ? (
                      <span className={overdue ? "text-destructive font-medium" : ""}>
                        {overdue && <AlertCircle className="h-3 w-3 inline mr-1" />}
                        {dueDate}
                      </span>
                    ) : (
                      <span className="text-destructive font-medium">
                        <AlertCircle className="h-3 w-3 inline mr-1" />Overdue
                      </span>
                    )}
                  </TableCell>
                )}
                <TableCell><StatusBadge status={q.status} /></TableCell>
                <TableCell className="text-right text-sm font-medium">{peso(Number(q.total_amount))}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openPreview(q)} title="Preview & Download PDF" className="h-7 w-7 rounded-md"><FileDown className="h-3.5 w-3.5 text-primary" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(q)} title="Edit" className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setViewQ(q.id)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    {q.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => convertMut.mutate(q.id)} title="Convert to Invoice" className="h-7 w-7 rounded-md"><ArrowRight className="h-3.5 w-3.5 text-primary" /></Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(q.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Quotations</h1>
          <p className="page-description">{currentList.length} quotation{currentList.length !== 1 ? "s" : ""}{currentList.length !== quotations.length && activeTab === "all" ? ` (filtered from ${quotations.length})` : ""}</p>
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete {selectedIds.size} selected
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="rounded-lg h-9 px-3 text-sm">
            <Filter className="h-4 w-4 mr-1.5" /> Filters
          </Button>
          <ExportButton
            data={currentList}
            columns={{ "Quotation #": (r: any) => r.quotation_number, "Customer": (r: any) => r.customers?.name || "", "Sales Agent": (r: any) => r.sales_agent || "", "Status": (r: any) => r.status, "Date": (r: any) => r.quotation_date, "Payment Terms": (r: any) => r.payment_terms ? `${r.payment_terms} days` : "", "Due Date": (r: any) => getDueDate(r) || "", "Valid Until": (r: any) => r.valid_until || "", "Total": (r: any) => r.total_amount }}
            dateField={(r: any) => r.quotation_date || ""}
            fileName="Quotations"
          />
          <Button onClick={() => { resetForm(); setCreateOpen(true); }} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> New Quotation
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg border bg-card">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Date From</Label>
            <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="h-8 w-36 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Date To</Label>
            <Input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} className="h-8 w-36 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Customer</Label>
            <Select value={filterCustomer} onValueChange={setFilterCustomer}>
              <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Sales Agent</Label>
            <Select value={filterAgent} onValueChange={setFilterAgent}>
              <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                {uniqueAgents.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">Clear</Button>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={createOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">{editId ? "Edit Quotation" : "New Quotation"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Customer</Label>
                <Select value={form.customer_id} onValueChange={v => setForm({ ...form, customer_id: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Sales Agent</Label>
                <Input value={form.sales_agent} onChange={e => setForm({ ...form, sales_agent: e.target.value })} className="h-9" placeholder="Agent name" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Valid Until</Label>
                <Input type="date" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Terms (days)</Label>
                <Input type="number" min={0} value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} className="h-9" placeholder="e.g. 30" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Due Date</Label>
                <Input type="date" value={form.payment_due_date} onChange={e => setForm({ ...form, payment_due_date: e.target.value })} className="h-9" />
              </div>
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
                          customName={line.item_name}
                          onChange={(itemId, item, customName) => {
                            const newLines = [...lines];
                            if (itemId) {
                              newLines[idx].item_id = itemId;
                              newLines[idx].item_name = item?.name || "";
                              if (item) newLines[idx].unit_price = String(Number(item.selling_price));
                            } else {
                              newLines[idx].item_id = "";
                              newLines[idx].item_name = customName || "";
                            }
                            setLines(newLines);
                          }}
                          placeholder="Search or type custom item..."
                          allowCustom
                        />
                        <Input type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, "quantity", e.target.value)} className="h-9 text-sm" placeholder="Qty" />
                        <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, "unit_price", e.target.value)} className="h-9 text-sm" placeholder="Price" />
                        <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-9 w-8"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                      </div>
                      {selectedItem && <p className="text-[11px] text-muted-foreground mt-0.5 ml-1">In stock: {selectedItem.quantity}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">Total: {peso(lines.reduce((s, l) => s + lineTotal(l), 0))}</span>
              </div>
            </div>
            <Button
              onClick={() => editId ? editMut.mutate() : createMut.mutate()}
              disabled={createMut.isPending || editMut.isPending}
              className="rounded-lg h-9"
            >
              {editId ? "Update Quotation" : "Create Quotation"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Details Dialog */}
      <Dialog open={!!viewQ} onOpenChange={() => setViewQ(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">Quotation Details</DialogTitle></DialogHeader>
          <div className="data-table-wrapper mt-2">
            <Table>
              <TableHeader><TableRow><TableHead className="text-xs">SKU</TableHead><TableHead className="text-xs">Item</TableHead><TableHead className="text-xs">Qty</TableHead><TableHead className="text-xs text-right">Price</TableHead><TableHead className="text-xs text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {qItems.map(qi => (
                  <TableRow key={qi.id}>
                     <TableCell className="font-mono text-xs text-primary font-medium">{qi.items?.sku || "—"}</TableCell>
                     <TableCell className="text-sm font-medium">{qi.items?.name || (qi as any).item_name || "—"}</TableCell>
                    <TableCell className="text-sm">{qi.quantity}</TableCell>
                    <TableCell className="text-sm text-right">{peso(Number(qi.unit_price))}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{peso(qi.quantity * Number(qi.unit_price))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tabs: All Quotations / Pending Payments */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSelectedIds(new Set()); }}>
        <TabsList>
          <TabsTrigger value="all">All Quotations</TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5">
            Pending Payments
            {pendingPayments.length > 0 && (
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-destructive/10 text-destructive text-[10px] font-semibold px-1.5 py-0.5 min-w-[18px]">
                {pendingPayments.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          {renderTable(filtered, false)}
        </TabsContent>
        <TabsContent value="pending" className="mt-4">
          {renderTable(filteredPending, true)}
        </TabsContent>
      </Tabs>

      <DocumentPreview open={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} />
    </div>
  );
}
