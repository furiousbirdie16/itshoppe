import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInvoices, createInvoice, deleteInvoice, getCustomers, getItems, createInvoiceItems, getInvoiceItems, confirmInvoice, updateInvoice, generateInvoiceNumber } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Trash2, Eye, CheckCircle, DollarSign, Receipt, FileDown } from "lucide-react";
import { toast } from "sonner";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";

interface LineItem { item_id: string; quantity: number; unit_price: number; }

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewInv, setViewInv] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DocumentData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", notes: "", due_date: "" });
  const [lines, setLines] = useState<LineItem[]>([{ item_id: "", quantity: 1, unit_price: 0 }]);

  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: getInvoices });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: invItems = [] } = useQuery({ queryKey: ["invoice_items", viewInv], queryFn: () => getInvoiceItems(viewInv!), enabled: !!viewInv });

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
        name: li.items?.name || "—",
        sku: li.items?.sku,
        quantity: li.quantity,
        unitPrice: Number(li.unit_price),
        total: li.quantity * Number(li.unit_price),
      })),
      totalAmount: Number(inv.total_amount),
    });
    setPreviewOpen(true);
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const total = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
      const inv = await createInvoice({ invoice_number: generateInvoiceNumber(), customer_id: form.customer_id || null, notes: form.notes, due_date: form.due_date || null, total_amount: total });
      await createInvoiceItems(lines.filter(l => l.item_id).map(l => ({ invoice_id: inv.id, item_id: l.item_id, quantity: l.quantity, unit_price: l.unit_price })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["invoices"] }); setCreateOpen(false); toast.success("Invoice created"); resetForm(); },
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

  const resetForm = () => { setForm({ customer_id: "", notes: "", due_date: "" }); setLines([{ item_id: "", quantity: 1, unit_price: 0 }]); };
  const addLine = () => setLines([...lines, { item_id: "", quantity: 1, unit_price: 0 }]);
  const updateLine = (idx: number, field: string, value: any) => {
    const newLines = [...lines];
    (newLines[idx] as any)[field] = value;
    if (field === "item_id") {
      const item = items.find(i => i.id === value);
      if (item) newLines[idx].unit_price = Number(item.selling_price);
    }
    setLines(newLines);
  };
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Invoices</h1>
          <p className="page-description">{invoices.length} invoices</p>
        </div>
        <Button onClick={() => { resetForm(); setCreateOpen(true); }} className="rounded-lg h-9 px-4 text-sm font-medium">
          <Plus className="h-4 w-4 mr-1.5" /> New Invoice
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">New Invoice</DialogTitle></DialogHeader>
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
                <Label className="text-xs font-medium">Due Date</Label>
                <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="h-9" />
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
                {lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_70px_90px_32px] gap-2">
                    <Select value={line.item_id} onValueChange={v => updateLine(idx, "item_id", v)}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.sku}) — Stock: {i.quantity}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, "quantity", parseInt(e.target.value) || 1)} className="h-9 text-sm" placeholder="Qty" />
                    <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, "unit_price", parseFloat(e.target.value) || 0)} className="h-9 text-sm" placeholder="Price" />
                    <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-9 w-8"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">Total: ${lines.reduce((s, l) => s + l.quantity * l.unit_price, 0).toFixed(2)}</span>
              </div>
            </div>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="rounded-lg h-9">Create Invoice</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewInv} onOpenChange={() => setViewInv(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">Invoice Details</DialogTitle></DialogHeader>
          <div className="data-table-wrapper mt-2">
            <Table>
              <TableHeader><TableRow><TableHead className="text-xs">Item</TableHead><TableHead className="text-xs">Qty</TableHead><TableHead className="text-xs text-right">Price</TableHead><TableHead className="text-xs text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {invItems.map(ii => (
                  <TableRow key={ii.id}>
                    <TableCell className="text-sm font-medium">{ii.items?.name || "—"}</TableCell>
                    <TableCell className="text-sm">{ii.quantity}</TableCell>
                    <TableCell className="text-sm text-right">${Number(ii.unit_price).toFixed(2)}</TableCell>
                    <TableCell className="text-sm text-right font-medium">${(ii.quantity * Number(ii.unit_price)).toFixed(2)}</TableCell>
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
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs text-right">Total</TableHead>
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow><TableCell colSpan={6}><div className="empty-state"><Receipt className="empty-state-icon" /><p className="text-sm">No invoices</p></div></TableCell></TableRow>
            ) : invoices.map(inv => (
              <TableRow key={inv.id} className="hover:bg-muted/30">
                <TableCell className="font-mono text-xs font-semibold">{inv.invoice_number}</TableCell>
                <TableCell className="text-sm">{inv.customers?.name || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{inv.invoice_date}</TableCell>
                <TableCell><StatusBadge status={inv.status} /></TableCell>
                <TableCell className="text-right text-sm font-medium">${Number(inv.total_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openPreview(inv)} title="Preview & Download PDF" className="h-7 w-7 rounded-md"><FileDown className="h-3.5 w-3.5 text-primary" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setViewInv(inv.id)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    {inv.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => confirmMut.mutate(inv.id)} title="Confirm & Deduct Stock" className="h-7 w-7 rounded-md"><CheckCircle className="h-3.5 w-3.5 text-success" /></Button>
                    )}
                    {inv.status === "confirmed" && (
                      <Button variant="ghost" size="icon" onClick={() => markPaidMut.mutate(inv.id)} title="Mark as Paid" className="h-7 w-7 rounded-md"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                    )}
                    {inv.status === "draft" && (
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
