import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInvoices, getCustomers, getInvoiceItems } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { Eye, Filter, AlertCircle, Clock, Receipt, Plus, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";
import { parseISO, isBefore, isToday } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface ManualForm {
  customer_id: string;
  description: string;
  amount: string;
  due_date: string;
  notes: string;
}

const emptyManualForm: ManualForm = { customer_id: "", description: "", amount: "", due_date: "", notes: "" };

export default function PendingPaymentsPage() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [viewInv, setViewInv] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DocumentData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Manual receivable form state
  const [manualOpen, setManualOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState<ManualForm>(emptyManualForm);

  // Filters
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: getInvoices });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: invItems = [] } = useQuery({ queryKey: ["invoice_items", viewInv], queryFn: () => getInvoiceItems(viewInv!), enabled: !!viewInv });

  const { data: manualReceivables = [] } = useQuery({
    queryKey: ["manual_receivables"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("manual_receivables")
        .select("*, customers(*)")
        .neq("status", "paid")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Pending = confirmed or unpaid invoices (not paid, not draft)
  const pendingInvoices = useMemo(() => {
    return invoices.filter((inv: any) => inv.status === "confirmed" || inv.status === "unpaid");
  }, [invoices]);

  const isOverdue = (item: any): boolean => {
    if (!item.due_date) return true;
    const dueDate = parseISO(item.due_date);
    return isBefore(dueDate, new Date()) || isToday(dueDate);
  };

  // Apply filters to invoices
  const filteredInvoices = useMemo(() => {
    return pendingInvoices.filter((inv: any) => {
      if (filterDateFrom && inv.invoice_date < filterDateFrom) return false;
      if (filterDateTo && inv.invoice_date > filterDateTo) return false;
      if (filterCustomer !== "all" && inv.customer_id !== filterCustomer) return false;
      return true;
    });
  }, [pendingInvoices, filterDateFrom, filterDateTo, filterCustomer]);

  // Apply filters to manual receivables (use created_at as the date)
  const filteredManual = useMemo(() => {
    return manualReceivables.filter((m: any) => {
      const dateStr = (m.created_at || "").split("T")[0];
      if (filterDateFrom && dateStr < filterDateFrom) return false;
      if (filterDateTo && dateStr > filterDateTo) return false;
      if (filterCustomer !== "all" && m.customer_id !== filterCustomer) return false;
      return true;
    });
  }, [manualReceivables, filterDateFrom, filterDateTo, filterCustomer]);

  const clearFilters = () => { setFilterDateFrom(""); setFilterDateTo(""); setFilterCustomer("all"); };

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
      extraFields: inv.due_date ? [{ label: "Due Date", value: inv.due_date }] : [],
      items: lineItems.map((li: any) => ({
        name: li.items?.name || li.item_name || "—",
        sku: li.items?.sku,
        quantity: li.quantity,
        unitPrice: Number(li.unit_price),
        total: li.quantity * Number(li.unit_price),
      })),
      totalAmount: Number(inv.total_amount),
    });
    setPreviewOpen(true);
  };

  // ===== Manual receivable mutations =====
  const saveManualMut = useMutation({
    mutationFn: async () => {
      const payload = {
        customer_id: manualForm.customer_id || null,
        description: manualForm.description,
        amount: manualForm.amount ? parseFloat(manualForm.amount) : 0,
        due_date: manualForm.due_date || null,
        notes: manualForm.notes,
      };
      if (editId) {
        const { error } = await (supabase as any).from("manual_receivables").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("manual_receivables").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manual_receivables"] });
      toast.success(editId ? "Pending payment updated" : "Pending payment added");
      closeManual();
    },
    onError: (e: any) => toast.error(e.message || "Failed to save"),
  });

  const markPaidMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("manual_receivables").update({ status: "paid" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manual_receivables"] });
      toast.success("Marked as paid");
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const deleteManualMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("manual_receivables").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["manual_receivables"] });
      toast.success("Deleted");
    },
    onError: (e: any) => toast.error(e.message || "Failed"),
  });

  const openCreate = () => { setEditId(null); setManualForm(emptyManualForm); setManualOpen(true); };
  const openEdit = (m: any) => {
    setEditId(m.id);
    setManualForm({
      customer_id: m.customer_id || "",
      description: m.description || "",
      amount: m.amount != null ? String(m.amount) : "",
      due_date: m.due_date || "",
      notes: m.notes || "",
    });
    setManualOpen(true);
  };
  const closeManual = () => { setManualOpen(false); setEditId(null); setManualForm(emptyManualForm); };

  const handleSubmit = () => {
    if (!manualForm.description.trim()) { toast.error("Description is required"); return; }
    if (!manualForm.amount || parseFloat(manualForm.amount) <= 0) { toast.error("Amount must be greater than 0"); return; }
    saveManualMut.mutate();
  };

  // ===== Totals =====
  const invoiceTotal = filteredInvoices.reduce((s: number, inv: any) => s + Number(inv.total_amount), 0);
  const manualTotal = filteredManual.reduce((s: number, m: any) => s + Number(m.amount), 0);
  const totalPending = invoiceTotal + manualTotal;
  const overdueInvoices = filteredInvoices.filter(isOverdue).length;
  const overdueManual = filteredManual.filter(isOverdue).length;
  const overdueCount = overdueInvoices + overdueManual;
  const totalCount = filteredInvoices.length + filteredManual.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Pending Payments</h1>
          <p className="page-description">{totalCount} pending · Total: {peso(totalPending)}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={openCreate} className="rounded-lg h-9 px-3 text-sm">
            <Plus className="h-4 w-4 mr-1.5" /> Add Pending Payment
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="rounded-lg h-9 px-3 text-sm">
            <Filter className="h-4 w-4 mr-1.5" /> Filters
          </Button>
          <ExportButton
            data={[
              ...filteredInvoices.map((r: any) => ({ source: "Invoice", number: r.invoice_number, customer: r.customers?.name || "", description: "", status: r.status, date: r.invoice_date, due_date: r.due_date || "Due now", amount: r.total_amount })),
              ...filteredManual.map((r: any) => ({ source: "Manual", number: "—", customer: r.customers?.name || "", description: r.description, status: r.status, date: (r.created_at || "").split("T")[0], due_date: r.due_date || "Due now", amount: r.amount })),
            ]}
            columns={{
              "Source": (r: any) => r.source,
              "Invoice #": (r: any) => r.number,
              "Customer": (r: any) => r.customer,
              "Description": (r: any) => r.description,
              "Status": (r: any) => r.status,
              "Date": (r: any) => r.date,
              "Due Date": (r: any) => r.due_date,
              "Amount": (r: any) => r.amount,
            }}
            dateField={(r: any) => r.date || ""}
            fileName="Pending_Payments"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><Clock className="h-4 w-4" /> Total Pending</div>
          <p className="text-2xl font-bold">{peso(totalPending)}</p>
          <p className="text-xs text-muted-foreground">{totalCount} pending</p>
        </div>
        <div className="rounded-lg border bg-destructive/5 border-destructive/20 p-4">
          <div className="flex items-center gap-2 text-sm text-destructive mb-1"><AlertCircle className="h-4 w-4" /> Overdue</div>
          <p className="text-2xl font-bold text-destructive">{overdueCount}</p>
          <p className="text-xs text-muted-foreground">past due</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><Receipt className="h-4 w-4" /> On Time</div>
          <p className="text-2xl font-bold">{totalCount - overdueCount}</p>
          <p className="text-xs text-muted-foreground">not yet due</p>
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
                {customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">Clear</Button>
        </div>
      )}

      {/* Invoice details dialog */}
      <Dialog open={!!viewInv} onOpenChange={() => setViewInv(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">Invoice Details</DialogTitle></DialogHeader>
          <div className="data-table-wrapper mt-2">
            <Table>
              <TableHeader><TableRow><TableHead className="text-xs">Item</TableHead><TableHead className="text-xs">Qty</TableHead><TableHead className="text-xs text-right">Price</TableHead><TableHead className="text-xs text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {invItems.map((li: any) => (
                  <TableRow key={li.id}>
                    <TableCell className="text-sm font-medium">{li.items?.name || li.item_name || "—"}</TableCell>
                    <TableCell className="text-sm">{li.quantity}</TableCell>
                    <TableCell className="text-sm text-right">{peso(Number(li.unit_price))}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{peso(li.quantity * Number(li.unit_price))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual receivable form dialog */}
      <Dialog open={manualOpen} onOpenChange={(o) => !o && closeManual()}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-lg">{editId ? "Edit Pending Payment" : "Add Pending Payment"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Customer</Label>
              <Select value={manualForm.customer_id || "none"} onValueChange={v => setManualForm({ ...manualForm, customer_id: v === "none" ? "" : v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {customers.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Description *</Label>
              <Input value={manualForm.description} onChange={e => setManualForm({ ...manualForm, description: e.target.value })} placeholder="What is this payment for?" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Amount *</Label>
                <Input type="number" step="0.01" min="0" value={manualForm.amount} onChange={e => setManualForm({ ...manualForm, amount: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Due Date</Label>
                <Input type="date" value={manualForm.due_date} onChange={e => setManualForm({ ...manualForm, due_date: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={manualForm.notes} onChange={e => setManualForm({ ...manualForm, notes: e.target.value })} rows={2} className="text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeManual}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saveManualMut.isPending}>{editId ? "Save Changes" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Source</TableHead>
              <TableHead className="text-xs">Reference</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Due Date</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs text-right">Amount</TableHead>
              <TableHead className="text-xs text-right w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {totalCount === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="empty-state"><Receipt className="empty-state-icon" /><p className="text-sm">No pending payments</p></div></TableCell></TableRow>
            ) : (
              <>
                {filteredInvoices.map((inv: any) => {
                  const overdue = isOverdue(inv);
                  return (
                    <TableRow key={`inv-${inv.id}`} className={overdue ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/30"}>
                      <TableCell className="text-xs text-muted-foreground">Invoice</TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{inv.invoice_number}</TableCell>
                      <TableCell className="text-sm">{inv.customers?.name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{inv.invoice_date}</TableCell>
                      <TableCell className="text-sm">
                        {inv.due_date ? (
                          <span className={overdue ? "text-destructive font-medium" : ""}>
                            {overdue && <AlertCircle className="h-3 w-3 inline mr-1" />}
                            {inv.due_date}
                          </span>
                        ) : (
                          <span className="text-destructive font-medium"><AlertCircle className="h-3 w-3 inline mr-1" />Due now</span>
                        )}
                      </TableCell>
                      <TableCell><StatusBadge status={inv.status} context="invoice" /></TableCell>
                      <TableCell className="text-right text-sm font-medium">{peso(Number(inv.total_amount))}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon" onClick={() => openPreview(inv)} title="Preview" className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredManual.map((m: any) => {
                  const overdue = isOverdue(m);
                  return (
                    <TableRow key={`man-${m.id}`} className={overdue ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/30"}>
                      <TableCell className="text-xs text-muted-foreground">Manual</TableCell>
                      <TableCell className="text-sm">{m.description || "—"}</TableCell>
                      <TableCell className="text-sm">{m.customers?.name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{(m.created_at || "").split("T")[0]}</TableCell>
                      <TableCell className="text-sm">
                        {m.due_date ? (
                          <span className={overdue ? "text-destructive font-medium" : ""}>
                            {overdue && <AlertCircle className="h-3 w-3 inline mr-1" />}
                            {m.due_date}
                          </span>
                        ) : (
                          <span className="text-destructive font-medium"><AlertCircle className="h-3 w-3 inline mr-1" />Due now</span>
                        )}
                      </TableCell>
                      <TableCell><StatusBadge status={m.status} context="invoice" /></TableCell>
                      <TableCell className="text-right text-sm font-medium">{peso(Number(m.amount))}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon" onClick={() => markPaidMut.mutate(m.id)} title="Mark as Paid" className="h-7 w-7 rounded-md"><CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => openEdit(m)} title="Edit" className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                          {isAdmin && (
                            <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this pending payment?")) deleteManualMut.mutate(m.id); }} title="Delete" className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </>
            )}
          </TableBody>
        </Table>
      </div>

      <DocumentPreview open={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} />
    </div>
  );
}
