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
import { Plus, Trash2, Eye, CheckCircle, DollarSign } from "lucide-react";
import { toast } from "sonner";

interface LineItem { item_id: string; quantity: number; unit_price: number; }

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewInv, setViewInv] = useState<string | null>(null);
  const [form, setForm] = useState({ customer_id: "", notes: "", due_date: "" });
  const [lines, setLines] = useState<LineItem[]>([{ item_id: "", quantity: 1, unit_price: 0 }]);

  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: getInvoices });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: invItems = [] } = useQuery({ queryKey: ["invoice_items", viewInv], queryFn: () => getInvoiceItems(viewInv!), enabled: !!viewInv });

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
        <div><h1 className="text-2xl font-bold tracking-tight">Invoices</h1><p className="text-muted-foreground">{invoices.length} invoices</p></div>
        <Button onClick={() => { resetForm(); setCreateOpen(true); }}><Plus className="h-4 w-4 mr-1" /> New Invoice</Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Invoice</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Customer</Label>
                <Select value={form.customer_id} onValueChange={v => setForm({ ...form, customer_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>

            <div>
              <div className="flex items-center justify-between mb-2"><Label>Line Items</Label><Button variant="outline" size="sm" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Add</Button></div>
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_80px_100px_40px] gap-2 mb-2">
                  <Select value={line.item_id} onValueChange={v => updateLine(idx, "item_id", v)}>
                    <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                    <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.sku}) — Stock: {i.quantity}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, "quantity", parseInt(e.target.value) || 1)} placeholder="Qty" />
                  <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, "unit_price", parseFloat(e.target.value) || 0)} placeholder="Price" />
                  <Button variant="ghost" size="icon" onClick={() => removeLine(idx)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              ))}
              <p className="text-sm font-medium text-right">Total: ${lines.reduce((s, l) => s + l.quantity * l.unit_price, 0).toFixed(2)}</p>
            </div>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>Create Invoice</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewInv} onOpenChange={() => setViewInv(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Invoice Details</DialogTitle></DialogHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {invItems.map(ii => (
                <TableRow key={ii.id}>
                  <TableCell>{ii.items?.name || "—"}</TableCell>
                  <TableCell>{ii.quantity}</TableCell>
                  <TableCell>${Number(ii.unit_price).toFixed(2)}</TableCell>
                  <TableCell>${(ii.quantity * Number(ii.unit_price)).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No invoices</TableCell></TableRow>
            ) : invoices.map(inv => (
              <TableRow key={inv.id}>
                <TableCell className="font-mono text-sm font-medium">{inv.invoice_number}</TableCell>
                <TableCell>{inv.customers?.name || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{inv.invoice_date}</TableCell>
                <TableCell><StatusBadge status={inv.status} /></TableCell>
                <TableCell className="text-right">${Number(inv.total_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setViewInv(inv.id)}><Eye className="h-3.5 w-3.5" /></Button>
                    {inv.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => confirmMut.mutate(inv.id)} title="Confirm & Deduct Stock"><CheckCircle className="h-3.5 w-3.5 text-success" /></Button>
                    )}
                    {inv.status === "confirmed" && (
                      <Button variant="ghost" size="icon" onClick={() => markPaidMut.mutate(inv.id)} title="Mark as Paid"><DollarSign className="h-3.5 w-3.5 text-primary" /></Button>
                    )}
                    {inv.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(inv.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    )}
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
