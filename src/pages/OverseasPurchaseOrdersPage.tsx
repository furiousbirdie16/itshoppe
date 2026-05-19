import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOverseasPurchaseOrders, createOverseasPurchaseOrder, updateOverseasPurchaseOrder, deleteOverseasPurchaseOrder,
  getOverseasSuppliers, generateOverseasPONumber, getOverseasPOItems, createOverseasPOItems, deleteOverseasPOItems, getItems, receiveOverseasPO, getAllOverseasPOItems, getShipments,
} from "@/lib/api";
import type { ShipmentTracking } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, ShoppingCart, Eye, X, PackageCheck, Upload, Search, FileDown } from "lucide-react";
import ShipmentTrackingPage from "@/pages/ShipmentTrackingPage";
import ExportButton from "@/components/ExportButton";
import OverseasPOBulkUploadDialog from "@/components/OverseasPOBulkUploadDialog";
import { DocumentPreview } from "@/components/DocumentPreview";
import { toast } from "sonner";
import { peso } from "@/lib/currency";
import { StatusBadge } from "@/components/StatusBadge";
import { ItemSearch } from "@/components/ItemSearch";
import type { OverseasPurchaseOrder, OverseasSupplier, OverseasPurchaseOrderItem } from "@/types/database";
import type { DocumentData } from "@/lib/pdf";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { DateField } from "@/components/DateField";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";
import { usePermissions } from "@/lib/permissions";

interface LineItem {
  item_name: string;
  description: string;
  quantity: number | "";
  unit_cost: number | "";
  item_id: string;
}

interface IncomingStockRow {
  id: string;
  po_id: string;
  po_number: string;
  supplier_name: string;
  status: string;
  currency: "USD" | "RMB";
  exchange_rate: number;
  order_date: string;
  expected_delivery: string | null;
  item_name: string;
  description: string;
  sku: string;
  ordered_quantity: number;
  received_quantity: number;
  remaining_quantity: number;
  unit_cost: number;
  line_total: number;
  php_value: number;
}

const emptyLine = (): LineItem => ({ item_name: "", description: "", quantity: "", unit_cost: "", item_id: "" });

export default function OverseasPurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const { isAdmin } = usePermissions();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OverseasPurchaseOrder | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<string>("unpaid");
  const [orderDate, setOrderDate] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [exchangeRate, setExchangeRate] = useState("1");
  const [currency, setCurrency] = useState<"USD" | "RMB">("USD");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "not_shipped" | "incoming" | "received">("all");
  const [incomingSearch, setIncomingSearch] = useState("");
  const [incomingSupplierFilter, setIncomingSupplierFilter] = useState<string>("all");
  const [incomingReceiptFilter, setIncomingReceiptFilter] = useState<string>("incoming");
  const [previewData, setPreviewData] = useState<DocumentData | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const toggleAll = () => {
    if (filteredOrders.length > 0 && filteredOrders.every((o) => selectedIds.has(o.id))) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredOrders.map((o) => o.id)));
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
  const [receiveLocations, setReceiveLocations] = useState<Record<string, "warehouse" | "store">>({});
  const [receiveDate, setReceiveDate] = useState<string>(new Date().toISOString().split("T")[0]);


  const { data: orders = [], isLoading } = useQuery<OverseasPurchaseOrder[]>({ queryKey: ["overseas_pos"], queryFn: getOverseasPurchaseOrders });
  const statusBuckets: Record<string, "not_shipped" | "incoming" | "received"> = {
    unpaid: "not_shipped",
    paid_not_shipped: "not_shipped",
    draft: "not_shipped",
    shipped_not_paid: "incoming",
    shipped: "incoming",
    sent: "incoming",
    partially_received: "incoming",
    received: "received",
  };
  const filteredOrders = orders.filter((order: any) => {
    if (statusFilter !== "all" && statusBuckets[order.status] !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [
      order.po_number,
      order.overseas_suppliers?.name,
      order.status,
      order.currency,
      order.order_date,
      order.expected_delivery,
      order.notes,
    ].some((value) => (value || "").toString().toLowerCase().includes(q));
  });
  const bucketCounts = orders.reduce(
    (acc, o: any) => {
      const b = statusBuckets[o.status];
      if (b) acc[b]++;
      return acc;
    },
    { not_shipped: 0, incoming: 0, received: 0 } as Record<string, number>,
  );
  const { data: suppliers = [] } = useQuery<OverseasSupplier[]>({ queryKey: ["overseas_suppliers"], queryFn: getOverseasSuppliers });
  const { data: inventoryItems = [] } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: allPOItems = [] } = useQuery<OverseasPurchaseOrderItem[]>({ queryKey: ["overseas_po_items_all"], queryFn: getAllOverseasPOItems });
  const { data: shipments = [] } = useQuery<ShipmentTracking[]>({ queryKey: ["shipments"], queryFn: getShipments });
  const shipmentByPo = useMemo(() => {
    const map = new Map<string, ShipmentTracking>();
    for (const s of shipments) {
      if (!s.po_id) continue;
      const existing = map.get(s.po_id);
      // prefer most recent (by ship_date or estimated_arrival)
      if (!existing) map.set(s.po_id, s);
      else {
        const a = new Date(s.ship_date || s.estimated_arrival || s.created_at || 0).getTime();
        const b = new Date(existing.ship_date || existing.estimated_arrival || existing.created_at || 0).getTime();
        if (a > b) map.set(s.po_id, s);
      }
    }
    return map;
  }, [shipments]);
  const { sort, toggle, sorted: sortedOrders } = useSort<OverseasPurchaseOrder>(filteredOrders, {
    po_number: (r) => r.po_number,
    supplier: (r: any) => r.overseas_suppliers?.name || "",
    status: (r) => r.status,
    currency: (r) => r.currency,
    total_amount: (r) => Number(r.total_amount),
    php_total: (r) => Number(r.total_amount) * Number(r.exchange_rate || 1),
    order_date: (r) => r.order_date,
    expected_delivery: (r) => r.expected_delivery,
    eta: (r) => shipmentByPo.get(r.id)?.estimated_arrival || r.expected_delivery || "",
  });
  const itemsByPo = useMemo(() => {
    const map = new Map<string, OverseasPurchaseOrderItem[]>();
    for (const it of allPOItems) {
      const arr = map.get(it.po_id) || [];
      arr.push(it);
      map.set(it.po_id, arr);
    }
    return map;
  }, [allPOItems]);
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
      return po;
    },
    onSuccess: (po) => {
      queryClient.invalidateQueries({ queryKey: ["overseas_pos"] });
      queryClient.invalidateQueries({ queryKey: ["overseas_po_items_all"] });
      setOpen(false);
      toast.success("Overseas PO created");
      openPreview(po as OverseasPurchaseOrder);
    },
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
          return {
            poItemId,
            itemId: pi?.item_id || null,
            quantity: qty,
            location: receiveLocations[poItemId] || "warehouse",
          };
        });
      if (itemsToReceive.length === 0) {
        toast.info("Enter a quantity for at least one item");
        return;
      }
      await receiveOverseasPO(receiveOpen!, itemsToReceive, receiveDate);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overseas_pos"] });
      queryClient.invalidateQueries({ queryKey: ["overseas_po_items", receiveOpen] });
      queryClient.invalidateQueries({ queryKey: ["overseas_po_items_all"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setReceiveOpen(null);
      setReceiveQtys({});
      setReceiveLocations({});
      setReceiveDate(new Date().toISOString().split("T")[0]);
      toast.success("Items received and added to stock");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setSupplierId("");
    setStatus("unpaid");
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

  const openPreview = async (po: OverseasPurchaseOrder) => {
    const poItems = await getOverseasPOItems(po.id);
    setPreviewData({
      type: "purchase_order",
      number: po.po_number,
      date: po.order_date || "",
      status: po.status,
      currencyCode: po.currency,
      currencySymbol: po.currency === "USD" ? "$" : "¥",
      notes: po.notes || "",
      recipientLabel: "Supplier",
      recipientName: po.overseas_suppliers?.name || "—",
      recipientContact: po.overseas_suppliers?.contact_person || undefined,
      recipientEmail: po.overseas_suppliers?.email || undefined,
      recipientPhone: po.overseas_suppliers?.phone || undefined,
      recipientAddress: po.overseas_suppliers?.address || undefined,
      extraFields: [
        { label: "Currency", value: po.currency },
        { label: "Exchange Rate", value: String(po.exchange_rate || 1) },
        ...(po.expected_delivery ? [{ label: "ETA", value: po.expected_delivery }] : []),
      ],
      items: poItems.map((item) => ({
        name: item.item_name || item.items?.name || "—",
        sku: item.items?.sku || undefined,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unit_cost || 0),
        total: Number(item.quantity || 0) * Number(item.unit_cost || 0),
      })),
      totalAmount: Number(po.total_amount || 0),
    });
    setPreviewOpen(true);
  };

  const addLine = () => setLines([...lines, emptyLine()]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  const foreignTotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);
  const phpTotal = foreignTotal * (parseFloat(exchangeRate) || 0);
  const currencySymbol = currency === "USD" ? "$" : "¥";

  const incomingRows = useMemo<IncomingStockRow[]>(() => {
    const ordersById = new Map(orders.map((order) => [order.id, order]));

    return allPOItems.map((item) => {
      const po = ordersById.get(item.po_id);
      const orderedQuantity = Number(item.quantity || 0);
      const receivedQuantity = Number(item.received_quantity || 0);
      const remainingQuantity = Math.max(0, orderedQuantity - receivedQuantity);
      const unitCost = Number(item.unit_cost || 0);
      const lineTotal = orderedQuantity * unitCost;
      const exchangeRate = Number(po?.exchange_rate || 1);

      return {
        id: item.id,
        po_id: item.po_id,
        po_number: po?.po_number || "—",
        supplier_name: po?.overseas_suppliers?.name || "—",
        status: po?.status || "unpaid",
        currency: (po?.currency || "USD") as "USD" | "RMB",
        exchange_rate: exchangeRate,
        order_date: po?.order_date || "",
        expected_delivery: po?.expected_delivery || null,
        item_name: item.item_name,
        description: item.description || "",
        sku: item.items?.sku || "",
        ordered_quantity: orderedQuantity,
        received_quantity: receivedQuantity,
        remaining_quantity: remainingQuantity,
        unit_cost: unitCost,
        line_total: lineTotal,
        php_value: lineTotal * exchangeRate,
      };
    });
  }, [allPOItems, orders]);

  const filteredIncomingRows = incomingRows.filter((row) => {
    const q = incomingSearch.trim().toLowerCase();
    const matchesSearch = !q || [
      row.po_number,
      row.supplier_name,
      row.item_name,
      row.description,
      row.sku,
      row.status,
      row.order_date,
      row.expected_delivery,
    ].some((value) => (value || "").toString().toLowerCase().includes(q));

    const matchesSupplier = incomingSupplierFilter === "all" || row.supplier_name === incomingSupplierFilter;
    const matchesReceipt =
      incomingReceiptFilter === "all" ||
      (incomingReceiptFilter === "incoming" && row.remaining_quantity > 0) ||
      (incomingReceiptFilter === "received" && row.remaining_quantity === 0) ||
      (incomingReceiptFilter === "partial" && row.received_quantity > 0 && row.remaining_quantity > 0) ||
      (incomingReceiptFilter === "unreceived" && row.received_quantity === 0);

    return matchesSearch && matchesSupplier && matchesReceipt;
  });

  const {
    sort: incomingSort,
    toggle: toggleIncomingSort,
    sorted: sortedIncomingRows,
  } = useSort<IncomingStockRow>(filteredIncomingRows, {
    po_number: (row) => row.po_number,
    supplier: (row) => row.supplier_name,
    product: (row) => row.item_name,
    sku: (row) => row.sku,
    ordered: (row) => row.ordered_quantity,
    received: (row) => row.received_quantity,
    remaining: (row) => row.remaining_quantity,
    unit_cost: (row) => row.unit_cost,
    line_total: (row) => row.line_total,
    php_value: (row) => row.php_value,
    order_date: (row) => row.order_date,
    expected_delivery: (row) => row.expected_delivery || "",
  });

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
      <Tabs defaultValue="orders" className="space-y-6">
        <TabsList>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="shipments">Shipment Tracking</TabsTrigger>
        </TabsList>
        <TabsContent value="orders" className="space-y-6 mt-0">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Overseas PO</h1>
          <p className="page-description">{filteredOrders.length} order{filteredOrders.length !== 1 ? "s" : ""}{filteredOrders.length !== orders.length ? ` (filtered from ${orders.length})` : ""} • Stock added when marked received</p>
        </div>
        <div className="toolbar-actions">
          {isAdmin && selectedIds.size > 0 && (
            <>
              <BulkEditDialog
                selectedIds={Array.from(selectedIds)}
                entityLabel="overseas POs"
                fields={[
                  { key: "status", label: "Status", type: "select", options: [
                    { value: "unpaid", label: "Unpaid" },
                    { value: "paid_not_shipped", label: "Paid, Not Shipped" },
                    { value: "shipped_not_paid", label: "Shipped, Not Paid (Terms)" },
                    { value: "shipped", label: "Shipped" },
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
          {isAdmin && (
            <ExportButton
              data={orders}
              columns={{
                "PO #": (r: any) => r.po_number,
                "Order Date": (r: any) => r.order_date,
                "Supplier": (r: any) => r.overseas_suppliers?.name || "",
                "Status": (r: any) => r.status,
                "Currency": (r: any) => r.currency,
                "Exchange Rate": (r: any) => r.exchange_rate,
                "Expected Delivery": (r: any) => r.expected_delivery || "",
                "PO Total": (r: any) => r.total_amount,
                "Notes": (r: any) => r.notes || "",
              }}
              childItems={{
                table: "overseas_purchase_order_items",
                foreignKey: "po_id",
                select: "*, items(name, sku)",
                columns: {
                  "Item Name": (li: any) => li.item_name || li.items?.name || "",
                  "SKU": (li: any) => li.items?.sku || "",
                  "Description": (li: any) => li.description || "",
                  "Quantity": (li: any) => Number(li.quantity || 0),
                  "Received": (li: any) => Number(li.received_quantity || 0),
                  "Received Date": (li: any) => li.received_date || "",
                  "Unit Cost": (li: any) => Number(li.unit_cost || 0),
                  "Line Total": (li: any) => Number(li.quantity || 0) * Number(li.unit_cost || 0),
                },
              }}
              dateField={(r: any) => r.order_date || ""}
              fileName="Overseas_POs"
            />
          )}
          {isAdmin && (
            <Button variant="outline" onClick={() => setBulkUploadOpen(true)} className="rounded-lg h-9 px-4 text-sm font-medium">
              <Upload className="h-4 w-4 mr-1.5" /> Bulk Upload
            </Button>
          )}
          {isAdmin && (
            <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
              <Plus className="h-4 w-4 mr-1.5" /> New Overseas PO
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search overseas POs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="inline-flex rounded-lg border bg-card p-0.5">
          {([
            { key: "all", label: `All (${orders.length})` },
            { key: "not_shipped", label: `Not Shipped (${bucketCounts.not_shipped})` },
            { key: "incoming", label: `Incoming (${bucketCounts.incoming})` },
            { key: "received", label: `Received (${bucketCounts.received})` },
          ] as const).map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={() => setStatusFilter(b.key as any)}
              className={`px-3 h-8 text-xs font-medium rounded-md transition-colors ${
                statusFilter === b.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {b.label}
            </button>
          ))}
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
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="paid_not_shipped">Paid, Not Shipped</SelectItem>
                    <SelectItem value="shipped_not_paid">Shipped, Not Paid (Terms)</SelectItem>
                    <SelectItem value="shipped">Shipped</SelectItem>
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
                   <div key={idx} className="space-y-1 border rounded-md p-2 sm:border-0 sm:p-0">
                     <div className="grid grid-cols-1 sm:grid-cols-[1fr_60px_100px_32px] gap-2 sm:items-end">
                       <div className="space-y-1">
                         {idx === 0 && <Label className="text-[10px] text-muted-foreground hidden sm:block">Item (search by SKU)</Label>}
                         <ItemSearch
                           items={inventoryItems}
                           value={line.item_id}
                            onChange={(itemId, item) => {
                              const rmb = Number((item as any)?.cost_price_rmb || 0);
                              const autoCost = currency === "RMB" && rmb > 0 ? rmb : undefined;
                              setLines(lines.map((l, i) => i === idx ? { ...l, item_id: itemId, item_name: item.name, ...(autoCost !== undefined && (!l.unit_cost || Number(l.unit_cost) === 0) ? { unit_cost: autoCost } : {}) } : l));
                            }}
                           placeholder="Search SKU or name..."
                         />
                       </div>
                       <div className="grid grid-cols-[1fr_1fr_32px] gap-2 sm:contents">
                         <div className="space-y-1">
                           {idx === 0 && <Label className="text-[10px] text-muted-foreground hidden sm:block">Qty</Label>}
                           <Input type="number" value={line.quantity} placeholder="Qty" onChange={e => updateLine(idx, "quantity", e.target.value === "" ? "" : (parseInt(e.target.value) || 0))} className="h-8 text-sm" />
                         </div>
                         <div className="space-y-1">
                           {idx === 0 && <Label className="text-[10px] text-muted-foreground hidden sm:block">Unit Cost ({currencySymbol})</Label>}
                           <Input type="number" value={line.unit_cost} placeholder={`Cost (${currencySymbol})`} onChange={e => updateLine(idx, "unit_cost", e.target.value === "" ? "" : (parseFloat(e.target.value) || 0))} className="h-8 text-sm" />
                         </div>
                         <Button variant="ghost" size="icon" onClick={() => removeLine(idx)} className="h-8 w-8 self-end" disabled={lines.length === 1}>
                           <X className="h-3.5 w-3.5 text-muted-foreground" />
                         </Button>
                       </div>
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
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-lg">PO {viewPO?.po_number}</DialogTitle></DialogHeader>
          {viewPO && (
            <div className="space-y-5 pt-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Supplier:</span> <span className="font-medium">{viewPO.overseas_suppliers?.name || "—"}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={viewPO.status} context="overseas_po" /></div>
                {isAdmin && <div><span className="text-muted-foreground">Currency:</span> {viewPO.currency}</div>}
                {isAdmin && <div><span className="text-muted-foreground">Rate:</span> {viewPO.exchange_rate}</div>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Products</p>
                  <p className="mt-1 text-2xl font-semibold">{viewItems.length}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Ordered Qty</p>
                  <p className="mt-1 text-2xl font-semibold">{viewItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Received Qty</p>
                  <p className="mt-1 text-2xl font-semibold">{viewItems.reduce((sum, item) => sum + Number(item.received_quantity || 0), 0)}</p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Remaining Qty</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {viewItems.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0) - Number(item.received_quantity || 0)), 0)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border bg-card">
                <div className="border-b px-4 py-3">
                  <h3 className="text-sm font-semibold">Ordered Products Breakdown</h3>
                  <p className="text-xs text-muted-foreground">Per-product quantities, receiving progress, and value.</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">SKU</TableHead>
                      <TableHead className="text-xs">Product</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-xs text-right">Ordered</TableHead>
                      <TableHead className="text-xs text-right">Received</TableHead>
                      <TableHead className="text-xs text-right">Remaining</TableHead>
                      <TableHead className="text-xs">Date Received</TableHead>
                      {isAdmin && <TableHead className="text-xs text-right">Unit ({viewPO.currency})</TableHead>}
                      {isAdmin && <TableHead className="text-xs text-right">Line Total</TableHead>}
                      {isAdmin && <TableHead className="text-xs text-right">PHP Value</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewItems.map(item => {
                      const orderedQty = Number(item.quantity || 0);
                      const receivedQty = item.item_id ? Number(item.received_quantity || 0) : 0;
                      const remainingQty = item.item_id ? Math.max(0, orderedQty - receivedQty) : orderedQty;
                      const lineTotal = orderedQty * Number(item.unit_cost || 0);

                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs font-medium text-primary">{item.items?.sku || "—"}</TableCell>
                          <TableCell className="text-sm font-medium">{item.item_name}</TableCell>
                          <TableCell className="max-w-[220px] text-sm text-muted-foreground">{item.description || "—"}</TableCell>
                          <TableCell className="text-sm text-right">{orderedQty}</TableCell>
                          <TableCell className="text-sm text-right">{item.item_id ? receivedQty : "—"}</TableCell>
                          <TableCell className="text-sm text-right font-medium">{remainingQty}</TableCell>
                          <TableCell className="text-sm">{item.received_date ? new Date(item.received_date).toLocaleDateString("en-US") : "—"}</TableCell>
                          {isAdmin && <TableCell className="text-sm text-right">{Number(item.unit_cost || 0).toLocaleString("en", { minimumFractionDigits: 2 })}</TableCell>}
                          {isAdmin && (
                            <TableCell className="text-sm text-right font-medium">
                              {viewPO.currency === "USD" ? "$" : "¥"}{lineTotal.toLocaleString("en", { minimumFractionDigits: 2 })}
                            </TableCell>
                          )}
                          {isAdmin && <TableCell className="text-sm text-right">{peso(lineTotal * Number(viewPO.exchange_rate || 1))}</TableCell>}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

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
      <Dialog open={!!receiveOpen} onOpenChange={() => { setReceiveOpen(null); setReceiveQtys({}); setReceiveLocations({}); setReceiveDate(new Date().toISOString().split("T")[0]); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle className="text-lg">Receive Items</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Date Received</Label>
            <DateField value={receiveDate} onChange={setReceiveDate} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Enter the quantity that just arrived and choose where to store it.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next: Record<string, number> = {};
                receiveItems.forEach((pi: any) => {
                  const remaining = Math.max(0, pi.quantity - (pi.received_quantity || 0));
                  if (remaining > 0) next[pi.id] = remaining;
                });
                setReceiveQtys(next);
              }}
              className="h-7 text-xs"
            >
              Fill Remaining
            </Button>
          </div>
          <div className="space-y-3 pt-2 max-h-[60vh] overflow-y-auto">
            {receiveItems.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No line items on this PO.</p>
            )}
            {receiveItems.map((pi: any) => {
              const remaining = pi.quantity - (pi.received_quantity || 0);
              const isCustom = !pi.item_id;
              const isFull = remaining <= 0;
              const location = receiveLocations[pi.id] || "warehouse";
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
                  <Select
                    value={location}
                    onValueChange={(v) => setReceiveLocations({ ...receiveLocations, [pi.id]: v as "warehouse" | "store" })}
                    disabled={isCustom || isFull}
                  >
                    <SelectTrigger className="w-32 h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="warehouse">Warehouse</SelectItem>
                      <SelectItem value="store">Store</SelectItem>
                    </SelectContent>
                  </Select>
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

      {isAdmin && (
        <div className="rounded-lg border bg-card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Not Yet Received</p>
            <p className="text-xs text-muted-foreground mt-0.5">Value of outstanding items across all overseas POs (PHP equivalent)</p>
          </div>
          <p className="text-2xl font-semibold text-primary font-mono">{peso(notReceivedPhpTotal)}</p>
        </div>
      )}

      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin && <TableHead className="w-10"><Checkbox checked={filteredOrders.length > 0 && filteredOrders.every((o) => selectedIds.has(o.id))} onCheckedChange={toggleAll} /></TableHead>}
              <SortableHeader sortKey="po_number" label="PO #" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="supplier" label="Supplier" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="status" label="Status" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="eta" label="ETA" sort={sort} onToggle={toggle} />
              <TableHead className="text-xs">Items</TableHead>
              {isAdmin && <SortableHeader sortKey="currency" label="Currency" sort={sort} onToggle={toggle} />}
              {isAdmin && <SortableHeader sortKey="total_amount" label="Amount" sort={sort} onToggle={toggle} align="right" />}
              {isAdmin && <SortableHeader sortKey="php_total" label="PHP Equiv." sort={sort} onToggle={toggle} align="right" />}
              <TableHead className="text-xs text-right w-28">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="h-32 text-center"><div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></TableCell></TableRow>
            ) : sortedOrders.length === 0 ? (
              <TableRow><TableCell colSpan={10}><div className="empty-state"><ShoppingCart className="empty-state-icon" /><p className="text-sm">No overseas purchase orders yet</p></div></TableCell></TableRow>
            ) : sortedOrders.map(po => {
              const shipment = shipmentByPo.get(po.id);
              const eta = shipment?.estimated_arrival || po.expected_delivery;
              const actualArrival = shipment?.actual_arrival;
              const poItems = itemsByPo.get(po.id) || [];
              const totalItems = poItems.length;
              const fullyReceived = poItems.filter((i) => (i.received_quantity || 0) >= i.quantity).length;
              const partialItems = poItems.filter((i) => (i.received_quantity || 0) > 0 && (i.received_quantity || 0) < i.quantity).length;
              const totalOrderedQty = poItems.reduce((s, i) => s + (i.quantity || 0), 0);
              const totalReceivedQty = poItems.reduce((s, i) => s + (i.received_quantity || 0), 0);
              return (
              <TableRow key={po.id} className={selectedIds.has(po.id) ? "bg-muted/40" : "hover:bg-muted/30"}>
                {isAdmin && <TableCell><Checkbox checked={selectedIds.has(po.id)} onCheckedChange={() => toggleOne(po.id)} /></TableCell>}
                <TableCell className="font-medium text-sm font-mono">{po.po_number}</TableCell>
                <TableCell className="text-sm">{po.overseas_suppliers?.name || "—"}</TableCell>
                <TableCell><StatusBadge status={po.status} context="overseas_po" /></TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {actualArrival ? (
                    <span className="text-success font-medium">✓ {new Date(actualArrival).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  ) : eta ? (
                    <span>{new Date(eta).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {totalItems === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium">
                        {fullyReceived}/{totalItems} items
                        {partialItems > 0 && <span className="text-warning"> · {partialItems} partial</span>}
                      </span>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {totalReceivedQty}/{totalOrderedQty} qty
                      </span>
                    </div>
                  )}
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-sm">
                    <span className="inline-flex items-center rounded-md bg-accent px-2 py-0.5 text-xs font-medium">
                      {po.currency === "USD" ? "$ USD" : "¥ RMB"}
                    </span>
                  </TableCell>
                )}
                {isAdmin && (
                  <TableCell className="text-sm text-right font-mono">
                    {po.currency === "USD" ? "$" : "¥"}{po.total_amount.toLocaleString("en", { minimumFractionDigits: 2 })}
                  </TableCell>
                )}
                {isAdmin && (
                  <TableCell className="text-sm text-right font-mono text-primary">
                    {peso(po.total_amount * po.exchange_rate)}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-0.5">
                    {isAdmin && <Button variant="ghost" size="icon" onClick={() => openPreview(po)} title="Preview & Download PDF" className="h-7 w-7 rounded-md"><FileDown className="h-3.5 w-3.5 text-primary" /></Button>}
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
                    {isAdmin && <Button variant="ghost" size="icon" onClick={() => openEdit(po)} className="h-7 w-7 rounded-md"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>}
                    {isAdmin && <Button variant="ghost" size="icon" onClick={() => deleteMut.mutate(po.id)} className="h-7 w-7 rounded-md"><Trash2 className="h-3.5 w-3.5 text-destructive/70" /></Button>}
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Incoming Stocks</h2>
            <p className="text-sm text-muted-foreground">
              {filteredIncomingRows.length} item{filteredIncomingRows.length !== 1 ? "s" : ""}
              {filteredIncomingRows.length !== incomingRows.length ? ` (filtered from ${incomingRows.length})` : ""}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_180px] xl:items-end">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search ordered products..."
                value={incomingSearch}
                onChange={(e) => setIncomingSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Supplier</Label>
              <Select value={incomingSupplierFilter} onValueChange={setIncomingSupplierFilter}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="All suppliers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All suppliers</SelectItem>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.name}>{supplier.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Receiving Status</Label>
              <Select value={incomingReceiptFilter} onValueChange={setIncomingReceiptFilter}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incoming">Still incoming</SelectItem>
                  <SelectItem value="all">All ordered items</SelectItem>
                  <SelectItem value="partial">Partially received</SelectItem>
                  <SelectItem value="unreceived">Not yet received</SelectItem>
                  <SelectItem value="received">Fully received</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Ordered Qty</p>
            <p className="mt-1 text-2xl font-semibold">
              {filteredIncomingRows.reduce((sum, row) => sum + row.ordered_quantity, 0)}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Received Qty</p>
            <p className="mt-1 text-2xl font-semibold">
              {filteredIncomingRows.reduce((sum, row) => sum + row.received_quantity, 0)}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Remaining Qty</p>
            <p className="mt-1 text-2xl font-semibold">
              {filteredIncomingRows.reduce((sum, row) => sum + row.remaining_quantity, 0)}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">PHP Value</p>
            <p className="mt-1 text-2xl font-semibold text-primary">
              {peso(filteredIncomingRows.reduce((sum, row) => sum + row.php_value, 0))}
            </p>
          </div>
        </div>

        <div className="data-table-wrapper">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader sortKey="po_number" label="PO #" sort={incomingSort} onToggle={toggleIncomingSort} />
                <SortableHeader sortKey="supplier" label="Supplier" sort={incomingSort} onToggle={toggleIncomingSort} />
                <SortableHeader sortKey="product" label="Product" sort={incomingSort} onToggle={toggleIncomingSort} />
                <SortableHeader sortKey="sku" label="SKU" sort={incomingSort} onToggle={toggleIncomingSort} />
                <SortableHeader sortKey="ordered" label="Ordered" sort={incomingSort} onToggle={toggleIncomingSort} align="right" />
                <SortableHeader sortKey="received" label="Received" sort={incomingSort} onToggle={toggleIncomingSort} align="right" />
                <SortableHeader sortKey="remaining" label="Remaining" sort={incomingSort} onToggle={toggleIncomingSort} align="right" />
                <SortableHeader sortKey="unit_cost" label="Unit Cost" sort={incomingSort} onToggle={toggleIncomingSort} align="right" />
                <SortableHeader sortKey="php_value" label="PHP Value" sort={incomingSort} onToggle={toggleIncomingSort} align="right" />
                <SortableHeader sortKey="expected_delivery" label="ETA" sort={incomingSort} onToggle={toggleIncomingSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedIncomingRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10}>
                    <div className="empty-state">
                      <ShoppingCart className="empty-state-icon" />
                      <p className="text-sm">No ordered products match your filters</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : sortedIncomingRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm font-mono font-medium">{row.po_number}</TableCell>
                  <TableCell className="text-sm">{row.supplier_name}</TableCell>
                  <TableCell>
                    <div className="min-w-[180px]">
                      <p className="text-sm font-medium">{row.item_name}</p>
                      <p className="text-xs text-muted-foreground">{row.description || "—"}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm font-mono">{row.sku || "—"}</TableCell>
                  <TableCell className="text-sm text-right">{row.ordered_quantity}</TableCell>
                  <TableCell className="text-sm text-right">{row.received_quantity}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{row.remaining_quantity}</TableCell>
                  <TableCell className="text-sm text-right font-mono">
                    {row.currency === "USD" ? "$" : "¥"}{row.unit_cost.toLocaleString("en", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono text-primary">{peso(row.php_value)}</TableCell>
                  <TableCell className="text-sm">{row.expected_delivery ? new Date(row.expected_delivery).toLocaleDateString("en-US") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <DocumentPreview open={previewOpen} onClose={() => setPreviewOpen(false)} data={previewData} />
        </TabsContent>
        <TabsContent value="shipments" className="mt-0">
          <ShipmentTrackingPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
