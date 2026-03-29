import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getPurchaseOrders, createPurchaseOrder, deletePurchaseOrder, getSuppliers, getItems, createPOItems, deletePOItems, getPOItems, receivePO, generatePONumber } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus, Trash2, Eye, PackageCheck, ShoppingCart, FileDown } from "lucide-react";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";
import { toast } from "sonner";

interface LineItem { item_id: string; quantity: number; unit_cost: number; }

export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewPO, setViewPO] = useState<string | null>(null);
  const [receiveOpen, setReceiveOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ supplier_id: "", notes: "", expected_delivery: "" });
  const [lines, setLines] = useState<LineItem[]>([{ item_id: "", quantity: 1, unit_cost: 0 }]);

  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: getPurchaseOrders });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: getSuppliers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: poItems = [] } = useQuery({ queryKey: ["po_items", viewPO || receiveOpen], queryFn: () => getPOItems(viewPO || receiveOpen || ""), enabled: !!(viewPO || receiveOpen) });

  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});

  const createMut = useMutation({
    mutationFn: async () => {
      const total = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
      const po = await createPurchaseOrder({ po_number: generatePONumber(), supplier_id: form.supplier_id || null, notes: form.notes, expected_delivery: form.expected_delivery || null, total_amount: total });
      await createPOItems(lines.filter(l => l.item_id).map(l => ({ po_id: po.id, item_id: l.item_id, quantity: l.quantity, unit_cost: l.unit_cost })));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase_orders"] }); setCreateOpen(false); toast.success("PO created"); resetForm(); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deletePurchaseOrder,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase_orders"] }); toast.success("PO deleted"); },
  });

  const receiveMut = useMutation({
    mutationFn: async () => {
      const itemsToReceive = Object.entries(receiveQtys).filter(([, qty]) => qty > 0).map(([poItemId, qty]) => {
        const poItem = poItems.find(pi => pi.id === poItemId);
        return { poItemId, itemId: poItem!.item_id, quantity: qty };
      });
      await receivePO(receiveOpen!, itemsToReceive);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setReceiveOpen(null); setReceiveQtys({});
      toast.success("Items received and inventory updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => { setForm({ supplier_id: "", notes: "", expected_delivery: "" }); setLines([{ item_id: "", quantity: 1, unit_cost: 0 }]); };

  const addLine = () => setLines([...lines, { item_id: "", quantity: 1, unit_cost: 0 }]);
  const updateLine = (idx: number, field: string, value: any) => {
    const newLines = [...lines];
    (newLines[idx] as any)[field] = value;
    if (field === "item_id") {
      const item = items.find(i => i.id === value);
      if (item) newLines[idx].unit_cost = Number(item.cost_price);
    }
    setLines(newLines);
  };
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Purchase Orders</h1>
          <p className="page-description">{pos.length} orders</p>
        </div>
        <Button onClick={() => { resetForm(); setCreateOpen(true); }} className="rounded-lg h-9 px-4 text-sm font-medium">
          <Plus className="h-4 w-4 mr-1.5" /> New PO
        </Button>
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">New Purchase Order</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Supplier</Label>
                <Select value={form.supplier_id} onValueChange={v => setForm({ ...form, supplier_id: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Expected Delivery</Label>
                <Input type="date" value={form.expected_delivery} onChange={e => setForm({ ...form, expected_delivery: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="resize-none" rows={2} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-medium">Line Items</Label>
                <Button variant="outline" size="sm" onClick={addLine} className="h-7 rounded-md text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_70px_90px_32px] gap-2">
                    <Select value={line.item_id} onValueChange={v => updateLine(idx, "item_id", v)}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.sku})</SelectItem>)}</SelectContent>
                    </Select>
                    <Input type="number" min={1} value={line.quantity} onChange={e => updateLine(idx, "quantity", parseInt(e.target.value) || 1)} className="h-9 text-sm" placeholder="Qty" />
                    <Input type="number" value={line.unit_cost} onChange={e => updateLine(idx, "unit_cost", parseFloat(e.target.value) || 0)} className="h-9 text-sm" placeholder="Cost" />
                    <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-9 w-8">
                      <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">Total: ${lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0).toFixed(2)}</span>
              </div>
            </div>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="rounded-lg h-9">Create Purchase Order</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewPO} onOpenChange={() => setViewPO(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">PO Details</DialogTitle></DialogHeader>
          <div className="data-table-wrapper mt-2">
            <Table>
              <TableHeader><TableRow><TableHead className="text-xs">Item</TableHead><TableHead className="text-xs">Qty</TableHead><TableHead className="text-xs">Received</TableHead><TableHead className="text-xs text-right">Cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {poItems.map(pi => (
                  <TableRow key={pi.id}>
                    <TableCell className="text-sm font-medium">{pi.items?.name || "—"}</TableCell>
                    <TableCell className="text-sm">{pi.quantity}</TableCell>
                    <TableCell className="text-sm">{pi.received_quantity}</TableCell>
                    <TableCell className="text-sm text-right">${Number(pi.unit_cost).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receive Dialog */}
      <Dialog open={!!receiveOpen} onOpenChange={() => { setReceiveOpen(null); setReceiveQtys({}); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">Receive Items</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Enter quantities received for each item:</p>
          <div className="space-y-3 pt-2">
            {poItems.map(pi => {
              const remaining = pi.quantity - pi.received_quantity;
              return (
                <div key={pi.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pi.items?.name}</p>
                    <p className="text-xs text-muted-foreground">Ordered: {pi.quantity} · Received: {pi.received_quantity} · Remaining: {remaining}</p>
                  </div>
                  <Input type="number" min={0} max={remaining} value={receiveQtys[pi.id] || 0} onChange={e => setReceiveQtys({ ...receiveQtys, [pi.id]: Math.min(parseInt(e.target.value) || 0, remaining) })} className="w-20 h-9 text-sm" />
                </div>
              );
            })}
          </div>
          <Button onClick={() => receiveMut.mutate()} disabled={receiveMut.isPending} className="mt-2 rounded-lg h-9">Confirm Receipt</Button>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">PO #</TableHead>
              <TableHead className="text-xs">Supplier</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs text-right">Total</TableHead>
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pos.length === 0 ? (
              <TableRow><TableCell colSpan={6}><div className="empty-state"><ShoppingCart className="empty-state-icon" /><p className="text-sm">No purchase orders</p></div></TableCell></TableRow>
            ) : pos.map(po => (
              <TableRow key={po.id} className="hover:bg-muted/30">
                <TableCell className="font-mono text-xs font-semibold">{po.po_number}</TableCell>
                <TableCell className="text-sm">{po.suppliers?.name || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{po.order_date}</TableCell>
                <TableCell><StatusBadge status={po.status} /></TableCell>
                <TableCell className="text-right text-sm font-medium">${Number(po.total_amount).toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => setViewPO(po.id)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    {po.status !== "received" && (
                      <Button variant="ghost" size="icon" onClick={() => { setReceiveOpen(po.id); setReceiveQtys({}); }} className="h-7 w-7 rounded-md"><PackageCheck className="h-3.5 w-3.5 text-success" /></Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(po.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
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
