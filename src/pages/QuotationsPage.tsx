import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQuotations, createQuotation, deleteQuotation, getCustomers, getItems, createQuotationItems, deleteQuotationItems, getQuotationItems, convertQuotationToInvoice, generateQuotationNumber } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Trash2, Eye, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface LineItem { item_id: string; quantity: number; unit_price: number; }

export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewQ, setViewQ] = useState<string | null>(null);
  const [form, setForm] = useState({ customer_id: "", notes: "", valid_until: "" });
  const [lines, setLines] = useState<LineItem[]>([{ item_id: "", quantity: 1, unit_price: 0 }]);

  const { data: quotations = [] } = useQuery({ queryKey: ["quotations"], queryFn: getQuotations });
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: qItems = [] } = useQuery({ queryKey: ["quotation_items", viewQ], queryFn: () => getQuotationItems(viewQ!), enabled: !!viewQ });

  const createMut = useMutation({
    mutationFn: async () => {
      const total = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
      const q = await createQuotation({ quotation_number: generateQuotationNumber(), customer_id: form.customer_id || null, notes: form.notes, valid_until: form.valid_until || null, total_amount: total });
      await createQuotationItems(lines.filter(l => l.item_id).map(l => ({ quotation_id: q.id, item_id: l.item_id, quantity: l.quantity, unit_price: l.unit_price })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["quotations"] }); setCreateOpen(false); toast.success("Quotation created"); resetForm(); },
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

  const resetForm = () => { setForm({ customer_id: "", notes: "", valid_until: "" }); setLines([{ item_id: "", quantity: 1, unit_price: 0 }]); };
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
        <div><h1 className="text-2xl font-bold tracking-tight">Quotations</h1><p className="text-muted-foreground">{quotations.length} quotations</p></div>
        <Button onClick={() => { resetForm(); setCreateOpen(true); }}><Plus className="h-4 w-4 mr-1" /> New Quotation</Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Quotation</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Customer</Label>
                <Select value={form.customer_id} onValueChange={v => setForm({ ...form, customer_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Valid Until</Label><Input type="date" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>

            <div>
              <div className="flex items-center justify-between mb-2"><Label>Line Items</Label><Button variant="outline" size="sm" onClick={addLine}><Plus className="h-3 w-3 mr-1" /> Add</Button></div>
              {lines.map((line, idx) => {
                const selectedItem = items.find(i => i.id === line.item_id);
                return (
                  <div key={idx} className="mb-2">
                    <div className="grid grid-cols-[1fr_80px_100px_40px] gap-2">
                      <Select value={line.item_id} onValueChange={v => updateLine(idx, "item_id", v)}>
                        <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                        <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.sku})</SelectItem>)}</SelectContent>
                      </Select>
                      <Input type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, "quantity", parseInt(e.target.value) || 1)} placeholder="Qty" />
                      <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, "unit_price", parseFloat(e.target.value) || 0)} placeholder="Price" />
                      <Button variant="ghost" size="icon" onClick={() => removeLine(idx)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                    {selectedItem && <p className="text-xs text-muted-foreground mt-1">In stock: {selectedItem.quantity}</p>}
                  </div>
                );
              })}
              <p className="text-sm font-medium text-right">Total: ${lines.reduce((s, l) => s + l.quantity * l.unit_price, 0).toFixed(2)}</p>
            </div>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>Create Quotation</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewQ} onOpenChange={() => setViewQ(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Quotation Details</DialogTitle></DialogHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead>Price</TableHead><TableHead>Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {qItems.map(qi => (
                <TableRow key={qi.id}>
                  <TableCell>{qi.items?.name || "—"}</TableCell>
                  <TableCell>{qi.quantity}</TableCell>
                  <TableCell>${Number(qi.unit_price).toFixed(2)}</TableCell>
                  <TableCell>${(qi.quantity * Number(qi.unit_price)).toFixed(2)}</TableCell>
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
              <TableHead>Quotation #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotations.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No quotations</TableCell></TableRow>
            ) : quotations.map(q => (
              <TableRow key={q.id}>
                <TableCell className="font-mono text-sm font-medium">{q.quotation_number}</TableCell>
                <TableCell>{q.customers?.name || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{q.quotation_date}</TableCell>
                <TableCell><StatusBadge status={q.status} /></TableCell>
                <TableCell className="text-right">${Number(q.total_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setViewQ(q.id)}><Eye className="h-3.5 w-3.5" /></Button>
                    {q.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => convertMut.mutate(q.id)} title="Convert to Invoice"><ArrowRight className="h-3.5 w-3.5 text-primary" /></Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(q.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
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
