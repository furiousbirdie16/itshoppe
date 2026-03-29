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
import { Plus, Trash2, Eye, ArrowRight, FileText } from "lucide-react";
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
        <div className="page-header mb-0">
          <h1 className="page-title">Quotations</h1>
          <p className="page-description">{quotations.length} quotations</p>
        </div>
        <Button onClick={() => { resetForm(); setCreateOpen(true); }} className="rounded-lg h-9 px-4 text-sm font-medium">
          <Plus className="h-4 w-4 mr-1.5" /> New Quotation
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">New Quotation</DialogTitle></DialogHeader>
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
                <Label className="text-xs font-medium">Valid Until</Label>
                <Input type="date" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} className="h-9" />
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
                        <Select value={line.item_id} onValueChange={v => updateLine(idx, "item_id", v)}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select item" /></SelectTrigger>
                          <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.sku})</SelectItem>)}</SelectContent>
                        </Select>
                        <Input type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, "quantity", parseInt(e.target.value) || 1)} className="h-9 text-sm" placeholder="Qty" />
                        <Input type="number" value={line.unit_price} onChange={e => updateLine(idx, "unit_price", parseFloat(e.target.value) || 0)} className="h-9 text-sm" placeholder="Price" />
                        <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-9 w-8"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                      </div>
                      {selectedItem && <p className="text-[11px] text-muted-foreground mt-0.5 ml-1">In stock: {selectedItem.quantity}</p>}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">Total: ${lines.reduce((s, l) => s + l.quantity * l.unit_price, 0).toFixed(2)}</span>
              </div>
            </div>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="rounded-lg h-9">Create Quotation</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewQ} onOpenChange={() => setViewQ(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">Quotation Details</DialogTitle></DialogHeader>
          <div className="data-table-wrapper mt-2">
            <Table>
              <TableHeader><TableRow><TableHead className="text-xs">Item</TableHead><TableHead className="text-xs">Qty</TableHead><TableHead className="text-xs text-right">Price</TableHead><TableHead className="text-xs text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {qItems.map(qi => (
                  <TableRow key={qi.id}>
                    <TableCell className="text-sm font-medium">{qi.items?.name || "—"}</TableCell>
                    <TableCell className="text-sm">{qi.quantity}</TableCell>
                    <TableCell className="text-sm text-right">${Number(qi.unit_price).toFixed(2)}</TableCell>
                    <TableCell className="text-sm text-right font-medium">${(qi.quantity * Number(qi.unit_price)).toFixed(2)}</TableCell>
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
              <TableHead className="text-xs">Quotation #</TableHead>
              <TableHead className="text-xs">Customer</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs text-right">Total</TableHead>
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotations.length === 0 ? (
              <TableRow><TableCell colSpan={6}><div className="empty-state"><FileText className="empty-state-icon" /><p className="text-sm">No quotations</p></div></TableCell></TableRow>
            ) : quotations.map(q => (
              <TableRow key={q.id} className="hover:bg-muted/30">
                <TableCell className="font-mono text-xs font-semibold">{q.quotation_number}</TableCell>
                <TableCell className="text-sm">{q.customers?.name || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{q.quotation_date}</TableCell>
                <TableCell><StatusBadge status={q.status} /></TableCell>
                <TableCell className="text-right text-sm font-medium">${Number(q.total_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => setViewQ(q.id)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    {q.status === "draft" && (
                      <Button variant="ghost" size="icon" onClick={() => convertMut.mutate(q.id)} title="Convert to Invoice" className="h-7 w-7 rounded-md"><ArrowRight className="h-3.5 w-3.5 text-primary" /></Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(q.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
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
