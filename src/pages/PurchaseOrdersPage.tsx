import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getPurchaseOrders, createPurchaseOrder, deletePurchaseOrder, getSuppliers, getItems, createPOItems, deletePOItems, getPOItems, receivePO, unreceivePO, generatePONumber, updatePurchaseOrder, applyPOCargoAdjustment } from "@/lib/api";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { SupplierSearch } from "@/components/SupplierSearch";
import { ItemSearch } from "@/components/ItemSearch";
import { Plus, Trash2, Eye, PackageCheck, ShoppingCart, FileDown, Pencil, Search, Truck } from "lucide-react";
import ExportButton from "@/components/ExportButton";
import { DocumentPreview } from "@/components/DocumentPreview";
import type { DocumentData } from "@/lib/pdf";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { DateField } from "@/components/DateField";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

interface LineItem { item_id: string; item_name: string; quantity: number; unit_cost: number; }

const todayISO = () => new Date().toISOString().split("T")[0];
const addDays = (dateStr: string, days: number) => {
  if (!dateStr || !days) return "";
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

export default function PurchaseOrdersPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewPO, setViewPO] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<DocumentData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState<string | null>(null);
  const [editPO, setEditPO] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ supplier_id: "", notes: "", order_date: "", payment_terms: "", status: "draft" as string });
  const [editLines, setEditLines] = useState<LineItem[]>([]);
  const [form, setForm] = useState({ supplier_id: "", notes: "", order_date: todayISO(), payment_terms: "" });
  const [lines, setLines] = useState<LineItem[]>([{ item_id: "", item_name: "", quantity: 0, unit_cost: 0 }]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const dueDate = form.payment_terms ? addDays(form.order_date, parseInt(form.payment_terms) || 0) : "";

  const toggleAll = () => {
    if (filtered.length > 0 && filtered.every((p: any) => selectedIds.has(p.id))) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((p: any) => p.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const bulkDeleteMut = useMutation({
    mutationFn: async () => { for (const id of selectedIds) await deletePurchaseOrder(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase_orders"] }); setSelectedIds(new Set()); toast.success(`Deleted ${selectedIds.size} POs`); },
  });

  const { data: pos = [] } = useQuery({ queryKey: ["purchase_orders"], queryFn: getPurchaseOrders });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: getSuppliers });
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: poItems = [] } = useQuery({ queryKey: ["po_items", viewPO || receiveOpen], queryFn: () => getPOItems(viewPO || receiveOpen || ""), enabled: !!(viewPO || receiveOpen) });
  const filtered = pos.filter((po: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [po.po_number, po.suppliers?.name, po.order_date, po.payment_due_date, po.status, po.notes]
      .some((value) => (value || "").toString().toLowerCase().includes(q));
  });

  const { sort, toggle, sorted: sortedPOs } = useSort<any>(filtered, {
    po_number: (r) => r.po_number,
    supplier: (r) => r.suppliers?.name || "",
    order_date: (r) => r.order_date,
    payment_due_date: (r) => r.payment_due_date,
    status: (r) => r.status,
    total_amount: (r) => Number(r.total_amount),
  });

  const openPreview = async (po: any) => {
    const lineItems = await getPOItems(po.id);
    const extra: { label: string; value: string }[] = [];
    if (po.payment_terms) extra.push({ label: "Payment Terms", value: `${po.payment_terms} days` });
    if (po.payment_due_date) extra.push({ label: "Payment Due", value: po.payment_due_date });
    setPreviewData({
      type: "purchase_order",
      number: po.po_number,
      date: po.order_date,
      status: po.status,
      notes: po.notes,
      recipientLabel: "Supplier",
      recipientName: po.suppliers?.name || "—",
      recipientContact: po.suppliers?.contact_person,
      recipientEmail: po.suppliers?.email,
      recipientPhone: po.suppliers?.phone,
      recipientAddress: po.suppliers?.address,
      extraFields: extra,
      items: lineItems.map((li: any) => ({
        name: li.items?.name || li.item_name || "—",
        quantity: li.quantity,
        unitPrice: Number(li.unit_cost),
        total: li.quantity * Number(li.unit_cost),
      })),
      totalAmount: Number(po.total_amount),
    });
    setPreviewOpen(true);
  };

  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});
  const [receiveLocations, setReceiveLocations] = useState<Record<string, "warehouse" | "store">>({});
  const [undoQtys, setUndoQtys] = useState<Record<string, number>>({});
  const [receiveDate, setReceiveDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [cargoPO, setCargoPO] = useState<any | null>(null);
  const [cargoForm, setCargoForm] = useState({ cargo_cost: "", shipping_fee: "", customs_fee: "", delivery_fee: "", misc_charges: "", notes: "" });
  const { data: cargoPOItems = [] } = useQuery({
    queryKey: ["po_items_cargo", cargoPO?.id],
    queryFn: () => getPOItems(cargoPO!.id),
    enabled: !!cargoPO,
  });
  const cargoTotalCharges = ["cargo_cost","shipping_fee","customs_fee","delivery_fee","misc_charges"]
    .reduce((s, k) => s + (parseFloat((cargoForm as any)[k]) || 0), 0);
  const cargoTotalQty = cargoPOItems.reduce((s: number, li: any) => s + Number(li.received_quantity || 0), 0);
  const cargoPerUnit = cargoTotalQty > 0 ? cargoTotalCharges / cargoTotalQty : 0;

  const openCargo = (po: any) => {
    setCargoForm({
      cargo_cost: po.cargo_cost ? String(po.cargo_cost) : "",
      shipping_fee: po.shipping_fee ? String(po.shipping_fee) : "",
      customs_fee: po.customs_fee ? String(po.customs_fee) : "",
      delivery_fee: po.delivery_fee ? String(po.delivery_fee) : "",
      misc_charges: po.misc_charges ? String(po.misc_charges) : "",
      notes: po.cargo_notes || "",
    });
    setCargoPO(po);
  };

  const cargoMut = useMutation({
    mutationFn: async () => {
      if (!cargoPO) return;
      if (cargoTotalQty <= 0) throw new Error("No received quantity to allocate cargo against");
      await applyPOCargoAdjustment(cargoPO.id, {
        cargo_cost: parseFloat(cargoForm.cargo_cost) || 0,
        shipping_fee: parseFloat(cargoForm.shipping_fee) || 0,
        customs_fee: parseFloat(cargoForm.customs_fee) || 0,
        delivery_fee: parseFloat(cargoForm.delivery_fee) || 0,
        misc_charges: parseFloat(cargoForm.misc_charges) || 0,
        notes: cargoForm.notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["po_items_cargo"] });
      setCargoPO(null);
      toast.success("Cargo adjustment applied — landed costs updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const validLines = lines.filter(l => l.item_id || l.item_name.trim());
      if (validLines.length === 0) throw new Error("Add at least one line item");
      for (const l of validLines) {
        if (!l.quantity || l.quantity <= 0) throw new Error(`"${l.item_name || "Item"}" must have a quantity greater than 0`);
      }
      const total = validLines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
      const terms = form.payment_terms ? parseInt(form.payment_terms) : null;
      const due = terms ? addDays(form.order_date, terms) : null;
      const po = await createPurchaseOrder({
        po_number: await generatePONumber(),
        supplier_id: form.supplier_id || null,
        notes: form.notes,
        order_date: form.order_date || todayISO(),
        payment_terms: terms,
        payment_due_date: due,
        total_amount: total,
      } as any);
      await createPOItems(validLines.map(l => ({
        po_id: po.id,
        item_id: l.item_id || null,
        item_name: l.item_id ? null : l.item_name.trim(),
        quantity: l.quantity,
        unit_cost: l.unit_cost,
      })) as any);
      return po;
    },
    onSuccess: (po) => { queryClient.invalidateQueries({ queryKey: ["purchase_orders"] }); setCreateOpen(false); toast.success("PO created"); resetForm(); openPreview(po); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deletePurchaseOrder,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase_orders"] }); toast.success("PO deleted"); },
  });

  const editDueDate = editForm.payment_terms ? addDays(editForm.order_date, parseInt(editForm.payment_terms) || 0) : "";

  const openEdit = async (po: any) => {
    const items = await getPOItems(po.id);
    setEditForm({
      supplier_id: po.supplier_id || "",
      notes: po.notes || "",
      order_date: po.order_date || todayISO(),
      payment_terms: po.payment_terms?.toString() || "",
      status: po.status || "draft",
    });
    setEditLines(items.map((pi: any) => ({
      item_id: pi.item_id || "",
      item_name: pi.items?.name || pi.item_name || "",
      quantity: pi.quantity,
      unit_cost: Number(pi.unit_cost),
    })));
    setEditPO(po);
  };

  const editMut = useMutation({
    mutationFn: async () => {
      if (!editPO) return;
      const validLines = editLines.filter(l => l.item_id || l.item_name.trim());
      if (validLines.length === 0) throw new Error("Add at least one line item");
      for (const l of validLines) {
        if (!l.quantity || l.quantity <= 0) throw new Error(`"${l.item_name || "Item"}" must have a quantity greater than 0`);
      }
      const total = validLines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
      const terms = editForm.payment_terms ? parseInt(editForm.payment_terms) : null;
      const due = terms ? addDays(editForm.order_date, terms) : null;
      await updatePurchaseOrder(editPO.id, {
        supplier_id: editForm.supplier_id || null,
        notes: editForm.notes,
        order_date: editForm.order_date,
        payment_terms: terms,
        payment_due_date: due,
        status: editForm.status,
        total_amount: total,
      } as any);
      await deletePOItems(editPO.id);
      await createPOItems(validLines.map(l => ({
        po_id: editPO.id,
        item_id: l.item_id || null,
        item_name: l.item_id ? null : l.item_name.trim(),
        quantity: l.quantity,
        unit_cost: l.unit_cost,
      })) as any);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase_orders"] }); setEditPO(null); toast.success("PO updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const addEditLine = () => setEditLines([...editLines, { item_id: "", item_name: "", quantity: 0, unit_cost: 0 }]);
  const updateEditLine = (idx: number, field: keyof LineItem, value: any) => {
    const newLines = [...editLines];
    (newLines[idx] as any)[field] = value;
    setEditLines(newLines);
  };
  const setEditItemForLine = (idx: number, itemId: string, item: any | null, customName?: string) => {
    const newLines = [...editLines];
    if (item) {
      newLines[idx].item_id = item.id;
      newLines[idx].item_name = item.name;
      newLines[idx].unit_cost = Number(item.cost_price);
    } else {
      newLines[idx].item_id = "";
      newLines[idx].item_name = customName || "";
    }
    setEditLines(newLines);
  };
  const removeEditLine = (idx: number) => setEditLines(editLines.filter((_, i) => i !== idx));

  const receiveMut = useMutation({
    mutationFn: async () => {
      const itemsToReceive = Object.entries(receiveQtys)
        .filter(([, qty]) => qty > 0)
        .map(([poItemId, qty]) => {
          const poItem = poItems.find(pi => pi.id === poItemId);
          return {
            poItemId,
            itemId: poItem?.item_id ?? null,
            quantity: qty,
            location: receiveLocations[poItemId] || "warehouse",
          };
        });
      if (itemsToReceive.length > 0) await receivePO(receiveOpen!, itemsToReceive, receiveDate);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setReceiveOpen(null); setReceiveQtys({}); setReceiveLocations({}); setUndoQtys({}); setReceiveDate(new Date().toISOString().split("T")[0]);
      toast.success("Items received and inventory updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const undoMut = useMutation({
    mutationFn: async () => {
      const itemsToUndo = Object.entries(undoQtys)
        .filter(([, qty]) => qty > 0)
        .map(([poItemId, qty]) => {
          const poItem = poItems.find(pi => pi.id === poItemId);
          return { poItemId, itemId: poItem?.item_id ?? null, quantity: qty };
        });
      if (itemsToUndo.length === 0) throw new Error("Enter quantities to undo");
      await unreceivePO(receiveOpen!, itemsToUndo);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["po_items"] });
      setUndoQtys({});
      toast.success("Receipt undone — inventory adjusted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => {
    setForm({ supplier_id: "", notes: "", order_date: todayISO(), payment_terms: "" });
    setLines([{ item_id: "", item_name: "", quantity: 0, unit_cost: 0 }]);
  };

  const addLine = () => setLines([...lines, { item_id: "", item_name: "", quantity: 0, unit_cost: 0 }]);
  const updateLine = (idx: number, field: keyof LineItem, value: any) => {
    const newLines = [...lines];
    (newLines[idx] as any)[field] = value;
    setLines(newLines);
  };
  const setItemForLine = (idx: number, itemId: string, item: any | null, customName?: string) => {
    const newLines = [...lines];
    if (item) {
      newLines[idx].item_id = item.id;
      newLines[idx].item_name = item.name;
      newLines[idx].unit_cost = Number(item.cost_price);
    } else {
      newLines[idx].item_id = "";
      newLines[idx].item_name = customName || "";
    }
    setLines(newLines);
  };
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Purchase Orders</h1>
          <p className="page-description">{filtered.length} order{filtered.length !== 1 ? "s" : ""}{filtered.length !== pos.length ? ` (filtered from ${pos.length})` : ""}</p>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (
            <>
              <BulkEditDialog
                selectedIds={Array.from(selectedIds)}
                entityLabel="POs"
                fields={[
                  { key: "status", label: "Status", type: "select", options: [
                    { value: "draft", label: "Draft" },
                    { value: "sent", label: "Sent" },
                    { value: "partially_received", label: "Partially Received" },
                    { value: "received", label: "Received" },
                    { value: "pending_cargo_adjustment", label: "Pending Cargo Adjustment" },
                    { value: "cargo_adjusted", label: "Cargo Adjusted" },
                    { value: "closed", label: "Closed" },
                  ]},
                  { key: "order_date", label: "Order Date", type: "date" },
                  { key: "payment_terms", label: "Payment Terms (days)", type: "number", transform: v => parseInt(v) || null },
                  { key: "payment_due_date", label: "Payment Due Date", type: "date" },
                  { key: "notes", label: "Notes", type: "textarea" },
                ] as BulkField[]}
                updateOne={async (id, patch) => { await updatePurchaseOrder(id, patch as any); }}
                onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["purchase_orders"] }); setSelectedIds(new Set()); }}
              />
              <Button variant="destructive" size="sm" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete {selectedIds.size} selected
              </Button>
            </>
          )}
          <ExportButton
            data={pos}
            columns={{
              "PO #": (r: any) => r.po_number,
              "Order Date": (r: any) => r.order_date,
              "Supplier": (r: any) => r.suppliers?.name || "",
              "Status": (r: any) => r.status,
              "Payment Terms": (r: any) => r.payment_terms ? `${r.payment_terms} days` : "",
              "Payment Due": (r: any) => r.payment_due_date || "",
              "Expected Delivery": (r: any) => r.expected_delivery || "",
              "PO Total": (r: any) => r.total_amount,
              "Notes": (r: any) => r.notes || "",
            }}
            childItems={{
              table: "purchase_order_items",
              foreignKey: "po_id",
              select: "*, items(name, sku)",
              columns: {
                "Item Name": (li: any) => li.item_name || li.items?.name || "",
                "SKU": (li: any) => li.items?.sku || "",
                "Quantity": (li: any) => Number(li.quantity || 0),
                "Received": (li: any) => Number(li.received_quantity || 0),
                "Received Date": (li: any) => li.received_date || "",
                "Unit Cost": (li: any) => Number(li.unit_cost || 0),
                "Line Total": (li: any) => Number(li.quantity || 0) * Number(li.unit_cost || 0),
              },
            }}
            dateField={(r: any) => r.order_date || ""}
            fileName="Purchase_Orders"
          />
          <Button onClick={() => { resetForm(); setCreateOpen(true); }} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> New PO
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search purchase orders..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">New Purchase Order</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Supplier</Label>
              <SupplierSearch
                suppliers={suppliers}
                value={form.supplier_id}
                onChange={(id) => setForm({ ...form, supplier_id: id })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Order Date</Label>
                <DateField value={form.order_date} onChange={v => setForm({ ...form, order_date: v })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Terms (days)</Label>
                <Input type="number" min={0} value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })} placeholder="e.g. 30" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Due Date</Label>
                <Input type="date" value={dueDate} disabled className="h-9 bg-muted/40" />
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
                  <div key={idx} className="border rounded-md p-2 sm:border-0 sm:p-0 grid grid-cols-1 sm:grid-cols-[1fr_70px_90px_32px] gap-2">
                    <ItemSearch
                      items={items}
                      value={line.item_id}
                      customName={line.item_name && !line.item_id ? line.item_name : undefined}
                      onChange={(id, item, customName) => setItemForLine(idx, id, item, customName)}
                      allowCustom
                      sourceFilter={isAdmin ? undefined : 'local'}
                      placeholder={isAdmin ? "Search inventory or type custom item..." : "Search local items or type custom..."}
                    />
                    <div className="grid grid-cols-[1fr_1fr_32px] gap-2 sm:contents">
                      <Input type="number" min={1} value={line.quantity || ""} onChange={e => updateLine(idx, "quantity", parseInt(e.target.value) || 0)} className="h-9 text-sm" placeholder="Qty" />
                      <Input type="number" value={line.unit_cost} onChange={e => updateLine(idx, "unit_cost", parseFloat(e.target.value) || 0)} className="h-9 text-sm" placeholder="Cost" />
                      <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-9 w-8">
                        <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">Total: {peso(lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0))}</span>
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
              <TableHeader><TableRow><TableHead className="text-xs">Item</TableHead><TableHead className="text-xs">Qty</TableHead><TableHead className="text-xs">Received</TableHead><TableHead className="text-xs">Date Received</TableHead><TableHead className="text-xs text-right">Cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {poItems.map((pi: any) => (
                  <TableRow key={pi.id}>
                    <TableCell className="text-sm font-medium">
                      {pi.items?.name || pi.item_name || "—"}
                      {!pi.items && pi.item_name && <span className="ml-2 text-xs text-muted-foreground">(custom)</span>}
                    </TableCell>
                    <TableCell className="text-sm">{pi.quantity}</TableCell>
                    <TableCell className="text-sm">{pi.item_id ? pi.received_quantity : "—"}</TableCell>
                    <TableCell className="text-sm">{pi.received_date ? new Date(pi.received_date).toLocaleDateString("en-US") : "—"}</TableCell>
                    <TableCell className="text-sm text-right">{peso(Number(pi.unit_cost))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receive Dialog */}
      <Dialog open={!!receiveOpen} onOpenChange={() => { setReceiveOpen(null); setReceiveQtys({}); setReceiveLocations({}); setUndoQtys({}); setReceiveDate(new Date().toISOString().split("T")[0]); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="text-lg">Receive / Undo Items</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Date Received</Label>
            <DateField value={receiveDate} onChange={setReceiveDate} />
          </div>
          <p className="text-xs text-muted-foreground">Enter a quantity in <span className="font-medium text-foreground">Receive</span> to add to inventory at the chosen location, or in <span className="font-medium text-foreground">Undo</span> to deduct from inventory and reverse a prior receipt.</p>
          <div className="grid grid-cols-[1fr_120px_80px_80px] gap-2 px-3 pb-1 text-[10px] font-medium uppercase text-muted-foreground">
            <span>Item</span>
            <span className="text-center">Location</span>
            <span className="text-center">Receive</span>
            <span className="text-center">Undo</span>
          </div>
          <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            {poItems.map((pi: any) => {
              const remaining = pi.quantity - pi.received_quantity;
              const isCustom = !pi.item_id;
              const location = receiveLocations[pi.id] || "warehouse";
              return (
                <div key={pi.id} className="grid grid-cols-[1fr_120px_80px_80px] items-center gap-2 p-3 rounded-lg border bg-muted/30">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{pi.items?.name || pi.item_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {isCustom
                        ? `Custom item — not tracked in inventory · Ordered: ${pi.quantity} · Received: ${pi.received_quantity} · Remaining: ${remaining}`
                        : `Ordered: ${pi.quantity} · Received: ${pi.received_quantity} · Remaining: ${remaining}`}
                    </p>
                  </div>
                  <Select
                    value={location}
                    onValueChange={(v) => setReceiveLocations({ ...receiveLocations, [pi.id]: v as "warehouse" | "store" })}
                    disabled={isCustom || remaining <= 0}
                  >
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={isCustom ? "—" : undefined} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warehouse">Warehouse</SelectItem>
                      <SelectItem value="store">Store</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="number" min={0} max={remaining} value={receiveQtys[pi.id] || 0} disabled={remaining <= 0} onChange={e => setReceiveQtys({ ...receiveQtys, [pi.id]: Math.min(parseInt(e.target.value) || 0, remaining) })} className="h-9 text-sm text-center" />
                  <Input type="number" min={0} max={pi.received_quantity} value={undoQtys[pi.id] || 0} disabled={pi.received_quantity <= 0} onChange={e => setUndoQtys({ ...undoQtys, [pi.id]: Math.min(parseInt(e.target.value) || 0, pi.received_quantity) })} className="h-9 text-sm text-center" />
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 mt-2">
            <Button onClick={() => receiveMut.mutate()} disabled={receiveMut.isPending || Object.values(receiveQtys).every(v => !v)} className="flex-1 rounded-lg h-9">Confirm Receipt</Button>
            <Button variant="outline" onClick={() => undoMut.mutate()} disabled={undoMut.isPending || Object.values(undoQtys).every(v => !v)} className="flex-1 rounded-lg h-9 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">Undo Receipt</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={filtered.length > 0 && filtered.every((po: any) => selectedIds.has(po.id))} onCheckedChange={toggleAll} /></TableHead>
              <SortableHeader sortKey="po_number" label="PO #" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="supplier" label="Supplier" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="order_date" label="Order Date" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="payment_due_date" label="Payment Due" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="status" label="Status" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="total_amount" label="Total" sort={sort} onToggle={toggle} align="right" />
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedPOs.length === 0 ? (
              <TableRow><TableCell colSpan={8}><div className="empty-state"><ShoppingCart className="empty-state-icon" /><p className="text-sm">No purchase orders</p></div></TableCell></TableRow>
            ) : sortedPOs.map((po: any) => (
              <TableRow key={po.id} className={selectedIds.has(po.id) ? "bg-muted/40" : "hover:bg-muted/30"}>
                <TableCell><Checkbox checked={selectedIds.has(po.id)} onCheckedChange={() => toggleOne(po.id)} /></TableCell>
                <TableCell className="font-mono text-xs font-semibold">{po.po_number}</TableCell>
                <TableCell className="text-sm">{po.suppliers?.name || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{po.order_date}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{po.payment_due_date || "—"}</TableCell>
                <TableCell><StatusBadge status={po.status} /></TableCell>
                <TableCell className="text-right text-sm font-medium">{peso(Number(po.total_amount))}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => openPreview(po)} title="Preview & Download PDF" className="h-7 w-7 rounded-md"><FileDown className="h-3.5 w-3.5 text-primary" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setViewPO(po.id)} className="h-7 w-7 rounded-md"><Eye className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(po)} title="Edit" className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { setReceiveOpen(po.id); setReceiveQtys({}); setReceiveLocations({}); setUndoQtys({}); }} title={po.status === "received" ? "Undo Receipt" : "Receive / Undo"} className="h-7 w-7 rounded-md"><PackageCheck className="h-3.5 w-3.5 text-success" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(po.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editPO} onOpenChange={(o) => { if (!o) setEditPO(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">Edit Purchase Order {editPO?.po_number}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Supplier</Label>
              <SupplierSearch suppliers={suppliers} value={editForm.supplier_id} onChange={(id) => setEditForm({ ...editForm, supplier_id: id })} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Order Date</Label>
                <DateField value={editForm.order_date} onChange={v => setEditForm({ ...editForm, order_date: v })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Terms (days)</Label>
                <Input type="number" min={0} value={editForm.payment_terms} onChange={e => setEditForm({ ...editForm, payment_terms: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Payment Due</Label>
                <Input type="date" value={editDueDate} disabled className="h-9 bg-muted/40" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Status</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="partially_received">Partially Received</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} className="resize-none" rows={2} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-xs font-medium">Line Items</Label>
                <Button variant="outline" size="sm" onClick={addEditLine} className="h-7 rounded-md text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {editLines.map((line, idx) => (
                  <div key={idx} className="border rounded-md p-2 sm:border-0 sm:p-0 grid grid-cols-1 sm:grid-cols-[1fr_70px_90px_32px] gap-2">
                    <ItemSearch
                      items={items}
                      value={line.item_id}
                      customName={line.item_name && !line.item_id ? line.item_name : undefined}
                      onChange={(id, item, customName) => setEditItemForLine(idx, id, item, customName)}
                      allowCustom
                      sourceFilter={isAdmin ? undefined : 'local'}
                      placeholder={isAdmin ? "Search inventory or type custom item..." : "Search local items or type custom..."}
                    />
                    <div className="grid grid-cols-[1fr_1fr_32px] gap-2 sm:contents">
                      <Input type="number" min={1} value={line.quantity || ""} onChange={e => updateEditLine(idx, "quantity", parseInt(e.target.value) || 0)} className="h-9 text-sm" placeholder="Qty" />
                      <Input type="number" value={line.unit_cost} onChange={e => updateEditLine(idx, "unit_cost", parseFloat(e.target.value) || 0)} className="h-9 text-sm" placeholder="Cost" />
                      <Button variant="ghost" size="icon" onClick={() => removeEditLine(idx)} className="h-9 w-8">
                        <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <span className="text-sm font-semibold">Total: {peso(editLines.reduce((s, l) => s + l.quantity * l.unit_cost, 0))}</span>
              </div>
            </div>
            <Button onClick={() => editMut.mutate()} disabled={editMut.isPending} className="rounded-lg h-9">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>

      <DocumentPreview open={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} />
    </div>
  );
}
