import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getInvoices, getCustomers, getInvoiceItems, getSalesAgents } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { Eye, Filter, AlertCircle, Clock, Receipt } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";
import { parseISO, isBefore, isToday } from "date-fns";

export default function PendingPaymentsPage() {
  const [viewInv, setViewInv] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DocumentData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Filters
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: getInvoices });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: invItems = [] } = useQuery({ queryKey: ["invoice_items", viewInv], queryFn: () => getInvoiceItems(viewInv!), enabled: !!viewInv });

  // Pending = confirmed or unpaid invoices (not paid, not draft)
  const pendingInvoices = useMemo(() => {
    return invoices.filter((inv: any) => inv.status === "confirmed" || inv.status === "unpaid");
  }, [invoices]);

  const isOverdue = (inv: any): boolean => {
    if (!inv.due_date) return true; // no due date = due immediately
    const dueDate = parseISO(inv.due_date);
    return isBefore(dueDate, new Date()) || isToday(dueDate);
  };

  // Apply filters
  const filtered = useMemo(() => {
    return pendingInvoices.filter((inv: any) => {
      if (filterDateFrom && inv.invoice_date < filterDateFrom) return false;
      if (filterDateTo && inv.invoice_date > filterDateTo) return false;
      if (filterCustomer !== "all" && inv.customer_id !== filterCustomer) return false;
      return true;
    });
  }, [pendingInvoices, filterDateFrom, filterDateTo, filterCustomer]);

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

  const totalPending = filtered.reduce((s: number, inv: any) => s + Number(inv.total_amount), 0);
  const overdueCount = filtered.filter(isOverdue).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Pending Payments</h1>
          <p className="page-description">{filtered.length} pending invoice{filtered.length !== 1 ? "s" : ""} · Total: {peso(totalPending)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="rounded-lg h-9 px-3 text-sm">
            <Filter className="h-4 w-4 mr-1.5" /> Filters
          </Button>
          <ExportButton
            data={filtered}
            columns={{
              "Invoice #": (r: any) => r.invoice_number,
              "Customer": (r: any) => r.customers?.name || "",
              "Status": (r: any) => r.status,
              "Invoice Date": (r: any) => r.invoice_date,
              "Due Date": (r: any) => r.due_date || "Due now",
              "Total": (r: any) => r.total_amount,
            }}
            dateField={(r: any) => r.invoice_date || ""}
            fileName="Pending_Payments"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><Clock className="h-4 w-4" /> Total Pending</div>
          <p className="text-2xl font-bold">{peso(totalPending)}</p>
          <p className="text-xs text-muted-foreground">{filtered.length} invoice{filtered.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-lg border bg-destructive/5 border-destructive/20 p-4">
          <div className="flex items-center gap-2 text-sm text-destructive mb-1"><AlertCircle className="h-4 w-4" /> Overdue</div>
          <p className="text-2xl font-bold text-destructive">{overdueCount}</p>
          <p className="text-xs text-muted-foreground">invoice{overdueCount !== 1 ? "s" : ""} past due</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1"><Receipt className="h-4 w-4" /> On Time</div>
          <p className="text-2xl font-bold">{filtered.length - overdueCount}</p>
          <p className="text-xs text-muted-foreground">invoice{(filtered.length - overdueCount) !== 1 ? "s" : ""} not yet due</p>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg border bg-card">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Invoice Date From</Label>
            <Input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} className="h-8 w-36 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Invoice Date To</Label>
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

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Invoice #</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs">Invoice Date</TableHead>
              <TableHead className="text-xs">Due Date</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs text-right">Total</TableHead>
              <TableHead className="text-xs text-right w-20">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7}><div className="empty-state"><Receipt className="empty-state-icon" /><p className="text-sm">No pending payments</p></div></TableCell></TableRow>
            ) : filtered.map((inv: any) => {
              const overdue = isOverdue(inv);
              return (
                <TableRow key={inv.id} className={overdue ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/30"}>
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
                      <span className="text-destructive font-medium">
                        <AlertCircle className="h-3 w-3 inline mr-1" />Due now
                      </span>
                    )}
                  </TableCell>
                  <TableCell><StatusBadge status={inv.status} /></TableCell>
                  <TableCell className="text-right text-sm font-medium">{peso(Number(inv.total_amount))}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" size="icon" onClick={() => openPreview(inv)} title="Preview" className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <DocumentPreview open={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} />
    </div>
  );
}
