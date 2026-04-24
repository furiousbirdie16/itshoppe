import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getShipments, createShipment, updateShipment, deleteShipment, getOverseasPurchaseOrders, getOverseasPOItems } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Ship, CalendarIcon, Package, Search } from "lucide-react";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ShipmentTracking, OverseasPurchaseOrder, OverseasPurchaseOrderItem } from "@/types/database";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";

const statusColors: Record<string, string> = {
  in_transit: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  customs: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  delivered: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const statusLabels: Record<string, string> = {
  in_transit: "In Transit",
  customs: "At Customs",
  delivered: "Delivered",
};

interface FormState {
  po_id: string;
  tracking_number: string;
  shipping_method: string;
  ship_date: Date | undefined;
  estimated_arrival: Date | undefined;
  actual_arrival: Date | undefined;
  status: string;
  notes: string;
}

const defaultForm: FormState = {
  po_id: "",
  tracking_number: "",
  shipping_method: "",
  ship_date: undefined,
  estimated_arrival: undefined,
  actual_arrival: undefined,
  status: "in_transit",
  notes: "",
};

export default function ShipmentTrackingPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ShipmentTracking | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [itemsShipment, setItemsShipment] = useState<ShipmentTracking | null>(null);
  const [search, setSearch] = useState("");

  const { data: poItems = [], isLoading: poItemsLoading } = useQuery<OverseasPurchaseOrderItem[]>({
    queryKey: ["overseas_po_items", itemsShipment?.po_id],
    queryFn: () => getOverseasPOItems(itemsShipment!.po_id!),
    enabled: !!itemsShipment?.po_id,
  });

  const toggleAll = () => {
    if (filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id))) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((s) => s.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const bulkDeleteMut = useMutation({
    mutationFn: async () => { for (const id of selectedIds) await deleteShipment(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["shipments"] }); setSelectedIds(new Set()); toast.success(`Deleted ${selectedIds.size} shipments`); },
  });

  const { data: shipments = [], isLoading } = useQuery<ShipmentTracking[]>({ queryKey: ["shipments"], queryFn: getShipments });
  const { data: orders = [] } = useQuery<OverseasPurchaseOrder[]>({ queryKey: ["overseas_pos"], queryFn: getOverseasPurchaseOrders });
  const filtered = shipments.filter((shipment: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [
      shipment.overseas_purchase_orders?.po_number,
      shipment.overseas_purchase_orders?.overseas_suppliers?.name,
      shipment.tracking_number,
      shipment.shipping_method,
      shipment.ship_date,
      shipment.estimated_arrival,
      shipment.status,
      shipment.notes,
    ].some((value) => (value || "").toString().toLowerCase().includes(q));
  });

  const { sort, toggle, sorted: sortedShipments } = useSort<ShipmentTracking>(filtered, {
    po_number: (r: any) => r.overseas_purchase_orders?.po_number || "",
    supplier: (r: any) => r.overseas_purchase_orders?.overseas_suppliers?.name || "",
    tracking_number: (r) => r.tracking_number,
    shipping_method: (r) => r.shipping_method,
    ship_date: (r) => r.ship_date,
    estimated_arrival: (r) => r.estimated_arrival,
    status: (r) => r.status,
    days_left: (r) => {
      if (r.status === "delivered" || !r.estimated_arrival) return null;
      return differenceInDays(new Date(r.estimated_arrival), new Date());
    },
  });

  const createMut = useMutation({
    mutationFn: (data: Partial<ShipmentTracking>) => createShipment(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["shipments"] }); setOpen(false); toast.success("Shipment logged"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ShipmentTracking> }) => updateShipment(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["shipments"] }); setOpen(false); setEditing(null); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteShipment,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["shipments"] }); toast.success("Deleted"); },
  });

  const openCreate = () => { setEditing(null); setForm(defaultForm); setOpen(true); };
  const openEdit = (s: ShipmentTracking) => {
    setEditing(s);
    setForm({
      po_id: s.po_id || "",
      tracking_number: s.tracking_number,
      shipping_method: s.shipping_method,
      ship_date: s.ship_date ? new Date(s.ship_date) : undefined,
      estimated_arrival: s.estimated_arrival ? new Date(s.estimated_arrival) : undefined,
      actual_arrival: s.actual_arrival ? new Date(s.actual_arrival) : undefined,
      status: s.status,
      notes: s.notes,
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (form.status === "delivered" && !form.actual_arrival) {
      toast.error("Please set the Actual Arrival date when marking as delivered.");
      return;
    }
    const payload: Partial<ShipmentTracking> = {
      po_id: form.po_id || null,
      tracking_number: form.tracking_number,
      shipping_method: form.shipping_method,
      ship_date: form.ship_date ? format(form.ship_date, "yyyy-MM-dd") : null,
      estimated_arrival: form.estimated_arrival ? format(form.estimated_arrival, "yyyy-MM-dd") : null,
      actual_arrival: form.actual_arrival ? format(form.actual_arrival, "yyyy-MM-dd") : null,
      status: form.status as any,
      notes: form.notes,
    };
    if (editing) updateMut.mutate({ id: editing.id, data: payload });
    else createMut.mutate(payload);
  };

  const getDaysRemaining = (s: ShipmentTracking) => {
    if (s.status === "delivered") return null;
    if (!s.estimated_arrival) return null;
    const days = differenceInDays(new Date(s.estimated_arrival), new Date());
    return days;
  };

  const DatePicker = ({ label, value, onChange }: { label: string; value: Date | undefined; onChange: (d: Date | undefined) => void }) => (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn("w-full h-9 justify-start text-left font-normal text-sm", !value && "text-muted-foreground")}>
            <CalendarIcon className="h-3.5 w-3.5 mr-2" />
            {value ? format(value, "PPP") : "Pick a date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={value} onSelect={onChange} initialFocus className={cn("p-3 pointer-events-auto")} />
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Shipment Tracking</h1>
          <p className="page-description">{filtered.length} shipment{filtered.length !== 1 ? "s" : ""}{filtered.length !== shipments.length ? ` (filtered from ${shipments.length})` : ""}</p>
        </div>
        <div className="toolbar-actions">
          {selectedIds.size > 0 && (
            <>
              <BulkEditDialog
                selectedIds={Array.from(selectedIds)}
                entityLabel="shipments"
                fields={[
                  { key: "status", label: "Status", type: "select", options: [
                    { value: "in_transit", label: "In Transit" },
                    { value: "customs", label: "At Customs" },
                    { value: "delivered", label: "Delivered" },
                  ]},
                  { key: "shipping_method", label: "Shipping Method", type: "text" },
                  { key: "ship_date", label: "Ship Date", type: "date" },
                  { key: "estimated_arrival", label: "Estimated Arrival", type: "date" },
                  { key: "actual_arrival", label: "Actual Arrival", type: "date" },
                  { key: "notes", label: "Notes", type: "textarea" },
                ] as BulkField[]}
                updateOne={async (id, patch) => { await updateShipment(id, patch as any); }}
                onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["shipments"] }); setSelectedIds(new Set()); }}
              />
              <Button variant="destructive" size="sm" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete {selectedIds.size} selected
              </Button>
            </>
          )}
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> Log Shipment
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search shipments..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">{editing ? "Edit Shipment" : "Log New Shipment"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Overseas Purchase Order</Label>
              <Select value={form.po_id} onValueChange={v => setForm({ ...form, po_id: v })}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Select PO" /></SelectTrigger>
                <SelectContent>
                  {orders.map(po => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.po_number} — {po.overseas_suppliers?.name || "Unknown"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Tracking Number</Label>
                <Input value={form.tracking_number} onChange={e => setForm({ ...form, tracking_number: e.target.value })} className="h-9" placeholder="e.g. SHIP-12345" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Shipping Method</Label>
                <Input value={form.shipping_method} onChange={e => setForm({ ...form, shipping_method: e.target.value })} className="h-9" placeholder="e.g. Sea Freight, Air" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DatePicker label="Ship Date" value={form.ship_date} onChange={d => setForm({ ...form, ship_date: d })} />
              <DatePicker label="Estimated Arrival" value={form.estimated_arrival} onChange={d => setForm({ ...form, estimated_arrival: d })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DatePicker label="Actual Arrival" value={form.actual_arrival} onChange={d => setForm({ ...form, actual_arrival: d })} />
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      status: v,
                      actual_arrival: v === "delivered" && !form.actual_arrival ? new Date() : form.actual_arrival,
                    })
                  }
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_transit">In Transit</SelectItem>
                    <SelectItem value="customs">At Customs</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="resize-none" rows={2} />
            </div>
            <Button onClick={handleSubmit} className="mt-2 rounded-lg h-9">{editing ? "Update" : "Log Shipment"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><Checkbox checked={filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id))} onCheckedChange={toggleAll} /></TableHead>
              <SortableHeader sortKey="po_number" label="PO #" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="supplier" label="Supplier" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="tracking_number" label="Tracking #" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="shipping_method" label="Method" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="ship_date" label="Shipped" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="estimated_arrival" label="ETA" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="actual_arrival" label="Delivered On" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="status" label="Status" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="days_left" label="Days Left" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs text-right w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={11} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : sortedShipments.length === 0 ? (
              <TableRow><TableCell colSpan={11}><div className="empty-state"><Ship className="empty-state-icon" /><p className="text-sm">No shipments logged yet</p></div></TableCell></TableRow>
            ) : sortedShipments.map(s => {
              const po = s.overseas_purchase_orders as any;
              const daysLeft = getDaysRemaining(s);
              return (
                <TableRow key={s.id} className={selectedIds.has(s.id) ? "bg-muted/40" : "hover:bg-muted/30"}>
                  <TableCell><Checkbox checked={selectedIds.has(s.id)} onCheckedChange={() => toggleOne(s.id)} /></TableCell>
                  <TableCell className="font-medium text-sm font-mono">{po?.po_number || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{po?.overseas_suppliers?.name || "—"}</TableCell>
                  <TableCell className="text-sm font-mono">{s.tracking_number || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.shipping_method || "—"}</TableCell>
                  <TableCell className="text-sm">{s.ship_date ? format(new Date(s.ship_date), "MMM d, yyyy") : "—"}</TableCell>
                  <TableCell className="text-sm">{s.estimated_arrival ? format(new Date(s.estimated_arrival), "MMM d, yyyy") : "—"}</TableCell>
                  <TableCell className="text-sm">{s.actual_arrival ? format(new Date(s.actual_arrival), "MMM d, yyyy") : "—"}</TableCell>
                  <TableCell>
                    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", statusColors[s.status])}>
                      {statusLabels[s.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {daysLeft !== null ? (
                      <span className={cn("font-medium", daysLeft < 0 ? "text-destructive" : daysLeft <= 3 ? "text-yellow-600" : "text-muted-foreground")}>
                        {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d`}
                      </span>
                    ) : s.status === "delivered" ? (
                      <span className="text-green-600 text-xs font-medium">✓ Arrived</span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-0.5">
                      {s.po_id && (
                        <Button variant="ghost" size="icon" onClick={() => setItemsShipment(s)} className="h-7 w-7 rounded-md" title="View PO items"><Package className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => openEdit(s)} className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(s.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* PO Items Dialog */}
      <Dialog open={!!itemsShipment} onOpenChange={(o) => !o && setItemsShipment(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">
              PO Items — {(itemsShipment?.overseas_purchase_orders as any)?.po_number || "—"}
            </DialogTitle>
          </DialogHeader>
          <div className="pt-2">
            {poItemsLoading ? (
              <div className="flex justify-center py-8"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
            ) : poItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No items on this PO.</p>
            ) : (
              <div className="data-table-wrapper">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Item</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-xs text-right">Ordered</TableHead>
                      <TableHead className="text-xs text-right">Received</TableHead>
                      <TableHead className="text-xs text-right">Unit Cost</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poItems.map((it) => {
                      const fully = (it.received_quantity || 0) >= it.quantity;
                      const partial = (it.received_quantity || 0) > 0 && !fully;
                      return (
                        <TableRow key={it.id}>
                          <TableCell className="text-sm font-medium">{it.item_name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{it.description || "—"}</TableCell>
                          <TableCell className="text-sm text-right">{it.quantity}</TableCell>
                          <TableCell className="text-sm text-right">{it.received_quantity || 0}</TableCell>
                          <TableCell className="text-sm text-right">{Number(it.unit_cost).toFixed(2)}</TableCell>
                          <TableCell>
                            <span className={cn(
                              "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                              fully ? statusColors.delivered : partial ? statusColors.customs : statusColors.in_transit,
                            )}>
                              {fully ? "Delivered" : partial ? "Partial" : "Pending"}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
