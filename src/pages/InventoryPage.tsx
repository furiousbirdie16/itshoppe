import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getItems, getArchivedItems, createItem, updateItem, deleteItem, archiveItems, unarchiveItems, getSuppliers, setBranchQuantities } from "@/lib/api";
import { peso } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Search, Package, Upload, Layers, ArrowLeftRight, ClipboardEdit, History, DollarSign, Truck, Filter, X, Archive, ArchiveRestore } from "lucide-react";
import ItemHistoryDialog from "@/components/ItemHistoryDialog";
import ItemSuppliersDialog from "@/components/ItemSuppliersDialog";
import CostHistoryDialog from "@/components/CostHistoryDialog";
import { VariationsManager } from "@/components/VariationsManager";
import TransferStockDialog from "@/components/TransferStockDialog";
import AdjustStockDialog from "@/components/AdjustStockDialog";
import ExportButton from "@/components/ExportButton";
import { toast } from "sonner";
import type { Item } from "@/types/database";
import BulkUploadDialog from "@/components/BulkUploadDialog";
import BulkEditUploadDialog from "@/components/BulkEditUploadDialog";
import { useAuth } from "@/contexts/AuthContext";
import { BulkEditDialog, type BulkField } from "@/components/BulkEditDialog";
import { useSort } from "@/hooks/use-sort";
import { SortableHeader } from "@/components/SortableHeader";
import { supabase } from "@/integrations/supabase/client";
import { useColumnPrefs, ColumnVisibilityMenu, type ColumnDef } from "@/components/ColumnVisibility";
import { useBranch } from "@/contexts/BranchContext";
import { HorizontalScrollSync } from "@/components/HorizontalScrollSync";

const INVENTORY_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", required: true },
  { key: "source", label: "Source", defaultVisible: true },
  { key: "branch", label: "Branch", defaultVisible: true },
  { key: "quantity", label: "Available", defaultVisible: true },
  { key: "reserved_quantity", label: "Reserved", defaultVisible: true },
  { key: "incoming_quantity", label: "Incoming", defaultVisible: true },
  { key: "warehouse_quantity", label: "Warehouse", defaultVisible: false },
  { key: "store_quantity", label: "Store", defaultVisible: false },
  { key: "cost_price", label: "Cost", defaultVisible: true },
  { key: "selling_price", label: "Sell", defaultVisible: true },
  { key: "low_stock_threshold", label: "Threshold", defaultVisible: true },
];

type StockStatusFilter = "all" | "in_stock" | "low_stock" | "out_of_stock" | "overstocked";
type QtyOp = "any" | "eq" | "gt" | "lt" | "range";
type LocationFilter = "any" | "warehouse" | "store";
type ProductStatusFilter = "any" | "active" | "inactive" | "discontinued";

interface FilterState {
  search: string;
  stockStatus: StockStatusFilter;
  qtyOp: QtyOp;
  qtyValue: string;
  qtyMin: string;
  qtyMax: string;
  source: "all" | "local" | "import";
  category: string;
  supplierId: string;
  location: LocationFilter;
  productStatus: ProductStatusFilter;
}

const DEFAULT_FILTERS: FilterState = {
  search: "",
  stockStatus: "all",
  qtyOp: "any",
  qtyValue: "",
  qtyMin: "",
  qtyMax: "",
  source: "all",
  category: "all",
  supplierId: "all",
  location: "any",
  productStatus: "any",
};

const FILTER_STORAGE_KEY = "inventory:filters:v1";

export default function InventoryPage() {
  const { role, user } = useAuth();
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [viewArchived, setViewArchived] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [variationsItem, setVariationsItem] = useState<Item | null>(null);
  const [transferItem, setTransferItem] = useState<Item | null>(null);
  const [adjustItem, setAdjustItem] = useState<Item | null>(null);
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [costHistoryItem, setCostHistoryItem] = useState<Item | null>(null);
  const [suppliersItem, setSuppliersItem] = useState<Item | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [form, setForm] = useState({
    name: "", sku: "", description: "",
    warehouse_quantity: "0", store_quantity: "0",
    cost_price: "0", cost_price_rmb: "0", selling_price: "0",
    low_stock_threshold: "10", source: "local" as "local" | "import",
    category: "", brand: "", barcode: "", supplier_sku: "",
    status: "active" as "active" | "inactive" | "discontinued",
  });

  // Filters (persisted per-user localStorage)
  const [filters, setFilters] = useState<FilterState>(() => {
    try {
      const raw = localStorage.getItem(FILTER_STORAGE_KEY);
      if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return DEFAULT_FILTERS;
  });
  useEffect(() => {
    try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters)); } catch { /* ignore */ }
  }, [filters]);

  const setF = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    setFilters(prev => ({ ...prev, [key]: value }));

  const { activeBranchId, activeBranch } = useBranch();
  const { data: activeItems = [], isLoading: loadingActive } = useQuery({ queryKey: ["items"], queryFn: getItems });
  const { data: archivedItemsData = [], isLoading: loadingArchived } = useQuery({
    queryKey: ["items", "archived"],
    queryFn: getArchivedItems,
    enabled: viewArchived,
  });
  const rawItems = viewArchived ? archivedItemsData : activeItems;
  const isLoading = viewArchived ? loadingArchived : loadingActive;

  // Per-branch stock overlay — Phase 2: stock columns must come from item_branch_stock,
  // never from the legacy items.* stock fields. When activeBranchId is null (admin
  // "All branches"), sum across every branch the user can see.
  const { data: branchStockRows = [] } = useQuery({
    queryKey: ["item_branch_stock", activeBranchId ?? "ALL"],
    queryFn: async () => {
      let q = (supabase as any)
        .from("item_branch_stock")
        .select("item_id, branch_id, warehouse_quantity, store_quantity, quantity, open_roll_remaining, units_per_stock");
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const branchStockMap = useMemo(() => {
    const m = new Map<string, { wh: number; st: number; q: number; open: number; ups: number }>();
    for (const r of branchStockRows) {
      const prev = m.get(r.item_id);
      const wh = Number(r.warehouse_quantity || 0);
      const st = Number(r.store_quantity || 0);
      const q = Number(r.quantity || 0);
      const open = Number(r.open_roll_remaining || 0);
      const ups = Number(r.units_per_stock || 0);
      if (prev) {
        prev.wh += wh; prev.st += st; prev.q += q; prev.open += open;
        if (!prev.ups && ups) prev.ups = ups;
      } else {
        m.set(r.item_id, { wh, st, q, open, ups });
      }
    }
    return m;
  }, [branchStockRows]);

  // Reserved quantity — invoice line quantities on invoices currently in "reserved" status
  // for the active branch (or across all visible branches when admin picks "All").
  const { data: reservedRows = [] } = useQuery({
    queryKey: ["inventory_reserved", activeBranchId ?? "ALL"],
    queryFn: async () => {
      let q = (supabase as any)
        .from("invoice_items")
        .select("item_id, quantity, invoices!inner(status, branch_id)")
        .eq("invoices.status", "reserved");
      if (activeBranchId) q = q.eq("invoices.branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
  const reservedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reservedRows) {
      if (!r.item_id) continue;
      m.set(r.item_id, (m.get(r.item_id) || 0) + Number(r.quantity || 0));
    }
    return m;
  }, [reservedRows]);

  // Incoming quantity — outstanding (quantity - received_quantity) on open local + overseas POs
  // for the active branch.
  const { data: incomingRows = [] } = useQuery({
    queryKey: ["inventory_incoming", activeBranchId ?? "ALL"],
    queryFn: async () => {
      const buildLocal = () => {
        let q = (supabase as any)
          .from("purchase_order_items")
          .select("item_id, quantity, received_quantity, purchase_orders!inner(status, branch_id)")
          .not("purchase_orders.status", "in", "(received,cargo_adjusted,closed)");
        if (activeBranchId) q = q.eq("purchase_orders.branch_id", activeBranchId);
        return q;
      };
      const buildOverseas = () => {
        let q = (supabase as any)
          .from("overseas_purchase_order_items")
          .select("item_id, quantity, received_quantity, overseas_purchase_orders!inner(status, branch_id)")
          .not("overseas_purchase_orders.status", "in", "(received,cargo_adjusted,pending_cargo_adjustment)");
        if (activeBranchId) q = q.eq("overseas_purchase_orders.branch_id", activeBranchId);
        return q;
      };
      const [local, overseas] = await Promise.all([buildLocal(), buildOverseas()]);
      if (local.error) throw local.error;
      if (overseas.error) throw overseas.error;
      return [...((local.data as any[]) || []), ...((overseas.data as any[]) || [])];
    },
  });
  const incomingMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of incomingRows) {
      if (!r.item_id) continue;
      const remaining = Math.max(0, Number(r.quantity || 0) - Number(r.received_quantity || 0));
      if (remaining <= 0) continue;
      m.set(r.item_id, (m.get(r.item_id) || 0) + remaining);
    }
    return m;
  }, [incomingRows]);

  const branchLabel = activeBranch ? activeBranch.branch_code : "All";

  const items = useMemo(() => {
    return rawItems.map((it: any) => {
      const s = branchStockMap.get(it.id);
      return {
        ...it,
        warehouse_quantity: s ? s.wh : 0,
        store_quantity: s ? s.st : 0,
        quantity: s ? s.q : 0,
        open_roll_remaining: s ? s.open : 0,
        units_per_stock: s && s.ups ? s.ups : it.units_per_stock,
        reserved_quantity: reservedMap.get(it.id) || 0,
        incoming_quantity: incomingMap.get(it.id) || 0,
      };
    });
  }, [rawItems, branchStockMap, reservedMap, incomingMap]);

  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: getSuppliers });

  // For supplier filter: map item -> supplier IDs via item_suppliers (lazy: only when a supplier filter is active)
  const supplierFilterActive = filters.supplierId !== "all";
  const { data: itemSupplierMap = new Map<string, Set<string>>() } = useQuery({
    queryKey: ["item_suppliers_index"],
    enabled: supplierFilterActive,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("item_suppliers")
        .select("item_id, supplier_id, overseas_supplier_id");
      if (error) throw error;
      const m = new Map<string, Set<string>>();
      for (const r of (data || []) as any[]) {
        const sid = r.supplier_id || r.overseas_supplier_id;
        if (!sid) continue;
        if (!m.has(r.item_id)) m.set(r.item_id, new Set());
        m.get(r.item_id)!.add(sid);
      }
      return m;
    },
  });

  // Quantities live in item_branch_stock (per branch) — never on items.*
  const splitQty = (data: Partial<Item> & Record<string, any>) => {
    const rest = { ...data };
    const wh = rest.warehouse_quantity as number | undefined;
    const st = rest.store_quantity as number | undefined;
    delete rest.warehouse_quantity;
    delete rest.store_quantity;
    return { rest, wh, st };
  };

  const createMut = useMutation({
    mutationFn: async (data: Partial<Item>) => {
      const { rest, wh, st } = splitQty(data);
      const created = await createItem(rest);
      if ((wh || st) && activeBranchId) {
        await setBranchQuantities({ itemId: created.id, branchId: activeBranchId, warehouse: wh ?? 0, store: st ?? 0, notes: "Item created" });
      }
      return created;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["items"] }); queryClient.invalidateQueries({ queryKey: ["item_branch_stock"] }); setOpen(false); toast.success("Item created"); },
    onError: (e: any) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Item> }) => {
      const { rest, wh, st } = splitQty(data);
      const res = await updateItem(id, rest);
      if (wh !== undefined || st !== undefined) {
        if (!activeBranchId) throw new Error("Select a specific branch to edit quantities");
        await setBranchQuantities({ itemId: id, branchId: activeBranchId, warehouse: wh ?? null, store: st ?? null, notes: "Manual item edit" });
      }
      return res;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["items"] }); queryClient.invalidateQueries({ queryKey: ["item_branch_stock"] }); setOpen(false); setEditing(null); toast.success("Item updated"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteItem,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["items"] }); toast.success("Item deleted"); },
  });

  const archiveMut = useMutation({
    mutationFn: (ids: string[]) => archiveItems(ids, user?.email),
    onSuccess: (_d, ids) => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setSelectedIds(new Set());
      setArchiveConfirm(null);
      toast.success(`Archived ${ids.length} item${ids.length > 1 ? "s" : ""}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unarchiveMut = useMutation({
    mutationFn: (ids: string[]) => unarchiveItems(ids),
    onSuccess: (_d, ids) => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setSelectedIds(new Set());
      toast.success(`Restored ${ids.length} item${ids.length > 1 ? "s" : ""}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", sku: "", description: "", warehouse_quantity: "0", store_quantity: "0", cost_price: "0", cost_price_rmb: "0", selling_price: "0", low_stock_threshold: "10", source: "local", category: "", brand: "", barcode: "", supplier_sku: "", status: "active" });
    setOpen(true);
  };
  const openEdit = (item: Item) => {
    setEditing(item);
    setForm({
      name: item.name, sku: item.sku, description: item.description,
      warehouse_quantity: String((item as any).warehouse_quantity ?? 0),
      store_quantity: String((item as any).store_quantity ?? 0),
      cost_price: String(item.cost_price),
      cost_price_rmb: String((item as any).cost_price_rmb ?? 0),
      selling_price: String(item.selling_price),
      low_stock_threshold: String(item.low_stock_threshold),
      source: ((item.source as "local" | "import") || "local"),
      category: item.category || "",
      brand: item.brand || "",
      barcode: item.barcode || "",
      supplier_sku: item.supplier_sku || "",
      status: ((item.status as any) === "archived" ? "active" : (item.status as any) || "active"),
    });
    setOpen(true);
  };

  const canEditCost = isAdmin || form.source === "local";

  const handleSubmit = () => {
    const wh = parseInt(form.warehouse_quantity) || 0;
    const st = parseInt(form.store_quantity) || 0;
    const base: any = {
      name: form.name, sku: form.sku, description: form.description,
      selling_price: parseFloat(form.selling_price),
      warehouse_quantity: wh, store_quantity: st,
      category: form.category || null,
      brand: form.brand || null,
      barcode: form.barcode || null,
      supplier_sku: form.supplier_sku || null,
    };
    if (isAdmin) base.status = form.status;
    if (!editing) {
      base.low_stock_threshold = parseInt(form.low_stock_threshold);
      base.source = isAdmin ? form.source : "local";
      if (canEditCost) base.cost_price = parseFloat(form.cost_price);
      if (isAdmin) base.cost_price_rmb = parseFloat(form.cost_price_rmb) || 0;
      createMut.mutate(base);
    } else {
      if (isAdmin) base.source = form.source;
      if (canEditCost) base.cost_price = parseFloat(form.cost_price);
      if (isAdmin) {
        base.low_stock_threshold = parseInt(form.low_stock_threshold);
        base.cost_price_rmb = parseFloat(form.cost_price_rmb) || 0;
      }
      updateMut.mutate({ id: editing.id, data: base });
    }
  };

  // --- Filtering pipeline ---
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return items.filter(i => {
      const src = ((i as any).source as string) || "local";
      const qty = Number(i.quantity ?? 0);
      const threshold = Number(i.low_stock_threshold ?? 0);
      const status = (i.status as string) || "active";

      // Search across many fields
      if (q) {
        const hay = [
          i.name, i.sku, i.description,
          (i as any).barcode, (i as any).supplier_sku, (i as any).brand, (i as any).category,
        ].filter(Boolean).map(v => String(v).toLowerCase());
        if (!hay.some(h => h.includes(q))) return false;
      }

      // Stock status
      if (filters.stockStatus === "in_stock" && qty <= 0) return false;
      if (filters.stockStatus === "out_of_stock" && qty !== 0) return false;
      if (filters.stockStatus === "low_stock" && !(threshold > 0 && qty <= threshold && qty > 0)) return false;
      if (filters.stockStatus === "overstocked" && !(threshold > 0 && qty > threshold * 3)) return false;

      // Quantity op
      const n = Number(filters.qtyValue);
      const nMin = Number(filters.qtyMin);
      const nMax = Number(filters.qtyMax);
      if (filters.qtyOp === "eq" && filters.qtyValue !== "" && qty !== n) return false;
      if (filters.qtyOp === "gt" && filters.qtyValue !== "" && !(qty > n)) return false;
      if (filters.qtyOp === "lt" && filters.qtyValue !== "" && !(qty < n)) return false;
      if (filters.qtyOp === "range") {
        if (filters.qtyMin !== "" && qty < nMin) return false;
        if (filters.qtyMax !== "" && qty > nMax) return false;
      }

      // Source
      if (filters.source !== "all" && src !== filters.source) return false;

      // Category
      if (filters.category !== "all" && (i.category || "") !== filters.category) return false;

      // Product status (only for active view; archived view is separate)
      if (!viewArchived && filters.productStatus !== "any" && status !== filters.productStatus) return false;

      // Location (stock present in specific location)
      const wh = Number((i as any).warehouse_quantity ?? 0);
      const st = Number((i as any).store_quantity ?? 0);
      if (filters.location === "warehouse" && wh <= 0) return false;
      if (filters.location === "store" && st <= 0) return false;

      // Supplier
      if (supplierFilterActive) {
        const set = itemSupplierMap.get(i.id);
        if (!set || !set.has(filters.supplierId)) return false;
      }

      return true;
    });
  }, [items, filters, viewArchived, supplierFilterActive, itemSupplierMap]);

  // Category options from active items
  const categoryOptions = useMemo(() => {
    const s = new Set<string>();
    items.forEach(i => { if (i.category) s.add(i.category); });
    return Array.from(s).sort();
  }, [items]);

  const totalFilteredValue = useMemo(
    () => filtered.reduce((sum, i) => sum + (Number(i.quantity) * Number(i.cost_price || 0)), 0),
    [filtered]
  );

  const { sort, toggle, sorted: sortedFiltered } = useSort<typeof filtered[number]>(filtered, {
    name: (r) => r.name,
    sku: (r) => r.sku,
    source: (r: any) => (r.source as string) || "local",
    branch: () => branchLabel,
    quantity: (r) => Number(r.quantity),
    reserved_quantity: (r: any) => Number(r.reserved_quantity ?? 0),
    incoming_quantity: (r: any) => Number(r.incoming_quantity ?? 0),
    warehouse_quantity: (r: any) => Number(r.warehouse_quantity ?? 0),
    store_quantity: (r: any) => Number(r.store_quantity ?? 0),
    cost_price: (r) => Number(r.cost_price),
    selling_price: (r) => Number(r.selling_price),
    low_stock_threshold: (r) => Number(r.low_stock_threshold ?? 0),
  });

  const allSelected = filtered.length > 0 && filtered.every(i => selectedIds.has(i.id));
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(filtered.map(i => i.id)));
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const bulkDeleteMut = useMutation({
    mutationFn: async () => { for (const id of selectedIds) await deleteItem(id); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      const n = selectedIds.size;
      setSelectedIds(new Set());
      toast.success(`Deleted ${n} items`);
    },
  });

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  // Active filter chips
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.search) chips.push({ key: "search", label: `Search: "${filters.search}"`, clear: () => setF("search", "") });
  if (filters.stockStatus !== "all") chips.push({ key: "stock", label: `Stock: ${filters.stockStatus.replace("_", " ")}`, clear: () => setF("stockStatus", "all") });
  if (filters.qtyOp !== "any") {
    let lbl = "Qty: ";
    if (filters.qtyOp === "eq") lbl += `= ${filters.qtyValue}`;
    else if (filters.qtyOp === "gt") lbl += `> ${filters.qtyValue}`;
    else if (filters.qtyOp === "lt") lbl += `< ${filters.qtyValue}`;
    else if (filters.qtyOp === "range") lbl += `${filters.qtyMin || 0}–${filters.qtyMax || "∞"}`;
    chips.push({ key: "qty", label: lbl, clear: () => setFilters(f => ({ ...f, qtyOp: "any", qtyValue: "", qtyMin: "", qtyMax: "" })) });
  }
  if (filters.source !== "all") chips.push({ key: "source", label: `Source: ${filters.source}`, clear: () => setF("source", "all") });
  if (filters.category !== "all") chips.push({ key: "cat", label: `Category: ${filters.category}`, clear: () => setF("category", "all") });
  if (filters.supplierId !== "all") {
    const s = suppliers.find(s => s.id === filters.supplierId);
    chips.push({ key: "sup", label: `Supplier: ${s?.name || "…"}`, clear: () => setF("supplierId", "all") });
  }
  if (filters.location !== "any") chips.push({ key: "loc", label: `Location: ${filters.location}`, clear: () => setF("location", "any") });
  if (filters.productStatus !== "any") chips.push({ key: "ps", label: `Status: ${filters.productStatus}`, clear: () => setF("productStatus", "any") });

  const { state: colState, orderedColumns, visibleColumns, toggle: toggleCol, move: moveCol, reset: resetCols } = useColumnPrefs("inventory:columns:v1", INVENTORY_COLUMNS);
  const visibleColCount = 2 + visibleColumns.length;

  // --- Mobile card list: incremental (infinite scroll) rendering ---
  const MOBILE_PAGE = 20;
  const [mobileCount, setMobileCount] = useState(MOBILE_PAGE);
  useEffect(() => { setMobileCount(MOBILE_PAGE); }, [filters, viewArchived, sort.key, sort.dir, activeBranchId]);
  const mobileSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = mobileSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) {
        setMobileCount(c => (c < sortedFiltered.length ? c + MOBILE_PAGE : c));
      }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [sortedFiltered.length, mobileCount]);
  const mobileItems = sortedFiltered.slice(0, mobileCount);


  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <div className="page-header mb-0">
          <h1 className="page-title">Inventory</h1>
          <p className="page-description">
            {viewArchived ? `${items.length} archived` : `${items.length} items in stock`}
          </p>
        </div>
        <div className="toolbar-actions">
          <Button
            variant={viewArchived ? "default" : "outline"}
            onClick={() => { setViewArchived(v => !v); setSelectedIds(new Set()); }}
            className="rounded-lg h-9 px-4 text-sm font-medium"
            title="Toggle archived view"
          >
            {viewArchived ? <ArchiveRestore className="h-4 w-4 mr-1.5" /> : <Archive className="h-4 w-4 mr-1.5" />}
            {viewArchived ? "Viewing Archived" : "View Archived"}
          </Button>

          {selectedIds.size > 0 && !viewArchived && (() => {
            const selectedItems = items.filter(i => selectedIds.has(i.id));
            const allLocal = selectedItems.every(i => (((i as any).source as string) || 'local') === 'local');
            const canBulkEditCost = isAdmin || allLocal;
            return (
              <BulkEditDialog
                selectedIds={Array.from(selectedIds)}
                entityLabel="items"
                fields={([
                  { key: "name", label: "Name", type: "text" },
                  { key: "sku", label: "SKU", type: "text" },
                  { key: "description", label: "Description", type: "textarea" },
                  { key: "category", label: "Category", type: "text" },
                  { key: "brand", label: "Brand", type: "text" },
                  { key: "barcode", label: "Barcode", type: "text" },
                  { key: "supplier_sku", label: "Supplier SKU", type: "text" },
                  ...(isAdmin ? [
                    { key: "source", label: "Source (Local / Import)", type: "select", options: [{ value: "local", label: "Local" }, { value: "import", label: "Import" }] },
                    { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "discontinued", label: "Discontinued" }] },
                  ] : []),
                  { key: "base_unit", label: "Base Unit (e.g. pcs, m, kg)", type: "text" },
                  { key: "units_per_stock", label: "Units Per Stock", type: "number", transform: (v) => parseFloat(v) || 1 },
                  { key: "open_roll_remaining", label: "Open Roll Remaining", type: "number", transform: (v) => parseFloat(v) || 0 },
                  ...(isAdmin ? [
                    { key: "warehouse_quantity", label: "Warehouse Quantity", type: "number", transform: (v) => parseInt(v) || 0 },
                    { key: "store_quantity", label: "Store Quantity", type: "number", transform: (v) => parseInt(v) || 0 },
                  ] : []),
                  ...(canBulkEditCost ? [
                    { key: "cost_price", label: "Cost Price", type: "number", transform: (v) => parseFloat(v) || 0 },
                  ] : []),
                  { key: "selling_price", label: "Selling Price", type: "number", transform: (v) => parseFloat(v) || 0 },
                  ...(isAdmin ? [
                    { key: "low_stock_threshold", label: "Low Stock Threshold", type: "number", transform: (v) => parseInt(v) || 0 },
                  ] : []),
                ]) as BulkField[]}
                updateOne={async (id, patch) => {
                  const { rest, wh, st } = splitQty(patch as any);
                  if (Object.keys(rest).length > 0) await updateItem(id, rest as Partial<Item>);
                  if (wh !== undefined || st !== undefined) {
                    if (!activeBranchId) throw new Error("Select a specific branch to edit quantities");
                    await setBranchQuantities({ itemId: id, branchId: activeBranchId, warehouse: wh ?? null, store: st ?? null, notes: "Bulk edit" });
                  }
                }}
                onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["items"] }); queryClient.invalidateQueries({ queryKey: ["item_branch_stock"] }); setSelectedIds(new Set()); }}
              />
            );
          })()}

          {selectedIds.size > 0 && !viewArchived && (
            <Button variant="outline" onClick={() => setArchiveConfirm({ ids: Array.from(selectedIds), label: `${selectedIds.size} selected item${selectedIds.size > 1 ? "s" : ""}` })} className="rounded-lg h-9 px-4 text-sm font-medium">
              <Archive className="h-4 w-4 mr-1.5" /> Archive {selectedIds.size}
            </Button>
          )}
          {selectedIds.size > 0 && viewArchived && isAdmin && (
            <Button variant="outline" onClick={() => unarchiveMut.mutate(Array.from(selectedIds))} className="rounded-lg h-9 px-4 text-sm font-medium">
              <ArchiveRestore className="h-4 w-4 mr-1.5" /> Restore {selectedIds.size}
            </Button>
          )}
          {selectedIds.size > 0 && isAdmin && (
            <Button variant="destructive" onClick={() => bulkDeleteMut.mutate()} disabled={bulkDeleteMut.isPending} className="rounded-lg h-9 px-4 text-sm font-medium">
              <Trash2 className="h-4 w-4 mr-1.5" /> Delete {selectedIds.size}
            </Button>
          )}

          <ExportButton
            data={items}
            columns={{
              "Name": (r: any) => r.name,
              "SKU": (r: any) => r.sku,
              "Source": (r: any) => r.source || "local",
              "Category": (r: any) => r.category || "",
              "Brand": (r: any) => r.brand || "",
              "Barcode": (r: any) => r.barcode || "",
              "Supplier SKU": (r: any) => r.supplier_sku || "",
              "Status": (r: any) => r.status || "active",
              "Description": (r: any) => r.description || "",
              "Base Unit": (r: any) => r.base_unit || "",
              "Units Per Stock": (r: any) => r.units_per_stock || 1,
              "Open Roll Remaining": (r: any) => r.open_roll_remaining || 0,
              "Quantity": (r: any) => r.quantity,
              "Warehouse Qty": (r: any) => r.warehouse_quantity ?? 0,
              "Store Qty": (r: any) => r.store_quantity ?? 0,
              "Low Stock Threshold": (r: any) => r.low_stock_threshold ?? "",
              ...(isAdmin
                ? { "Cost Price": (r: any) => r.cost_price }
                : { "Cost Price": (r: any) => ((r.source ?? "local") === "local" ? r.cost_price : "") }),
              "Selling Price": (r: any) => r.selling_price,
              "Archived At": (r: any) => r.archived_at || "",
              "Archived By": (r: any) => r.archived_by_email || "",
              "Created": (r: any) => r.created_at || "",
              "Updated": (r: any) => r.updated_at || "",
            }}
            childItems={{
              table: "item_variations",
              foreignKey: "item_id",
              select: "*",
              columns: {
                "Variation Name": (v: any) => v.name || "",
                "Variation SKU": (v: any) => v.sku || "",
                "Variation Type": (v: any) => v.type || "",
                "Variation Factor": (v: any) => Number(v.factor || 1),
                "Variation Unit": (v: any, p: any) =>
                  v.type === "cut" ? (p.base_unit || "m") : "pack",
                "Variation Stock Available": (v: any, p: any) => {
                  const factor = Number(v.factor || 1) || 1;
                  const ups = Number(p.units_per_stock || 1) || 1;
                  const qty = Number(p.quantity || 0);
                  const open = Number(p.open_roll_remaining || 0);
                  const totalBase = v.type === "cut" ? qty * ups + open : qty * ups;
                  return Math.floor(totalBase / factor);
                },
                "Variation Selling Price": (v: any) => Number(v.selling_price || 0),
              },
            }}
            dateField={(r: any) => r.created_at?.split("T")[0] || ""}
            fileName={viewArchived ? "Inventory-Archived" : "Inventory"}
          />
          <Button variant="outline" onClick={() => setBulkOpen(true)} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Upload className="h-4 w-4 mr-1.5" /> Bulk Upload
          </Button>
          <Button variant="outline" onClick={() => setBulkEditOpen(true)} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Pencil className="h-4 w-4 mr-1.5" /> Bulk Edit
          </Button>
          <ColumnVisibilityMenu columns={orderedColumns} visible={colState.visible} onToggle={toggleCol} onMove={moveCol} onReset={resetCols} />
          <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-medium">
            <Plus className="h-4 w-4 mr-1.5" /> Add Item
          </Button>
        </div>
      </div>

      {/* Search + filter trigger */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search name, SKU, barcode, supplier SKU, brand, description…"
            value={filters.search}
            onChange={e => setF("search", e.target.value)}
            className="pl-9 h-9 rounded-lg text-sm"
          />
        </div>
        <Sheet open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="h-9 rounded-lg text-sm">
              <Filter className="h-4 w-4 mr-1.5" /> Filters
              {chips.length > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 min-w-5 px-1.5">{chips.length}</Badge>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filter Inventory</SheetTitle>
            </SheetHeader>
            <div className="space-y-5 py-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Stock Status</Label>
                <Select value={filters.stockStatus} onValueChange={v => setF("stockStatus", v as StockStatusFilter)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Products</SelectItem>
                    <SelectItem value="in_stock">In Stock</SelectItem>
                    <SelectItem value="low_stock">Low Stock</SelectItem>
                    <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                    <SelectItem value="overstocked">Overstocked (&gt; 3× threshold)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Quantity</Label>
                <div className="flex gap-2">
                  <Select value={filters.qtyOp} onValueChange={v => setF("qtyOp", v as QtyOp)}>
                    <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="eq">= Exactly</SelectItem>
                      <SelectItem value="gt">&gt; Greater than</SelectItem>
                      <SelectItem value="lt">&lt; Less than</SelectItem>
                      <SelectItem value="range">Range</SelectItem>
                    </SelectContent>
                  </Select>
                  {filters.qtyOp === "range" ? (
                    <div className="flex gap-1 flex-1">
                      <Input type="number" placeholder="Min" value={filters.qtyMin} onChange={e => setF("qtyMin", e.target.value)} className="h-9" />
                      <Input type="number" placeholder="Max" value={filters.qtyMax} onChange={e => setF("qtyMax", e.target.value)} className="h-9" />
                    </div>
                  ) : filters.qtyOp !== "any" ? (
                    <Input type="number" placeholder="Qty" value={filters.qtyValue} onChange={e => setF("qtyValue", e.target.value)} className="h-9 flex-1" />
                  ) : null}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Source</Label>
                <Select value={filters.source} onValueChange={v => setF("source", v as any)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Both</SelectItem>
                    <SelectItem value="local">Local</SelectItem>
                    <SelectItem value="import">Import</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Category</Label>
                <Select value={filters.category} onValueChange={v => setF("category", v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categoryOptions.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categoryOptions.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">No categories yet. Assign one when creating/editing an item.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Supplier</Label>
                <Select value={filters.supplierId} onValueChange={v => setF("supplierId", v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="All Suppliers" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Suppliers</SelectItem>
                    {suppliers.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Warehouse / Branch</Label>
                <Select value={filters.location} onValueChange={v => setF("location", v as LocationFilter)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any Location</SelectItem>
                    <SelectItem value="warehouse">Warehouse (has stock)</SelectItem>
                    <SelectItem value="store">Store (has stock)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!viewArchived && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Product Status</Label>
                  <Select value={filters.productStatus} onValueChange={v => setF("productStatus", v as ProductStatusFilter)}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="discontinued">Discontinued</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">Archived items are in a separate view.</p>
                </div>
              )}
            </div>
            <SheetFooter className="flex-row justify-between gap-2">
              <Button variant="ghost" onClick={resetFilters}>Clear All</Button>
              <Button onClick={() => setFilterDrawerOpen(false)}>Apply</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
        {chips.length > 0 && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 text-xs">
            <X className="h-3 w-3 mr-1" /> Clear all
          </Button>
        )}
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map(c => (
            <Badge key={c.key} variant="secondary" className="gap-1 pl-2 pr-1 py-1 text-xs">
              {c.label}
              <button onClick={c.clear} className="hover:bg-background rounded-sm p-0.5">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Result summary */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {items.length} {viewArchived ? "archived " : ""}products
        </span>
        {isAdmin && (
          <span>
            Total value: <span className="font-semibold text-foreground">{peso(totalFilteredValue)}</span>
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">{editing ? "Edit Item" : "New Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">SKU</Label>
                <Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Category</Label>
                <Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="h-9" list="inv-cat-list" placeholder="e.g. CCTV, Networking" />
                <datalist id="inv-cat-list">
                  {categoryOptions.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Brand</Label>
                <Input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Barcode</Label>
                <Input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Supplier SKU</Label>
                <Input value={form.supplier_sku} onChange={e => setForm({ ...form, supplier_sku: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Description</Label>
                <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="resize-none" rows={2} />
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Source</Label>
                  <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v as "local" | "import" })} disabled={!isAdmin}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="local">Local</SelectItem>
                      <SelectItem value="import">Import</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {isAdmin && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Product Status</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="discontinued">Discontinued</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{editing ? "Warehouse Qty (Manual Adjust)" : "Initial Warehouse Qty"}</Label>
                <Input type="number" min={0} value={form.warehouse_quantity} onChange={e => setForm({ ...form, warehouse_quantity: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{editing ? "Store Qty (Manual Adjust)" : "Initial Store Qty"}</Label>
                <Input type="number" min={0} value={form.store_quantity} onChange={e => setForm({ ...form, store_quantity: e.target.value })} className="h-9" />
              </div>
            </div>
            <div className={`grid ${isAdmin ? 'grid-cols-4' : (canEditCost ? 'grid-cols-2' : 'grid-cols-1')} gap-3`}>
              {canEditCost && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Cost Price</Label>
                  <Input type="number" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} className="h-9" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Selling Price</Label>
                <Input type="number" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} className="h-9" />
              </div>
              {isAdmin && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Cost Price (RMB ¥)</Label>
                  <Input type="number" value={form.cost_price_rmb} onChange={e => setForm({ ...form, cost_price_rmb: e.target.value })} className="h-9" placeholder="0.00" />
                </div>
              )}
              {isAdmin && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Low Stock Alert</Label>
                  <Input type="number" value={form.low_stock_threshold} onChange={e => setForm({ ...form, low_stock_threshold: e.target.value })} className="h-9" />
                </div>
              )}
            </div>
            <Button onClick={handleSubmit} disabled={createMut.isPending || updateMut.isPending} className="mt-2 rounded-lg h-9">
              {editing ? "Update Item" : "Create Item"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation */}
      <Dialog open={!!archiveConfirm} onOpenChange={(o) => { if (!o) setArchiveConfirm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive {archiveConfirm?.label}?</DialogTitle>
            <DialogDescription>
              Archived products are hidden from new quotations, invoices, and purchase orders. All historical records remain intact. You can restore them at any time from the Archived view.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveConfirm(null)}>Cancel</Button>
            <Button onClick={() => archiveConfirm && archiveMut.mutate(archiveConfirm.ids)} disabled={archiveMut.isPending}>
              <Archive className="h-4 w-4 mr-1.5" /> Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} isAdmin={isAdmin} onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["items"] }); queryClient.invalidateQueries({ queryKey: ["item_variations"] }); }} />
      <BulkEditUploadDialog open={bulkEditOpen} onOpenChange={setBulkEditOpen} items={items} isAdmin={isAdmin} onSuccess={() => { queryClient.invalidateQueries({ queryKey: ["items"] }); queryClient.invalidateQueries({ queryKey: ["item_branch_stock"] }); }} />

      <HorizontalScrollSync className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              {visibleColumns.map((c) => {
                const align = (c.key === "name" || c.key === "source" || c.key === "branch") ? "left" : "right";
                return <SortableHeader key={`h-${c.key}`} sortKey={c.key} label={c.label} sort={sort} onToggle={toggle} align={align} />;
              })}
              <TableHead className="text-xs text-right w-32 sticky right-0 z-20 bg-card shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={visibleColCount} className="h-32 text-center">
                  <div className="flex justify-center"><div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
                </TableCell>
              </TableRow>
            ) : sortedFiltered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleColCount}>
                  <div className="empty-state">
                    <Package className="empty-state-icon" />
                    <p className="text-sm">No items match your filters</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : sortedFiltered.map(item => (
              <TableRow key={item.id} className={`hover:bg-muted/30 ${selectedIds.has(item.id) ? 'bg-muted/40' : ''}`} data-state={selectedIds.has(item.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={() => toggleOne(item.id)}
                    aria-label={`Select ${item.name}`}
                  />
                </TableCell>
                {visibleColumns.map((c) => {
                  switch (c.key) {
                    case "name":
                      return (
                        <TableCell key="c-name" className="font-medium text-sm">
                          <div className="flex flex-col">
                            <span className="flex items-center gap-1.5">
                              {item.name}
                              {item.status && item.status !== "active" && (
                                <Badge variant="outline" className="text-[9px] uppercase h-4 px-1">{item.status}</Badge>
                              )}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {item.sku}
                              {item.category && <> · <span className="text-muted-foreground/80">{item.category}</span></>}
                            </span>
                          </div>
                        </TableCell>
                      );
                    case "source":
                      return (
                        <TableCell key="c-source">
                          <Badge variant={((item as any).source === 'import') ? 'secondary' : 'outline'} className="text-[10px] uppercase">
                            {((item as any).source as string) || 'local'}
                          </Badge>
                        </TableCell>
                      );
                    case "quantity":
                      return (
                        <TableCell key="c-qty" className={`text-right text-sm font-semibold ${item.low_stock_threshold > 0 && item.quantity <= item.low_stock_threshold ? 'text-destructive' : ''}`}>
                          {item.quantity}
                          {(item.units_per_stock ?? 1) > 1 && (item.open_roll_remaining ?? 0) > 0 && (
                            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                              + {item.open_roll_remaining}{item.base_unit || 'm'} open
                            </span>
                          )}
                        </TableCell>
                      );
                    case "branch":
                      return (
                        <TableCell key="c-branch" className="text-sm">
                          <Badge variant="outline" className="text-[10px] uppercase">{branchLabel}</Badge>
                        </TableCell>
                      );
                    case "reserved_quantity": {
                      const rq = Number((item as any).reserved_quantity ?? 0);
                      return (
                        <TableCell key="c-res" className="text-right text-sm">
                          <span className={rq > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}>{rq}</span>
                        </TableCell>
                      );
                    }
                    case "incoming_quantity": {
                      const iq = Number((item as any).incoming_quantity ?? 0);
                      return (
                        <TableCell key="c-inc" className="text-right text-sm">
                          <span className={iq > 0 ? "text-blue-600 font-medium" : "text-muted-foreground"}>{iq}</span>
                        </TableCell>
                      );
                    }
                    case "warehouse_quantity":
                      return <TableCell key="c-wh" className="text-right text-sm">{(item as any).warehouse_quantity ?? 0}</TableCell>;
                    case "store_quantity":
                      return <TableCell key="c-st" className="text-right text-sm">{(item as any).store_quantity ?? 0}</TableCell>;
                    case "cost_price":
                      return (
                        <TableCell key="c-cost" className="text-right text-sm text-muted-foreground">
                          {(isAdmin || (((item as any).source as string) || 'local') === 'local') ? peso(Number(item.cost_price)) : '—'}
                        </TableCell>
                      );
                    case "selling_price":
                      return <TableCell key="c-sell" className="text-right text-sm">{peso(Number(item.selling_price))}</TableCell>;
                    case "low_stock_threshold":
                      return (
                        <TableCell key="c-th" className="text-right text-sm">
                          <span className={item.low_stock_threshold > 0 && item.quantity <= item.low_stock_threshold ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                            {item.low_stock_threshold ?? 0}
                          </span>
                        </TableCell>
                      );
                    default:
                      return null;
                  }
                })}
                <TableCell className="text-right sticky right-0 z-10 bg-card shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]">
                  <div className="flex justify-end gap-0.5">
                    {!viewArchived && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => setTransferItem(item)} className="h-7 w-7 rounded-md" title="Transfer stock">
                          <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setAdjustItem(item)} className="h-7 w-7 rounded-md" title="Adjust stock">
                          <ClipboardEdit className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setHistoryItem(item)} className="h-7 w-7 rounded-md" title="Stock history">
                      <History className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setCostHistoryItem(item)} className="h-7 w-7 rounded-md" title="Cost history">
                      <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setSuppliersItem(item)} className="h-7 w-7 rounded-md" title="Suppliers">
                      <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    {!viewArchived && (
                      <Button variant="ghost" size="icon" onClick={() => setVariationsItem(item)} className="h-7 w-7 rounded-md" title="Variations">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                    {isAdmin && !viewArchived && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(item)} className="h-7 w-7 rounded-md" title="Edit">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setArchiveConfirm({ ids: [item.id], label: `"${item.name}"` })} className="h-7 w-7 rounded-md" title="Archive">
                          <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Permanently delete "${item.name}"? This cannot be undone.`)) deleteMut.mutate(item.id); }} className="h-7 w-7 rounded-md" title="Delete">
                          <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                        </Button>
                      </>
                    )}
                    {isAdmin && viewArchived && (
                      <Button variant="ghost" size="icon" onClick={() => unarchiveMut.mutate([item.id])} className="h-7 w-7 rounded-md" title="Restore">
                        <ArchiveRestore className="h-3.5 w-3.5 text-primary" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </HorizontalScrollSync>

      {variationsItem && (
        <VariationsManager
          item={variationsItem}
          open={!!variationsItem}
          onOpenChange={(o) => { if (!o) setVariationsItem(null); }}
        />
      )}

      <TransferStockDialog item={transferItem} open={!!transferItem} onOpenChange={(o) => { if (!o) setTransferItem(null); }} />
      <AdjustStockDialog item={adjustItem} open={!!adjustItem} onOpenChange={(o) => { if (!o) setAdjustItem(null); }} />
      <ItemHistoryDialog item={historyItem} open={!!historyItem} onOpenChange={(o) => { if (!o) setHistoryItem(null); }} />
      <CostHistoryDialog item={costHistoryItem} open={!!costHistoryItem} onOpenChange={(o) => { if (!o) setCostHistoryItem(null); }} />
      <ItemSuppliersDialog item={suppliersItem} open={!!suppliersItem} onOpenChange={(o) => { if (!o) setSuppliersItem(null); }} />
    </div>
  );
}
