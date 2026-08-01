import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQuotations, createQuotation, updateQuotation, deleteQuotation, getCustomers, getItems, createQuotationItems, deleteQuotationItems, getQuotationItems, convertQuotationToInvoice, generateQuotationNumber, getSalesAgents, createSalesAgent, revertQuotation, getLastSalesAgentForCustomer } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Trash2, Eye, ArrowRight, FileText, FileDown, Pencil, Filter, Undo2, Lock } from "lucide-react";
import { isQuotationLocked, QUOTATION_LOCK_MESSAGE } from "@/lib/permissions";
import ExportButton from "@/components/ExportButton";
import { ItemSearch } from "@/components/ItemSearch";
import { CustomerSearchWithCreate } from "@/components/CustomerSearchWithCreate";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";
import { format, addDays, parseISO } from "date-fns";
import { checkStoreStock, formatShortageMessage } from "@/lib/stockCheck";
import { CustomerPriceHint } from "@/components/CustomerPriceHint";
import { useAuth } from "@/contexts/AuthContext";
import { DateField } from "@/components/DateField";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";
import { FilterCombobox } from "@/components/FilterCombobox";
import { useBranch } from "@/contexts/BranchContext";

interface LineItem { item_id: string; item_name: string; quantity: string; unit_price: string; variation_id: string | null; }

export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { activeBranchId } = useBranch();
  const filterDateToRef = useRef<HTMLInputElement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewQ, setViewQ] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DocumentData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", notes: "", valid_until: "", sales_agent: "", payment_terms: "", payment_due_date: "" });
  const [agentAutoFilled, setAgentAutoFilled] = useState(false);
  const handleCustomerChange = async (v: string) => {
    setForm((f) => ({ ...f, customer_id: v }));
    setAgentAutoFilled(false);
    if (!v || editId) return;
    try {
      const agent = await getLastSalesAgentForCustomer(v);
      if (agent) {
        setForm((f) => (f.sales_agent ? f : { ...f, sales_agent: agent }));
        setAgentAutoFilled(true);
      }
    } catch {/* ignore */}
  };
  const [lines, setLines] = useState<LineItem[]>([{ item_id: "", item_name: "", quantity: "", unit_price: "", variation_id: null }]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // Filters
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [filterAgent, setFilterAgent] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const { data: quotations = [] } = useQuery({ queryKey: ["quotations", activeBranchId], queryFn: () => getQuotations(activeBranchId) });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: qItems = [] } = useQuery({ queryKey: ["quotation_items", viewQ], queryFn: () => getQuotationItems(viewQ!), enabled: !!viewQ });
  const { data: salesAgents = [] } = useQuery({ queryKey: ["sales_agents"], queryFn: getSalesAgents });
  const [newAgentName, setNewAgentName] = useState("");
  const [addingAgent, setAddingAgent] = useState(false);

  const addAgentMut = useMutation({
    mutationFn: (name: string) => createSalesAgent(name),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["sales_agents"] });
      setForm({ ...form, sales_agent: data.name });
      setNewAgentName("");
      setAddingAgent(false);
      toast.success("Sales agent added");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Derive unique sales agents for filter dropdown (from DB table)
  const uniqueAgents = useMemo(() => {
    return salesAgents.map((a: any) => a.name).sort();
  }, [salesAgents]);

  // Compute due date for a quotation
  const getDueDate = (q: any): string | null => {
    if (q.payment_due_date) return q.payment_due_date;
    if (q.payment_terms && q.quotation_date) {
      return format(addDays(parseISO(q.quotation_date), q.payment_terms), "yyyy-MM-dd");
    }
    return null; // no terms = due immediately
  };

  // Date-filter base, used to derive available customer/agent options
  const dateFiltered = useMemo(() => quotations.filter((q: any) => {
    if (filterDateFrom && q.quotation_date < filterDateFrom) return false;
    if (filterDateTo && q.quotation_date > filterDateTo) return false;
    return true;
  }), [quotations, filterDateFrom, filterDateTo]);

  // Available customers: those that exist in records matching every other active filter
  const availableCustomers = useMemo(() => {
    const ids = new Set<string>();
    for (const q of dateFiltered) {
      if (filterAgent !== "all" && (q.sales_agent || "") !== filterAgent) continue;
      if (q.customer_id) ids.add(q.customer_id);
    }
    return customers.filter((c: any) => ids.has(c.id));
  }, [dateFiltered, customers, filterAgent]);

  // Available agents: those that exist in records matching every other active filter
  const availableAgents = useMemo(() => {
    const names = new Set<string>();
    for (const q of dateFiltered) {
      if (filterCustomer !== "all" && q.customer_id !== filterCustomer) continue;
      if (q.sales_agent) names.add(q.sales_agent);
    }
    return Array.from(names).sort();
  }, [dateFiltered, filterCustomer]);

  // Apply filters
  const filtered = useMemo(() => {
    return dateFiltered.filter((q: any) => {
      if (filterCustomer !== "all" && q.customer_id !== filterCustomer) return false;
      if (filterAgent !== "all" && (q.sales_agent || "") !== filterAgent) return false;
      return true;
    });
  }, [dateFiltered, filterCustomer, filterAgent]);

  const { sort, toggle, sorted: sortedQuotations } = useSort<any>(filtered, {
    quotation_number: (r) => r.quotation_number,
    customer: (r) => r.customers?.name || "",
    sales_agent: (r) => r.sales_agent || "",
    quotation_date: (r) => r.quotation_date,
    status: (r) => r.status,
    total_amount: (r) => Number(r.total_amount),
  });

  // Admin-only total: sum of accepted quotations in current filter
  const totalSales = useMemo(() => {
    return filtered
      .filter((q: any) => q.status === "accepted")
      .reduce((s: number, q: any) => s + Number(q.total_amount || 0), 0);
  }, [filtered]);

  const toggleAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((q: any) => q.id)));
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
      items: lineItems.map((li: any) => {
        const up = Number(li.unit_price);
        const hasPrice = li.unit_price != null && up > 0;
        return {
          name: li.item_variations?.name || li.item_name || li.items?.name || "—",
          sku: li.item_variations?.sku || li.items?.sku,
          quantity: li.quantity,
          unitPrice: hasPrice ? up : null,
          total: hasPrice ? li.quantity * up : null,
        };
      }),
      totalAmount: Number(q.total_amount),
    });
    setPreviewOpen(true);
  };

  const openEdit = async (q: any) => {
    if (isQuotationLocked(q.status)) {
      toast.error(QUOTATION_LOCK_MESSAGE);
      return;
    }
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
            unit_price: Number(li.unit_price) > 0 ? String(Number(li.unit_price)) : "",
            variation_id: li.variation_id || null,
          }))
        : [{ item_id: "", item_name: "", quantity: "", unit_price: "", variation_id: null }]
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

  const validateLines = () => {
    const saved = lines.filter(l => l.item_id || l.item_name);
    if (saved.length === 0) throw new Error("Add at least one item");
    for (const l of saved) {
      const name = l.item_name || "Item";
      const q = parseQty(l.quantity);
      if (!q || q <= 0) throw new Error(`"${name}" must have a quantity greater than 0`);
    }
    return saved;
  };

  const hasMissingPrice = lines.some(l => (l.item_id || l.item_name) && parsePrice(l.unit_price) <= 0);

  const createMut = useMutation({
    mutationFn: async () => {
      const saved = validateLines();
      const total = lines.reduce((s, l) => s + lineTotal(l), 0);
      const payload = buildPayload();
      payload.quotation_number = await generateQuotationNumber();
      payload.total_amount = total;
      if (!activeBranchId) throw new Error("Select a branch before creating a quotation.");
      payload.branch_id = activeBranchId;
      const q = await createQuotation(payload);
      await createQuotationItems(saved.map(l => ({ quotation_id: q.id, item_id: l.item_id || null, item_name: l.item_name || null, quantity: parseQty(l.quantity), unit_price: parsePrice(l.unit_price), variation_id: l.variation_id || null })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); setCreateOpen(false); toast.success("Quotation created"); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const editMut = useMutation({
    mutationFn: async () => {
      if (!editId) return;
      const saved = validateLines();
      const payload = buildPayload();
      payload.total_amount = lines.reduce((s, l) => s + lineTotal(l), 0);
      await updateQuotation(editId, payload);
      await deleteQuotationItems(editId);
      await createQuotationItems(saved.map(l => ({ quotation_id: editId, item_id: l.item_id || null, item_name: l.item_name || null, quantity: parseQty(l.quantity), unit_price: parsePrice(l.unit_price), variation_id: l.variation_id || null })));
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

  const revertQuotationMut = useMutation({
    mutationFn: revertQuotation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotations"] });
      toast.success("Quotation reverted to draft");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const anySelectedLocked = useMemo(() => {
    return Array.from(selectedIds).some((id) => {
      const q: any = quotations.find((x: any) => x.id === id);
      return q && isQuotationLocked(q.status);
    });
  }, [selectedIds, quotations]);

  const resetForm = () => { setForm({ customer_id: "", notes: "", valid_until: "", sales_agent: "", payment_terms: "", payment_due_date: "" }); setLines([{ item_id: "", item_name: "", quantity: "", unit_price: "", variation_id: null }]); setEditId(null); setAgentAutoFilled(false); };
  const addLine = () => setLines([...lines, { item_id: "", item_name: "", quantity: "", unit_price: "", variation_id: null }]);
  const updateLine = (idx: number, field: string, value: any) => {
    const newLines = [...lines];
    (newLines[idx] as any)[field] = value;
    if (field === "item_id") {
      const item = items.find(i => i.id === value);
      if (item) {
        newLines[idx].item_name = item.name;
      }
    }
    setLines(newLines);
  };
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  const handleClose = () => { setCreateOpen(false); setEditId(null); resetForm(); };
  const clearFilters = () => { setFilterDateFrom(""); setFilterDateTo(""); setFilterCustomer("all"); setFilterAgent("all"); };


  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Quotations</h1>
          <p className="page-description">{filtered.length} quotation{filtered.length !== 1 ? "s" : ""}{filtered.length !== quotations.length ? ` (filtered from ${quotations.length})` : ""}</p>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (
            <>
              {anySelectedLocked ? (
                <span className="inline-flex items-center gap-1 text-xs text-amber-600 px-2">
                  <Lock className="h-3.5 w-3.5" /> Selection contains accepted quotations — bulk actions disabled
                </span>
              ) : (
                <>
                  <BulkEditDialog
                    selectedIds={Array.from(selectedIds)}
                    entityLabel="quotations"
                    fields={[
                      { key: "status", label: "Status", type: "select", options: [
                        { value: "draft", label: "Draft" },
                        { value: "sent", label: "Sent" },
                        { value: "accepted", label: "Accepted" },
                        { value: "rejected", label: "Rejected" },
                      ]},
                      { key: "sales_agent", label: "Sales Agent", type: "select", options: salesAgents.map((a: any) => ({ value: a.name, label: a.name })) },
                      { key: "valid_until", label: "Valid Until", type: "date" },
                      { key: "payment_terms", label: "Payment Terms (days)", type: "number", transform: v => parseInt(v) || null },
                      { key: "notes", label: "Notes", type: "textarea" },
                    ] as BulkField[]}
                    updateOne={async (id, patch) => { await updateQuotation(id, patch as any); }}
                    onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); setSelectedIds(new Set()); }}
                  />
                  <Button variant="destructive" size="sm" onClick={() => setBulkDeleteConfirm(true)} disabled={bulkDeleteMut.isPending}>
                    <Trash2 className="h-4 w-4 mr-1" /> Delete {selectedIds.size} selected
                  </Button>
                </>
              )}
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="rounded-lg h-9 px-3 text-sm">
            <Filter className="h-4 w-4 mr-1.5" /> Filters
          </Button>
          <ExportButton
            data={filtered}
            columns={{
              "Quotation #": (r: any) => r.quotation_number,
              "Date": (r: any) => r.quotation_date,
              "Customer": (r: any) => r.customers?.name || "",
              "Sales Agent": (r: any) => r.sales_agent || "",
              "Status": (r: any) => r.status,
              "Payment Terms": (r: any) => r.payment_terms ? `${r.payment_terms} days` : "",
              "Due Date": (r: any) => getDueDate(r) || "",
              "Valid Until": (r: any) => r.valid_until || "",
              "Quotation Total": (r: any) => r.total_amount,
              "Notes": (r: any) => r.notes || "",
            }}
            childItems={{
              table: "quotation_items",
              foreignKey: "quotation_id",
              select: "*, items(name, sku), item_variations(name, sku)",
              columns: {
                "Item Name": (li: any) => li.item_name || li.items?.name || "",
                "SKU": (li: any) => li.items?.sku || li.item_variations?.sku || "",
                "Variation": (li: any) => li.item_variations?.name || "",
                "Quantity": (li: any) => Number(li.quantity || 0),
                "Unit Price": (li: any) => Number(li.unit_price || 0),
                "Line Total": (li: any) => Number(li.quantity || 0) * Number(li.unit_price || 0),
              },
            }}
            dateField={(r: any) => r.quotation_date || ""}
            fileName="Quotations"
          />
          <Button onClick={() => { resetForm(); setCreateOpen(true); }} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> New Quotation
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
            <FilterCombobox
              value={filterCustomer}
              onChange={setFilterCustomer}
              options={availableCustomers.map((c: any) => ({ value: c.id, label: c.name }))}
              allLabel="All Customers"
              placeholder="Search customer..."
              className="h-9 sm:h-8 sm:w-44 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Sales Agent</Label>
            <FilterCombobox
              value={filterAgent}
              onChange={setFilterAgent}
              options={availableAgents.map((a) => ({ value: a, label: a }))}
              allLabel="All Agents"
              placeholder="Search agent..."
              className="h-9 sm:h-8 sm:w-44 text-sm"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">Clear</Button>
        </div>
      )}

      {isAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 sm:p-4 rounded-lg border bg-primary/5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Sales</p>
            <p className="text-xs text-muted-foreground mt-0.5">Sum of accepted quotations in current filter</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold tabular-nums truncate">{peso(totalSales)}</p>
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
                <CustomerSearchWithCreate customers={customers} value={form.customer_id} onChange={handleCustomerChange} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Sales Agent</Label>
                {!addingAgent ? (
                  <div className="flex gap-1.5">
                    <Select value={form.sales_agent} onValueChange={v => { setForm({ ...form, sales_agent: v }); setAgentAutoFilled(false); }}>
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
                {agentAutoFilled && form.sales_agent && (
                  <p className="text-[10px] text-muted-foreground">Auto-filled from customer's latest transaction</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Valid Until</Label>
                <DateField value={form.valid_until} onChange={v => setForm({ ...form, valid_until: v })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Terms (days)</Label>
                <Input type="number" min={0} value={form.payment_terms} onChange={e => {
                  const v = e.target.value;
                  const days = parseInt(v);
                  let due = form.payment_due_date;
                  if (!isNaN(days) && days >= 0) {
                    const baseStr = editId ? (quotations.find((q: any) => q.id === editId)?.quotation_date) : null;
                    const base = baseStr ? parseISO(baseStr) : new Date();
                    due = format(addDays(base, days), "yyyy-MM-dd");
                  }
                  setForm({ ...form, payment_terms: v, payment_due_date: due });
                }} className="h-9" placeholder="e.g. 30" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Due Date</Label>
                <DateField value={form.payment_due_date} onChange={v => setForm({ ...form, payment_due_date: v })} />
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
                    <div key={idx} className="border rounded-md p-2 sm:border-0 sm:p-0">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_70px_90px_32px] gap-2">
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
                            } else if (itemId) {
                              newLines[idx].item_id = itemId;
                              newLines[idx].item_name = item?.name || "";
                              newLines[idx].variation_id = null;
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
                        <div className="grid grid-cols-[1fr_1fr_32px] gap-2 sm:contents">
                          <Input type="number" value={line.quantity} onChange={e => updateLine(idx, "quantity", e.target.value)} className="h-9 text-sm" placeholder="Enter quantity" />
                          <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, "unit_price", e.target.value)} className="h-9 text-sm" placeholder="Enter price" />
                          <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-9 w-8"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                        </div>
                      </div>
                      {selectedItem && <p className="text-[11px] text-muted-foreground mt-0.5 ml-1">In stock: {selectedItem.quantity}{(selectedItem.units_per_stock ?? 1) > 1 && (selectedItem.open_roll_remaining ?? 0) > 0 ? ` + ${selectedItem.open_roll_remaining}${selectedItem.base_unit || 'm'} open` : ''}</p>}
                      {(line.item_id || line.item_name) && parsePrice(line.unit_price) <= 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 ml-1">⚠ No price set for this item</p>
                      )}
                      {selectedItem && form.customer_id && (
                        <CustomerPriceHint
                          customerId={form.customer_id}
                          itemId={line.item_id}
                          variationId={line.variation_id}
                          standardPrice={Number(selectedItem.selling_price)}
                          costPrice={Number(selectedItem.cost_price)}
                          currentPrice={parsePrice(line.unit_price)}
                          onSuggested={(suggested) => updateLine(idx, "unit_price", String(suggested))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">Total: {peso(lines.reduce((s, l) => s + lineTotal(l), 0))}</span>
              </div>
            </div>
            {hasMissingPrice && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                Warning: One or more items do not have a price. You can still save this quotation.
              </div>
            )}
            <Button
              onClick={async () => {
                // Advisory store-stock warning — quotation always allowed to push through.
                const shortages = await checkStoreStock(
                  lines.map((l: any) => ({
                    item_id: l.item_id || null,
                    variation_id: l.variation_id || null,
                    quantity: Number(l.quantity || 0),
                  })),
                  activeBranchId ?? null,
                );
                if (shortages.length > 0) {
                  const ok = window.confirm(
                    `Store inventory is not enough for one or more items in this quotation:\n\n${formatShortageMessage(shortages)}\n\nThis is just a warning — the quotation will still be created. Continue?`,
                  );
                  if (!ok) return;
                }
                editId ? editMut.mutate() : createMut.mutate();
              }}
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
          {(() => {
            const q: any = quotations.find((x: any) => x.id === viewQ);
            if (q && isQuotationLocked(q.status)) {
              return (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200">
                  <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{QUOTATION_LOCK_MESSAGE}</span>
                </div>
              );
            }
            return null;
          })()}
          <div className="data-table-wrapper mt-2">
            <Table>
              <TableHeader><TableRow><TableHead className="text-xs">SKU</TableHead><TableHead className="text-xs">Item</TableHead><TableHead className="text-xs">Qty</TableHead><TableHead className="text-xs text-right">Price</TableHead><TableHead className="text-xs text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {qItems.map(qi => (
                  <TableRow key={qi.id}>
                     <TableCell className="font-mono text-xs text-primary font-medium">{(qi as any).item_variations?.sku || qi.items?.sku || "—"}</TableCell>
                     <TableCell className="text-sm font-medium">{(qi as any).item_variations?.name || (qi as any).item_name || qi.items?.name || "—"}</TableCell>
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

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={filtered.length > 0 && selectedIds.size === filtered.length} onCheckedChange={toggleAll} /></TableHead>
              <SortableHeader sortKey="quotation_number" label="Quotation #" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="customer" label="Customer" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="sales_agent" label="Sales Agent" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="quotation_date" label="Date" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="status" label="Status" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="total_amount" label="Total" sort={sort} onToggle={toggle} align="right" />
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedQuotations.length === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="empty-state"><FileText className="empty-state-icon" /><p className="text-sm">No quotations</p></div></TableCell></TableRow>
            ) : sortedQuotations.map((q: any) => {
              const locked = isQuotationLocked(q.status);
              return (
              <TableRow key={q.id} className={selectedIds.has(q.id) ? "bg-muted/40" : "hover:bg-muted/30"}>
                <TableCell><Checkbox checked={selectedIds.has(q.id)} onCheckedChange={() => toggleOne(q.id)} /></TableCell>
                <TableCell className="font-mono text-xs font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {q.quotation_number}
                    {locked && <Lock className="h-3 w-3 text-amber-500" aria-label="Locked" />}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{q.customers?.name || "—"}</TableCell>
                <TableCell className="text-sm">{q.sales_agent || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{q.quotation_date}</TableCell>
                <TableCell><StatusBadge status={q.status} /></TableCell>
                <TableCell className="text-right text-sm font-medium">{peso(Number(q.total_amount))}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openPreview(q)} title="Preview & Download PDF" className="h-7 w-7 rounded-md"><FileDown className="h-3.5 w-3.5 text-primary" /></Button>
                    {!locked && (
                      <Button variant="ghost" size="icon" onClick={() => openEdit(q)} title="Edit" className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setViewQ(q.id)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    {q.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => convertMut.mutate(q.id)} title="Convert to Invoice" className="h-7 w-7 rounded-md"><ArrowRight className="h-3.5 w-3.5 text-primary" /></Button>
                    )}
                    {locked && (
                      <Button variant="ghost" size="icon" onClick={() => revertQuotationMut.mutate(q.id)} title="Revert Quotation (unlock)" className="h-7 w-7 rounded-md"><Undo2 className="h-3.5 w-3.5 text-amber-500" /></Button>
                    )}
                    {!locked && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(q.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <DocumentPreview open={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} />

      {/* Single delete confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quotation</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this quotation? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (deleteConfirm) deleteMut.mutate(deleteConfirm); setDeleteConfirm(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Quotation{selectedIds.size !== 1 ? "s" : ""}</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete {selectedIds.size} selected quotation{selectedIds.size !== 1 ? "s" : ""}? This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { bulkDeleteMut.mutate(); setBulkDeleteConfirm(false); }}>Delete All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
