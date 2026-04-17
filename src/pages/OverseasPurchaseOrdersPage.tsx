import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOverseasPurchaseOrders, createOverseasPurchaseOrder, updateOverseasPurchaseOrder, deleteOverseasPurchaseOrder,
  getOverseasSuppliers, generateOverseasPONumber, getOverseasPOItems, createOverseasPOItems, deleteOverseasPOItems, getItems, receiveOverseasPO, getAllOverseasPOItems,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, ShoppingCart, Eye, X, PackageCheck, Upload } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import OverseasPOBulkUploadDialog from "@/components/OverseasPOBulkUploadDialog";
import { toast } from "sonner";
import { peso } from "@/lib/currency";
import { StatusBadge } from "@/components/StatusBadge";
import { ItemSearch } from "@/components/ItemSearch";
import type { OverseasPurchaseOrder, OverseasSupplier, OverseasPurchaseOrderItem } from "@/types/database";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { DateField } from "@/components/DateField";

interface LineItem {
  item_name: string;
  description: string;
  quantity: number | "";
  unit_cost: number | "";
  item_id: string;
}

const emptyLine = (): LineItem => ({ item_name: "", description: "", quantity: "", unit_cost: "", item_id: "" });

export default function OverseasPurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OverseasPurchaseOrder | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [orderDate, setOrderDate] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [exchangeRate, setExchangeRate] = useState("1");
  const [currency, setCurrency] = useState<"USD" | "RMB">("USD");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);

  const toggleAll = () => {
    if (selectedIds.size === orders.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(orders.map(o => o.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const bulkDeleteMut = useMutation({
    mutationFn: async () => { for (const id of selectedIds) await deleteOverseasPurchaseOrder(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["overseas_pos"] }); queryClient.invalidateQueries({ queryKey: ["overseas_po_items_all"] }); setSelectedIds(new Set()); toast.success(`Deleted ${selectedIds.size} POs`); },
  });

  // View dialog
  const [viewPO, setViewPO] = useState<OverseasPurchaseOrder | null>(null);

  // Receive dialog
  const [receiveOpen, setReceiveOpen] = useState<string | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});

  const { data: orders = [], isLoading } = useQuery<OverseasPurchaseOrder[]>({ queryKey: ["overseas_pos"], queryFn: getOverseasPurchaseOrders });
  const { data: suppliers = [] } = useQuery<OverseasSupplier[]>({ queryKey: ["overseas_suppliers"], queryFn: getOverseasSuppliers });
  const { data: inventoryItems = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: allPOItems = [] } = useQuery<OverseasPurchaseOrderItem[]>({ queryKey: ["overseas_po_items_all"], queryFn: getAllOverseasPOItems });
  const { data: viewItems = [] } = useQuery<OverseasPurchaseOrderItem[]>({
    queryKey: ["overseas_po_items", viewPO?.id],
    queryFn: () => getOverseasPOItems(viewPO!.id),
    enabled: !!viewPO,
  });
  const { data: receiveItems = [] } = useQuery<OverseasPurchaseOrderItem[]>({
    queryKey: ["overseas_po_items", receiveOpen],
    queryFn: () => getOverseasPOItems(receiveOpen!),
    enabled: !!receiveOpen,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const poNumber = await generateOverseasPONumber();
      const normalized = lines.map(l => ({ ...l, quantity: Number(l.quantity) || 0, unit_cost: Number(l.unit_cost) || 0 }));
      const total = normalized.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
      const po = await createOverseasPurchaseOrder({
        po_number: poNumber,
        supplier_id: supplierId || null,
        status: status as any,
        order_date: orderDate || new Date().toISOString().slice(0, 10),
        expected_delivery: expectedDelivery || null,
        notes,
        total_amount: total,
        currency,
        exchange_rate: parseFloat(exchangeRate) || 1,
      } as any);
      const valid = normalized.filter(l => l.item_name);
      if (valid.length > 0) {
        await createOverseasPOItems(valid.map(l => ({ po_id: po.id, item_name: l.item_name, description: l.description, quantity: l.quantity, unit_cost: l.unit_cost, item_id: l.item_id || null })));
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["overseas_pos"] }); queryClient.invalidateQueries({ queryKey: ["overseas_po_items_all"] }); setOpen(false); toast.success("Overseas PO created"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const normalized = lines.map(l => ({ ...l, quantity: Number(l.quantity) || 0, unit_cost: Number(l.unit_cost) || 0 }));
      const total = normalized.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
      await updateOverseasPurchaseOrder(editing.id, {
        supplier_id: supplierId || null,
        status: status as any,
        order_date: orderDate || null,
        expected_delivery: expectedDelivery || null,
        notes,
        total_amount: total,
        currency,
        exchange_rate: parseFloat(exchangeRate) || 1,
      } as any);
      await deleteOverseasPOItems(editing.id);
      const valid = normalized.filter(l => l.item_name);
      if (valid.length > 0) {
        await createOverseasPOItems(valid.map(l => ({ po_id: editing.id, item_name: l.item_name, description: l.description, quantity: l.quantity, unit_cost: l.unit_cost, item_id: l.item_id || null })));
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["overseas_pos"] }); queryClient.invalidateQueries({ queryKey: ["overseas_po_items_all"] }); setOpen(false); setEditing(null); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteOverseasPurchaseOrder,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["overseas_pos"] }); queryClient.invalidateQueries({ queryKey: ["overseas_po_items_all"] }); toast.success("Deleted"); },
  });

  const receiveMut = useMutation({
    mutationFn: async () => {
      const itemsToReceive = Object.entries(receiveQtys)
        .filter(([, qty]) => qty > 0)
        .map(([poItemId, qty]) => {
          const pi = receiveItems.find((i) => i.id === poItemId);
          return { poItemId, itemId: pi?.item_id || null, quantity: qty };
        });
      if (itemsToReceive.length === 0) {
        toast.info("Enter a quantity for at least one item");
        return;
      }
      await receiveOverseasPO(receiveOpen!, itemsToReceive);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overseas_pos"] });
      queryClient.invalidateQueries({ queryKey: ["overseas_po_items", receiveOpen] });
      queryClient.invalidateQueries({ queryKey: ["overseas_po_items_all"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setReceiveOpen(null);
      setReceiveQtys({});
      toast.success("Items received and added to stock");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setSupplierId("");
    setStatus("draft");
    setOrderDate(new Date().toISOString().slice(0, 10));
    setExpectedDelivery("");
    setNotes("");
    setLines([emptyLine()]);
    setCurrency("USD");
    setExchangeRate("1");
    setOpen(true);
  };

  const openEdit = async (po: OverseasPurchaseOrder) => {
    setEditing(po);
    setSupplierId(po.supplier_id || "");
    setStatus(po.status);
    setOrderDate(po.order_date || "");
    setExpectedDelivery(po.expected_delivery || "");
    setNotes(po.notes);
    setCurrency(po.currency);
    setExchangeRate(String(po.exchange_rate));
    const poItems = await getOverseasPOItems(po.id);
    setLines(poItems.length > 0 ? poItems.map(i => ({ item_name: i.item_name, description: i.description, quantity: i.quantity, unit_cost: i.unit_cost, item_id: i.item_id || "" })) : [emptyLine()]);
    setOpen(true);
  };

  const handleSupplierChange = (id: string) => {
    setSupplierId(id);
    const sup = suppliers.find(s => s.id === id);
    if (sup) {
      setCurrency(sup.currency);
      setExchangeRate(String(sup.exchange_rate));
    }
  };

  const updateLine = (idx: number, field: keyof LineItem, value: string | number) => {
    setLines(lines.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const addLine = () => setLines([...lines, emptyLine()]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  const foreignTotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
  const phpTotal = foreignTotal * (parseFloat(exchangeRate) || 0);
  const currencySymbol = currency === "USD" ? "$" : "¥";

  // Total value of items not yet received across all open POs (in PHP)
  const notReceivedPhpTotal = (() => {
    const rateByPo = new Map(orders.map(o => [o.id, o.exchange_rate || 1]));
    let total = 0;
    for (const li of allPOItems) {
      const remaining = (li.quantity || 0) - (li.received_quantity || 0);
      if (remaining <= 0) continue;
      const rate = rateByPo.get(li.po_id) || 1;
      total += remaining * (li.unit_cost || 0) * rate;
    }
    return total;
  })();

  const handleSubmit = () => {
    if (editing) updateMut.mutate();
    else createMut.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Overseas Purchase Orders</h1>
          <p className="page-description">{orders.length} orders • Stock added when marked received</p>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (
            <>
              <BulkEditDialog
                selectedIds={Array.from(selectedIds)}
                entityLabel="overseas POs"
                fields={[
                  { key: "status", label: "Status", type: "select", options: [
                    { value: "draft", label: "Unpaid" },
                    { value: "sent", label: "Sent" },
                    { value: "partially_received", label: "Partially Received" },
                    { value: "received", label: "Received" },
                  ]},
                  { key: "currency", label: "Currency", type: "select", options: [{ value: "USD", label: "USD" }, { value: "RMB", label: "RMB" }] },
                  { key: "exchange_rate", label: "Exchange Rate", type: "number", transform: v => parseFloat(v) || 1 },
                  { key: "order_date", label: "Date Ordered", type: "date" },
                  { key: "expected_delivery", label: "Estimated Date of Arrival", type: "date" },
                  { key: "notes", label: "Notes", type: "textarea" },
                ] as BulkField[]}
                updateOne={async (id, patch) => { await updateOverseasPurchaseOrder(id, patch as any); }}
                onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["overseas_pos"] }); setSelectedIds(new Set()); }}
              />
              <Button variant="destructive" size="sm" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete {selectedIds.size} selected
              </Button>
            </>
          )}
          <ExportButton
            data={orders}
            columns={{ "PO #": (r: any) => r.po_number, "Supplier": (r: any) => r.overseas_suppliers?.name || "", "Status": (r: any) => r.status, "Currency": (r: any) => r.currency, "Exchange Rate": (r: any) => r.exchange_rate, "Order Date": (r: any) => r.order_date, "Total": (r: any) => r.total_amount }}
            dateField={(r: any) => r.order_date || ""}
            fileName="Overseas_POs"
          />
          <Button variant="outline" onClick={() => setBulkUploadOpen(true)} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Upload className="h-4 w-4 mr-1.5" /> Bulk Upload
          </Button>
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> New Overseas PO
          </Button>
        </div>
      </div>

      <OverseasPOBulkUploadDialog
        open={bulkUploadOpen}
        onOpenChange={setBulkUploadOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["overseas_pos"] });
          queryClient.invalidateQueries({ queryKey: ["overseas_po_items_all"] });
        }}
      />

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Overseas PO" : "New Overseas PO"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Overseas Supplier</Label>
                <Select value={supplierId} onValueChange={handleSupplierChange}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name} ({s.currency})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Unpaid</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="partially_received">Partially Received</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Currency</Label>
                <Select value={currency} onValueChange={(v: "USD" | "RMB") => setCurrency(v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD ($)</SelectItem>
                    <SelectItem value="RMB">RMB (¥)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Exchange Rate to PHP</Label>
                <Input type="number" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date Ordered</Label>
                <DateField value={orderDate} onChange={setOrderDate} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Estimated Date of Arrival</Label>
                <DateField value={expectedDelivery} onChange={setExpectedDelivery} />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-medium">Items</Label>
                <Button variant="outline" size="sm" onClick={addLine} className="h-7 text-xs"><Plus className="h-3 w-3 mr-1" />Add Item</Button>
              </div>
               <div className="space-y-2">
                 {lines.map((line, idx) => (
                   <div key={idx} className="space-y-1">
                     <div className="grid grid-cols-[1fr_60px_100px_32px] gap-2 items-end">
                       <div className="space-y-1">
                         {idx === 0 && <Label className="text-[10px] text-muted-foreground">Item (search by SKU)</Label>}
                         <ItemSearch
                           items={inventoryItems}
                           value={line.item_id}
                           onChange={(itemId, item) => {
                             setLines(lines.map((l, i) => i === idx ? { ...l, item_id: itemId, item_name: item.name } : l));
                           }}
                           placeholder="Search SKU or name..."
                         />
                       </div>
                       <div className="space-y-1">
                         {idx === 0 && <Label className="text-[10px] text-muted-foreground">Qty</Label>}
                         <Input type="number" value={line.quantity} placeholder="0" onChange={e => updateLine(idx, "quantity", e.target.value === "" ? "" : (parseInt(e.target.value) || 0))} className="h-8 text-sm" />
                       </div>
                       <div className="space-y-1">
                         {idx === 0 && <Label className="text-[10px] text-muted-foreground">Unit Cost ({currencySymbol})</Label>}
                         <Input type="number" value={line.unit_cost} placeholder="0.00" onChange={e => updateLine(idx, "unit_cost", e.target.value === "" ? "" : (parseFloat(e.target.value) || 0))} className="h-8 text-sm" />
                       </div>
                       <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-8 w-8" disabled={lines.length === 1}>
                         <X className="h-3.5 w-3.5 text-muted-foreground" />
                       </Button>
                     </div>
                     {!line.item_id && (
                       <Input value={line.item_name} onChange={e => updateLine(idx, "item_name", e.target.value)} className="h-7 text-xs" placeholder="Or type item name manually" />
                     )}
                   </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="rounded-lg bg-muted/50 p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total ({currency})</span>
                <span className="font-medium">{currencySymbol}{foreignTotal.toLocaleString("en", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total (PHP) @ {exchangeRate}</span>
                <span className="font-semibold text-primary">{peso(phpTotal)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="resize-none" rows={2} />
            </div>
            <Button onClick={handleSubmit} className="mt-2 rounded-lg h-9">{editing ? "Update" : "Create PO"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewPO} onOpenChange={() => setViewPO(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">PO {viewPO?.po_number}</DialogTitle></DialogHeader>
          {viewPO && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Supplier:</span> <span className="font-medium">{viewPO.overseas_suppliers?.name || "—"}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={viewPO.status} context="overseas_po" /></div>
                <div><span className="text-muted-foreground">Currency:</span> {viewPO.currency}</div>
                <div><span className="text-muted-foreground">Rate:</span> {viewPO.exchange_rate}</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">SKU</TableHead>
                    <TableHead className="text-xs">Item</TableHead>
                    <TableHead className="text-xs text-right">Qty</TableHead>
                    <TableHead className="text-xs text-right">Unit ({viewPO.currency})</TableHead>
                    <TableHead className="text-xs text-right">PHP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewItems.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs text-primary font-medium">{item.items?.sku || "—"}</TableCell>
                      <TableCell className="text-sm">{item.item_name}</TableCell>
                      <TableCell className="text-sm text-right">{item.quantity}</TableCell>
                      <TableCell className="text-sm text-right">{item.unit_cost.toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-sm text-right">{peso(item.quantity * item.unit_cost * viewPO.exchange_rate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Total ({viewPO.currency})</span>
                  <span className="font-medium">{viewPO.currency === "USD" ? "$" : "¥"}{viewPO.total_amount.toLocaleString("en", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Total (PHP)</span>
                  <span className="font-semibold text-primary">{peso(viewPO.total_amount * viewPO.exchange_rate)}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Receive Dialog */}
      <Dialog open={!!receiveOpen} onOpenChange={() => { setReceiveOpen(null); setReceiveQtys({}); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-lg">Receive Items</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Enter the quantity that just arrived for each item. You can do this multiple times as more shipments come in.</p>
          <div className="space-y-3 pt-2 max-h-[60vh] overflow-y-auto">
            {receiveItems.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No line items on this PO.</p>
            )}
            {receiveItems.map((pi: any) => {
              const remaining = pi.quantity - (pi.received_quantity || 0);
              const isCustom = !pi.item_id;
              const isFull = remaining <= 0;
              return (
                <div key={pi.id} className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pi.items?.name || pi.item_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {isCustom
                        ? `Custom item — not tracked in inventory · Ordered: ${pi.quantity} · Received: ${pi.received_quantity || 0}`
                        : `Ordered: ${pi.quantity} · Received: ${pi.received_quantity || 0} · Remaining: ${remaining}`}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={remaining}
                    value={receiveQtys[pi.id] ?? ""}
                    disabled={isFull}
                    placeholder="0"
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      const clamped = isNaN(v) ? 0 : Math.max(0, Math.min(v, remaining));
                      setReceiveQtys({ ...receiveQtys, [pi.id]: clamped });
                    }}
                    className="w-20 h-9 text-sm"
                  />
                </div>
              );
            })}
          </div>
          <Button onClick={() => receiveMut.mutate()} disabled={receiveMut.isPending} className="mt-2 rounded-lg h-9">
            Confirm Receipt
          </Button>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border bg-card p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Not Yet Received</p>
          <p className="text-xs text-muted-foreground mt-0.5">Value of outstanding items across all overseas POs (PHP equivalent)</p>
        </div>
        <p className="text-2xl font-semibold text-primary font-mono">{peso(notReceivedPhpTotal)}</p>
      </div>

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={orders.length > 0 && selectedIds.size === orders.length} onCheckedChange={toggleAll} /></TableHead>
              <TableHead className="text-xs">PO #</TableHead>
              <TableHead className="text-xs">Supplier</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Currency</TableHead>
              <TableHead className="text-xs text-right">Amount</TableHead>
              <TableHead className="text-xs text-right">PHP Equiv.</TableHead>
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : orders.length === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="empty-state"><ShoppingCart className="empty-state-icon" /><p className="text-sm">No overseas purchase orders yet</p></div></TableCell></TableRow>
            ) : orders.map(po => (
              <TableRow key={po.id} className={selectedIds.has(po.id) ? "bg-muted/40" : "hover:bg-muted/30"}>
                <TableCell><Checkbox checked={selectedIds.has(po.id)} onCheckedChange={() => toggleOne(po.id)} /></TableCell>
                <TableCell className="font-medium text-sm font-mono">{po.po_number}</TableCell>
                <TableCell className="text-sm">{po.overseas_suppliers?.name || "—"}</TableCell>
                <TableCell><StatusBadge status={po.status} context="overseas_po" /></TableCell>
                <TableCell className="text-sm">
                  <span className="inline-flex items-center rounded-md bg-accent px-2 py-0.5 text-xs font-medium">
                    {po.currency === "USD" ? "$ USD" : "¥ RMB"}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-right font-mono">
                  {po.currency === "USD" ? "$" : "¥"}{po.total_amount.toLocaleString("en", { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-sm text-right font-mono text-primary">
                  {peso(po.total_amount * po.exchange_rate)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => setViewPO(po)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    {po.status !== "received" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setReceiveOpen(po.id); setReceiveQtys({}); }}
                        className="h-7 w-7 rounded-md"
                        title="Receive items"
                      >
                        <PackageCheck className="h-3.5 w-3.5 text-success" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openEdit(po)} className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
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
