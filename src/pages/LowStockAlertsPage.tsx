import { useMemo, useState, useEffect, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, parseISO, differenceInDays } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatCard } from "@/components/StatCard";
import { peso } from "@/lib/currency";
import { useAuth } from "@/contexts/AuthContext";
import ItemHistoryDialog from "@/components/ItemHistoryDialog";
import CostHistoryDialog from "@/components/CostHistoryDialog";
import { createPurchaseOrder, createPOItems, generatePONumber, createOverseasPurchaseOrder, createOverseasPOItems, generateOverseasPONumber } from "@/lib/api";
import { listItemSuppliersForItems, upsertItemSupplier, type ItemSupplierRow } from "@/lib/itemSuppliers";
import type { Supplier, OverseasSupplier } from "@/types/database";
import { toast } from "sonner";
import {
  AlertTriangle,
  Package,
  ShoppingCart,
  TrendingUp,
  Search,
  ChevronRight,
  ChevronDown,
  History,
  DollarSign,
  BarChart3,
  CheckCircle2,
  Circle,
  Flame,
  Snowflake,
  Clock,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Item } from "@/types/database";

type Severity = "critical" | "low" | "healthy";
type StatusFilter = "all" | "critical" | "ordered" | "not_ordered" | "po_created" | "fast" | "slow";
type SortKey = "lowest" | "highest_sales" | "fastest" | "most_profit" | "soonest_out";

const LEAD_TIME_DAYS = 14;
const TARGET_DAYS_OF_STOCK = 30;

function getSeverity(qty: number, threshold: number): Severity {
  if (qty <= 0) return "critical";
  if (threshold > 0 && qty <= Math.max(1, Math.floor(threshold / 2))) return "critical";
  if (qty <= threshold) return "low";
  return "healthy";
}

function severityColor(s: Severity) {
  if (s === "critical") return "bg-destructive/10 text-destructive border-destructive/30";
  if (s === "low") return "bg-warning/10 text-warning border-warning/30";
  return "bg-success/10 text-success border-success/30";
}

interface SaleRow {
  item_id: string;
  qty: number;          // raw qty as sold (in selling units when variation present)
  baseQty: number;      // converted to base inventory units (e.g. rolls)
  amount: number;
  date: string;
}

function fmtBase(n: number) {
  if (!isFinite(n)) return "—";
  // Show 2 decimals only when fractional
  return Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) : n.toFixed(2);
}

export default function LowStockAlertsPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = role === "admin";
  const money = (n: number) => (isAdmin ? peso(n) : "—");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "local" | "import">("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("soonest_out");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [costHistoryItem, setCostHistoryItem] = useState<Item | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [recentlyCreatedPoItems, setRecentlyCreatedPoItems] = useState<Set<string>>(new Set());

  // 1. Items
  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ["lowstock-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("items").select("*").order("name");
      if (error) throw error;
      return data as Item[];
    },
  });

  // 2. Variations (for unit conversion)
  const { data: variations = [] } = useQuery({
    queryKey: ["lowstock-variations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("item_variations").select("id, item_id, type, factor");
      if (error) throw error;
      return data as { id: string; item_id: string; type: string; factor: number }[];
    },
  });
  const variationMap = useMemo(() => {
    const m = new Map<string, { factor: number; type: string; item_id: string }>();
    for (const v of variations) m.set(v.id, { factor: Number(v.factor || 1), type: v.type, item_id: v.item_id });
    return m;
  }, [variations]);
  const itemsById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  // Convert a sale qty to base inventory units (rolls / boxes / etc.)
  const toBaseUnits = (item_id: string, qty: number, variation_id: string | null): number => {
    const item = itemsById.get(item_id);
    if (!item) return qty;
    const ups = Number(item.units_per_stock || 1) || 1;
    if (!variation_id) {
      // No variation = sold in base stock unit (1:1)
      return qty;
    }
    const v = variationMap.get(variation_id);
    if (!v) return qty;
    // For both pack & cut: base_units = (factor * qty) / units_per_stock
    return (v.factor * qty) / ups;
  };

  // 3. Last 90 days sales
  const since90 = useMemo(() => subDays(new Date(), 90).toISOString(), []);
  const { data: salesRows = [] } = useQuery<SaleRow[]>({
    queryKey: ["lowstock-sales", since90, items.length, variations.length],
    enabled: items.length > 0,
    queryFn: async () => {
      const [invRes, onlRes] = await Promise.all([
        supabase
          .from("invoice_items")
          .select("item_id, variation_id, quantity, unit_price, invoices!inner(invoice_date, status)")
          .gte("invoices.invoice_date", since90.slice(0, 10))
          .neq("invoices.status", "draft"),
        supabase
          .from("online_sales")
          .select("item_id, variation_id, quantity, deal_price, order_date, status")
          .gte("order_date", since90.slice(0, 10))
          .eq("status", "completed"),
      ]);
      const out: SaleRow[] = [];
      for (const r of (invRes.data as any[]) || []) {
        if (!r.item_id) continue;
        const qty = Number(r.quantity || 0);
        out.push({
          item_id: r.item_id,
          qty,
          baseQty: toBaseUnits(r.item_id, qty, r.variation_id),
          amount: qty * Number(r.unit_price || 0),
          date: r.invoices?.invoice_date,
        });
      }
      for (const r of (onlRes.data as any[]) || []) {
        if (!r.item_id) continue;
        const qty = Number(r.quantity || 0);
        out.push({
          item_id: r.item_id,
          qty,
          baseQty: toBaseUnits(r.item_id, qty, r.variation_id),
          amount: qty * Number(r.deal_price || 0),
          date: r.order_date,
        });
      }
      return out;
    },
  });

  // 4. Open POs
  const { data: openPoLines = [] } = useQuery({
    queryKey: ["lowstock-open-pos"],
    queryFn: async () => {
      const [localRes, overRes] = await Promise.all([
        supabase
          .from("purchase_order_items")
          .select("item_id, quantity, received_quantity, purchase_orders!inner(po_number, status, suppliers(id,name))")
          .neq("purchase_orders.status", "received"),
        supabase
          .from("overseas_purchase_order_items")
          .select("item_id, quantity, received_quantity, overseas_purchase_orders!inner(po_number, status, overseas_suppliers(name))")
          .neq("overseas_purchase_orders.status", "received"),
      ]);
      const rows: { item_id: string; pending: number; po_number: string; supplier: string; supplier_id?: string }[] = [];
      for (const r of (localRes.data as any[]) || []) {
        if (!r.item_id) continue;
        const pending = Number(r.quantity || 0) - Number(r.received_quantity || 0);
        if (pending <= 0) continue;
        rows.push({
          item_id: r.item_id,
          pending,
          po_number: r.purchase_orders?.po_number || "",
          supplier: r.purchase_orders?.suppliers?.name || "—",
          supplier_id: r.purchase_orders?.suppliers?.id,
        });
      }
      for (const r of (overRes.data as any[]) || []) {
        if (!r.item_id) continue;
        const pending = Number(r.quantity || 0) - Number(r.received_quantity || 0);
        if (pending <= 0) continue;
        rows.push({
          item_id: r.item_id,
          pending,
          po_number: r.overseas_purchase_orders?.po_number || "",
          supplier: r.overseas_purchase_orders?.overseas_suppliers?.name || "—",
        });
      }
      return rows;
    },
  });

  // 5. Latest cost change per item
  const { data: lastCostMap = {} } = useQuery<Record<string, { date: string; cost: number; supplier: string | null; po: string | null }>>({
    queryKey: ["lowstock-last-cost"],
    queryFn: async () => {
      const { data } = await supabase
        .from("item_cost_history")
        .select("item_id, new_cost, supplier_name, po_number, created_at, source")
        .order("created_at", { ascending: false })
        .limit(1000);
      const map: Record<string, any> = {};
      for (const r of (data as any[]) || []) {
        if (!r.item_id || map[r.item_id]) continue;
        map[r.item_id] = {
          date: r.created_at,
          cost: Number(r.new_cost || 0),
          supplier: r.supplier_name,
          po: r.po_number,
        };
      }
      return map;
    },
  });

  // 6. Latest supplier (with id) per item — for bulk PO grouping
  const { data: latestSupplierMap = {} } = useQuery<Record<string, { id: string; name: string }>>({
    queryKey: ["lowstock-latest-supplier"],
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_order_items")
        .select("item_id, purchase_orders!inner(order_date, suppliers(id,name))")
        .order("order_date", { foreignTable: "purchase_orders", ascending: false })
        .limit(2000);
      const map: Record<string, { id: string; name: string }> = {};
      for (const r of (data as any[]) || []) {
        if (!r.item_id || map[r.item_id]) continue;
        const s = r.purchase_orders?.suppliers;
        if (s?.id) map[r.item_id] = { id: s.id, name: s.name };
      }
      return map;
    },
  });

  // 6b. Preferred item-supplier per item (from new item_suppliers table)
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const { data: itemSupplierMap = new Map() } = useQuery<Map<string, ItemSupplierRow>>({
    queryKey: ["lowstock-item-suppliers", itemIds.length],
    queryFn: () => listItemSuppliersForItems(itemIds),
    enabled: itemIds.length > 0,
  });


  // Build per-item enriched rows
  const enriched = useMemo(() => {
    const salesByItem = new Map<string, SaleRow[]>();
    for (const s of salesRows) {
      if (!salesByItem.has(s.item_id)) salesByItem.set(s.item_id, []);
      salesByItem.get(s.item_id)!.push(s);
    }
    const orderedByItem = new Map<string, { pending: number; pos: string[]; supplier: string }>();
    for (const r of openPoLines) {
      const cur = orderedByItem.get(r.item_id) || { pending: 0, pos: [], supplier: r.supplier };
      cur.pending += r.pending;
      if (r.po_number && !cur.pos.includes(r.po_number)) cur.pos.push(r.po_number);
      orderedByItem.set(r.item_id, cur);
    }

    const today = new Date();
    return items.map((it) => {
      const threshold = it.low_stock_threshold ?? 0;
      const sev = getSeverity(it.quantity, threshold);
      const sales = salesByItem.get(it.id) || [];
      // base-unit aggregations
      let q7 = 0, q30 = 0, q90 = 0, a7 = 0, a30 = 0, a90 = 0;
      let raw30 = 0; // raw selling-unit qty for display
      for (const s of sales) {
        if (!s.date) continue;
        const d = parseISO(s.date);
        const diff = differenceInDays(today, d);
        if (diff <= 7) { q7 += s.baseQty; a7 += s.amount; }
        if (diff <= 30) { q30 += s.baseQty; a30 += s.amount; raw30 += s.qty; }
        if (diff <= 90) { q90 += s.baseQty; a90 += s.amount; }
      }
      const avgDaily = q90 / 90; // base units / day
      const daysToOut = avgDaily > 0 ? it.quantity / avgDaily : Infinity;
      const moving: "fast" | "slow" | "normal" = avgDaily >= 1 ? "fast" : avgDaily >= 0.2 ? "normal" : "slow";

      const orderInfo = orderedByItem.get(it.id);
      const pendingOrdered = orderInfo?.pending || 0;
      const suggestedQty = Math.max(
        Math.ceil(avgDaily * (TARGET_DAYS_OF_STOCK + LEAD_TIME_DAYS)) - it.quantity - pendingOrdered,
        threshold > 0 ? threshold - it.quantity - pendingOrdered : 0,
        0,
      );

      const lastCost = lastCostMap[it.id];
      const reorderCost = suggestedQty * (lastCost?.cost ?? it.cost_price ?? 0);

      let recommendation: "urgent" | "soon" | "monitor" | "ok";
      let recommendationText: string;
      if (sev === "critical" && (orderInfo?.pending ?? 0) === 0) {
        recommendation = "urgent";
        recommendationText = "Urgent reorder needed";
      } else if (avgDaily > 0 && daysToOut <= LEAD_TIME_DAYS) {
        recommendation = "soon";
        recommendationText = `Reorder soon — ~${Math.floor(daysToOut)} day(s) of stock`;
      } else if (avgDaily === 0) {
        recommendation = "monitor";
        recommendationText = "No recent sales — monitor only";
      } else {
        recommendation = "ok";
        recommendationText = `Enough stock for ~${Math.floor(daysToOut)} day(s)`;
      }

      const itemSupplier = itemSupplierMap.get(it.id);
      // Preferred supplier priority: item_suppliers (primary/recent) > PO history latest
      // For import products, prefer overseas item_supplier; for local, prefer local item_supplier.
      const preferredSupplier =
        itemSupplier && itemSupplier.is_overseas && itemSupplier.overseas_supplier_id
          ? { id: itemSupplier.overseas_supplier_id, name: itemSupplier.supplier_name || "Supplier", overseas: true as const }
          : itemSupplier && !itemSupplier.is_overseas && itemSupplier.supplier_id
          ? { id: itemSupplier.supplier_id, name: itemSupplier.supplier_name || "Supplier", overseas: false as const }
          : latestSupplierMap[it.id]
          ? { ...latestSupplierMap[it.id], overseas: false as const }
          : undefined;

      return {
        item: it,
        threshold,
        severity: sev,
        ordered: !!orderInfo,
        pendingOrdered,
        openPos: orderInfo?.pos || [],
        orderSupplier: orderInfo?.supplier,
        q7, q30, q90, a7, a30, a90, raw30,
        avgDaily,
        daysToOut,
        moving,
        suggestedQty,
        reorderCost,
        lastCost,
        recommendation,
        recommendationText,
        profit: (it.selling_price - it.cost_price) * q90,
        latestSupplier: preferredSupplier,
        itemSupplier, // full row incl. currency, MOQ, lead time
      };
    });
  }, [items, salesRows, openPoLines, lastCostMap, latestSupplierMap, itemSupplierMap]);


  // Hide items with threshold <= 0 OR healthy stock
  const lowStock = useMemo(
    () => enriched.filter((e) => (e.threshold ?? 0) > 0 && e.severity !== "healthy"),
    [enriched],
  );

  const availableSuppliers = useMemo(() => {
    const set = new Set<string>();
    for (const r of lowStock) {
      const s = r.lastCost?.supplier || r.orderSupplier || r.latestSupplier?.name;
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [lowStock]);

  const filtered = useMemo(() => {
    let rows = lowStock;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => r.item.name.toLowerCase().includes(q) || r.item.sku.toLowerCase().includes(q));
    }
    if (sourceFilter !== "all") rows = rows.filter((r) => r.item.source === sourceFilter);
    if (statusFilter === "critical") rows = rows.filter((r) => r.severity === "critical");
    else if (statusFilter === "ordered") rows = rows.filter((r) => r.ordered);
    else if (statusFilter === "not_ordered") rows = rows.filter((r) => !r.ordered);
    else if (statusFilter === "po_created") rows = rows.filter((r) => recentlyCreatedPoItems.has(r.item.id));
    else if (statusFilter === "fast") rows = rows.filter((r) => r.moving === "fast");
    else if (statusFilter === "slow") rows = rows.filter((r) => r.moving === "slow");

    if (supplierFilter !== "all") {
      rows = rows.filter((r) => (r.lastCost?.supplier || r.orderSupplier || r.latestSupplier?.name) === supplierFilter);
    }

    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sortKey === "lowest") return a.item.quantity - b.item.quantity;
      if (sortKey === "highest_sales") return b.a90 - a.a90;
      if (sortKey === "fastest") return b.avgDaily - a.avgDaily;
      if (sortKey === "most_profit") return b.profit - a.profit;
      const da = isFinite(a.daysToOut) ? a.daysToOut : 1e9;
      const db = isFinite(b.daysToOut) ? b.daysToOut : 1e9;
      return da - db;
    });
    return sorted;
  }, [lowStock, search, statusFilter, sourceFilter, supplierFilter, sortKey, recentlyCreatedPoItems]);

  const summary = useMemo(() => {
    const total = lowStock.length;
    const critical = lowStock.filter((r) => r.severity === "critical").length;
    const ordered = lowStock.filter((r) => r.ordered).length;
    const pending = total - ordered;
    const reorderCost = lowStock.reduce((s, r) => s + r.reorderCost, 0);
    return { total, critical, ordered, pending, reorderCost };
  }, [lowStock]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSelectAll = () => {
    if (filtered.every((r) => selectedIds.has(r.item.id)) && filtered.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.item.id)));
    }
  };

  const selectedRows = useMemo(
    () => filtered.filter((r) => selectedIds.has(r.item.id)),
    [filtered, selectedIds],
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Low Stock Alerts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Smart purchasing dashboard combining inventory, sales velocity, and supplier insights.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard title="Low Stock Items" value={summary.total} icon={AlertTriangle} variant="warning" />
        <StatCard title="Critical" value={summary.critical} icon={Flame} variant="warning" />
        <StatCard title="Already Ordered" value={summary.ordered} icon={CheckCircle2} variant="success" />
        <StatCard title="Pending Reorder" value={summary.pending} icon={Circle} />
        <StatCard
          title="Est. Reorder Cost"
          value={isAdmin ? peso(summary.reorderCost) : "—"}
          icon={DollarSign}
        />
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {([
              { k: "all", label: "All Low Stock" },
              { k: "critical", label: "Critical" },
              { k: "not_ordered", label: "Not Ordered" },
              { k: "ordered", label: "Ordered" },
              { k: "po_created", label: "PO Created" },
              { k: "fast", label: "Fast Moving" },
              { k: "slow", label: "Slow Moving" },
            ] as { k: StatusFilter; label: string }[]).map((f) => (
              <Button
                key={f.k}
                size="sm"
                variant={statusFilter === f.k ? "default" : "outline"}
                onClick={() => setStatusFilter(f.k)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              { k: "all", label: "All Sources", count: lowStock.length },
              { k: "local", label: "Local", count: lowStock.filter((r) => r.item.source === "local").length },
              { k: "import", label: "Import", count: lowStock.filter((r) => r.item.source === "import").length },
            ] as { k: "all" | "local" | "import"; label: string; count: number }[]).map((f) => (
              <Button
                key={f.k}
                size="sm"
                variant={sourceFilter === f.k ? "default" : "outline"}
                onClick={() => setSourceFilter(f.k)}
              >
                {f.label} ({f.count})
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name or SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            <Select value={supplierFilter} onValueChange={setSupplierFilter}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="Supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All suppliers ({availableSuppliers.length})</SelectItem>
                {availableSuppliers.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="soonest_out">Soonest to run out</SelectItem>
                <SelectItem value="lowest">Lowest stock first</SelectItem>
                <SelectItem value="highest_sales">Highest sales (90d)</SelectItem>
                <SelectItem value="fastest">Fastest moving</SelectItem>
                <SelectItem value="most_profit">Most profitable</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={selectedIds.size === 0}
              onClick={() => setBulkOpen(true)}
            >
              <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
              Create Bulk PO ({selectedIds.size})
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={filtered.length > 0 && filtered.every((r) => selectedIds.has(r.item.id))}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-8" />
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Min</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Sold (30d)</TableHead>
                <TableHead className="text-right">Last Cost</TableHead>
                <TableHead className="text-right">Days Left</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
                    No items match — stock looks healthy.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => {
                const isOpen = expanded.has(r.item.id);
                const supplier = r.lastCost?.supplier || r.orderSupplier || r.latestSupplier?.name || "—";
                const baseUnit = r.item.base_unit || "pcs";
                const ups = Number(r.item.units_per_stock || 1) || 1;
                const sellingUnit = ups > 1 ? "varies" : baseUnit;
                return (
                  <Fragment key={r.item.id}>
                    <TableRow className={cn("cursor-pointer", recentlyCreatedPoItems.has(r.item.id) && "bg-primary/5")}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(r.item.id)}
                          onCheckedChange={() => toggleSelect(r.item.id)}
                        />
                      </TableCell>
                      <TableCell onClick={() => toggleExpand(r.item.id)}>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-medium" onClick={() => toggleExpand(r.item.id)}>
                        <div className="flex items-center gap-2">
                          <span className={cn("h-2 w-2 rounded-full",
                            r.severity === "critical" ? "bg-destructive" :
                            r.severity === "low" ? "bg-warning" : "bg-success")} />
                          {r.item.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.item.sku}</TableCell>
                      <TableCell className="text-right font-semibold">
                        {r.item.quantity} <span className="text-[10px] text-muted-foreground font-normal">{baseUnit}</span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{r.threshold}</TableCell>
                      <TableCell className="text-xs">{supplier}</TableCell>
                      <TableCell className="text-right text-xs">
                        {fmtBase(r.q30)} <span className="text-[10px] text-muted-foreground">{baseUnit}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs">{r.lastCost ? money(r.lastCost.cost) : money(r.item.cost_price)}</TableCell>
                      <TableCell className="text-right text-xs">
                        {isFinite(r.daysToOut) ? `${Math.floor(r.daysToOut)}d` : "—"}
                      </TableCell>
                      <TableCell>
                        {recentlyCreatedPoItems.has(r.item.id) ? (
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> PO Created
                          </Badge>
                        ) : r.ordered ? (
                          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Ordered
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-muted">
                            <Circle className="h-3 w-3 mr-1" /> Not Ordered
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          "text-xs",
                          r.recommendation === "urgent" && "bg-destructive/10 text-destructive border-destructive/30",
                          r.recommendation === "soon" && "bg-warning/10 text-warning border-warning/30",
                          r.recommendation === "monitor" && "bg-muted",
                          r.recommendation === "ok" && "bg-success/10 text-success border-success/30",
                        )}>
                          {r.recommendationText}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Link to="/purchase-orders">
                          <Button size="sm" variant="outline" className="h-7 text-xs">
                            <ShoppingCart className="h-3 w-3 mr-1" /> Create PO
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={13} className="bg-muted/30 p-4">
                          <ExpandedDetails
                            row={r}
                            money={money}
                            isAdmin={isAdmin}
                            onHistory={() => setHistoryItem(r.item)}
                            onCostHistory={() => setCostHistoryItem(r.item)}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ItemHistoryDialog item={historyItem} open={!!historyItem} onOpenChange={(o) => !o && setHistoryItem(null)} />
      <CostHistoryDialog item={costHistoryItem} open={!!costHistoryItem} onOpenChange={(o) => !o && setCostHistoryItem(null)} />

      <BulkPODialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        rows={selectedRows}
        money={money}
        onCreated={(itemIds) => {
          setRecentlyCreatedPoItems((prev) => {
            const next = new Set(prev);
            itemIds.forEach((id) => next.add(id));
            return next;
          });
          setSelectedIds(new Set());
          setBulkOpen(false);
          queryClient.invalidateQueries({ queryKey: ["lowstock-open-pos"] });
          queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
        }}
      />
    </div>
  );
}

// ===== Bulk PO Dialog =====
interface BulkPORow {
  item: Item;
  suggestedQty: number;
  lastCost?: { cost: number };
  latestSupplier?: { id: string; name: string };
  itemSupplier?: ItemSupplierRow;
}

function BulkPODialog({
  open,
  onOpenChange,
  rows,
  money,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: BulkPORow[];
  money: (n: number) => string;
  onCreated: (itemIds: string[]) => void;
}) {
  // Per-row editable state, keyed by item id
  const [edits, setEdits] = useState<Record<string, { qty: number; cost: number; supplier_id: string; supplier_name: string; saveDefault: boolean }>>({});
  const [submitting, setSubmitting] = useState(false);

  // All local suppliers for inline assignment of "Unassigned" rows
  const { data: allSuppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["bulkpo-suppliers"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("*").order("name");
      return (data as Supplier[]) || [];
    },
    enabled: open,
  });

  // Initialize edits whenever rows change / dialog opens
  useEffect(() => {
    if (!open) return;
    setEdits((prev) => {
      const next: typeof prev = {};
      for (const r of rows) {
        // Prefer item_suppliers cost (in supplier currency) when available + local
        const isLocal = r.itemSupplier && !r.itemSupplier.is_overseas;
        const seedCost = isLocal && r.itemSupplier
          ? Number(r.itemSupplier.latest_cost)
          : (r.lastCost?.cost ?? r.item.cost_price ?? 0);
        const seedQty = Math.max(r.itemSupplier?.moq || 1, r.suggestedQty || 1);
        next[r.item.id] = prev[r.item.id] ?? {
          qty: seedQty,
          cost: seedCost,
          supplier_id: r.latestSupplier?.id ?? "",
          supplier_name: r.latestSupplier?.name ?? "Unknown supplier",
          saveDefault: !r.itemSupplier && !!r.latestSupplier?.id, // offer to save when assigning fresh
        };
      }
      return next;
    });
  }, [open, rows]);

  // Group by supplier_id (or "unknown")
  const groups = useMemo(() => {
    const m = new Map<string, { supplier_id: string; supplier_name: string; rows: BulkPORow[] }>();
    for (const r of rows) {
      const e = edits[r.item.id];
      const sid = e?.supplier_id || "__unknown__";
      const sname = e?.supplier_name || "Unknown supplier";
      if (!m.has(sid)) m.set(sid, { supplier_id: sid, supplier_name: sname, rows: [] });
      m.get(sid)!.rows.push(r);
    }
    return Array.from(m.values());
  }, [rows, edits]);

  const totalCost = useMemo(() => {
    return rows.reduce((s, r) => {
      const e = edits[r.item.id];
      return s + (e?.qty || 0) * (e?.cost || 0);
    }, 0);
  }, [rows, edits]);

  const handleSubmit = async () => {
    const valid = groups.filter((g) => g.supplier_id !== "__unknown__");
    const skipped = rows.filter((r) => {
      const e = edits[r.item.id];
      return !e?.supplier_id;
    });
    if (valid.length === 0) {
      toast.error("No items have a supplier assigned — pick one inline before creating");
      return;
    }
    setSubmitting(true);
    const createdItemIds: string[] = [];
    let createdCount = 0;
    let savedDefaults = 0;
    try {
      for (const g of valid) {
        const po_number = await generatePONumber();
        const total = g.rows.reduce((s, r) => {
          const e = edits[r.item.id];
          return s + (e?.qty || 0) * (e?.cost || 0);
        }, 0);
        const po = await createPurchaseOrder({
          po_number,
          supplier_id: g.supplier_id,
          status: "draft",
          order_date: new Date().toISOString().split("T")[0],
          notes: "Auto-created from Low Stock Alerts",
          total_amount: total,
        } as any);
        const lineItems = g.rows.map((r) => {
          const e = edits[r.item.id];
          return {
            po_id: po.id,
            item_id: r.item.id,
            item_name: r.item.name,
            quantity: e?.qty || 1,
            unit_cost: e?.cost || 0,
            received_quantity: 0,
          };
        });
        await createPOItems(lineItems);
        createdCount += 1;
        for (const r of g.rows) {
          createdItemIds.push(r.item.id);
          const e = edits[r.item.id];
          // Save supplier-to-product when user opted in and product had no record
          if (e?.saveDefault && e?.supplier_id && !r.itemSupplier) {
            try {
              await upsertItemSupplier({
                item_id: r.item.id,
                supplier_id: e.supplier_id,
                currency: "PHP",
                latest_cost: e.cost || 0,
                is_primary: true,
              });
              savedDefaults += 1;
            } catch (err) {
              console.warn("Failed to save default supplier", err);
            }
          }
        }
      }
      toast.success(
        `Created ${createdCount} PO${createdCount === 1 ? "" : "s"} across ${valid.length} supplier${valid.length === 1 ? "" : "s"}` +
          (savedDefaults ? ` · saved ${savedDefaults} default supplier${savedDefaults === 1 ? "" : "s"}` : "") +
          (skipped.length ? ` (${skipped.length} skipped — no supplier)` : "")
      );
      onCreated(createdItemIds);
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to create POs: " + (e?.message || "unknown error"));
    } finally {
      setSubmitting(false);
    }
  };

  const updateEdit = (itemId: string, patch: Partial<{ qty: number; cost: number; supplier_id: string; supplier_name: string; saveDefault: boolean }>) => {
    setEdits((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...patch },
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Create Purchase Orders</DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items selected.</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Items are grouped by their latest supplier. One PO will be created per supplier.
              Edit quantities or unit costs before finalizing.
            </p>
            {groups.map((g) => (
              <div key={g.supplier_id} className="rounded-lg border bg-card">
                <div className="flex items-center justify-between p-3 border-b bg-muted/40">
                  <div className="font-medium text-sm">
                    {g.supplier_id === "__unknown__" ? (
                      <span className="text-destructive">No supplier on file — will be skipped</span>
                    ) : (
                      <>Supplier: {g.supplier_name}</>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">{g.rows.length} item(s)</Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      {g.supplier_id === "__unknown__" && <TableHead className="w-56">Assign supplier</TableHead>}
                      <TableHead className="w-24 text-right">Qty</TableHead>
                      <TableHead className="w-32 text-right">Unit Cost</TableHead>
                      <TableHead className="w-28 text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.rows.map((r) => {
                      const e = edits[r.item.id];
                      const subtotal = (e?.qty || 0) * (e?.cost || 0);
                      const isUnknown = g.supplier_id === "__unknown__";
                      const supplierMeta = r.itemSupplier;
                      return (
                        <Fragment key={r.item.id}>
                          <TableRow>
                            <TableCell className="text-sm">
                              <div className="font-medium">{r.item.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {r.item.sku} · stock {r.item.quantity} {r.item.base_unit || "pcs"}
                              </div>
                              {supplierMeta && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {supplierMeta.is_overseas ? "Overseas" : "Local"} · {supplierMeta.currency} {Number(supplierMeta.latest_cost).toFixed(2)}
                                  {supplierMeta.moq ? ` · MOQ ${supplierMeta.moq}` : ""}
                                  {supplierMeta.lead_time_days != null ? ` · lead ${supplierMeta.lead_time_days}d` : ""}
                                </div>
                              )}
                            </TableCell>
                            {isUnknown && (
                              <TableCell>
                                <Select
                                  value={e?.supplier_id || ""}
                                  onValueChange={(v) => {
                                    const sup = allSuppliers.find(s => s.id === v);
                                    updateEdit(r.item.id, { supplier_id: v, supplier_name: sup?.name || "Supplier", saveDefault: true });
                                  }}
                                >
                                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick supplier…" /></SelectTrigger>
                                  <SelectContent>
                                    {allSuppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            )}
                            <TableCell>
                              <Input
                                type="number"
                                min="1"
                                value={e?.qty ?? ""}
                                onChange={(ev) => updateEdit(r.item.id, { qty: Number(ev.target.value) || 0 })}
                                className="h-8 text-right"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={e?.cost ?? ""}
                                onChange={(ev) => updateEdit(r.item.id, { cost: Number(ev.target.value) || 0 })}
                                className="h-8 text-right"
                              />
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">{money(subtotal)}</TableCell>
                          </TableRow>
                          {!supplierMeta && e?.supplier_id && (
                            <TableRow>
                              <TableCell colSpan={isUnknown ? 5 : 4} className="py-1.5">
                                <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={!!e?.saveDefault}
                                    onChange={(ev) => updateEdit(r.item.id, { saveDefault: ev.target.checked })}
                                  />
                                  Save <span className="font-medium text-foreground">{e.supplier_name}</span> as the default supplier for this product
                                </label>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
            <div className="flex justify-between items-center pt-2 border-t">
              <span className="text-sm text-muted-foreground">Total estimate</span>
              <span className="text-lg font-semibold">{money(totalCost)}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || rows.length === 0}>
            {submitting ? "Creating..." : `Create ${groups.filter(g => g.supplier_id !== "__unknown__").length} PO(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpandedDetails({
  row,
  money,
  isAdmin,
  onHistory,
  onCostHistory,
}: {
  row: any;
  money: (n: number) => string;
  isAdmin: boolean;
  onHistory: () => void;
  onCostHistory: () => void;
}) {
  const baseUnit = row.item.base_unit || "pcs";
  const ups = Number(row.item.units_per_stock || 1) || 1;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard label={`Sold 7d (${baseUnit})`} value={fmtBase(row.q7)} sub={money(row.a7)} />
        <MetricCard label={`Sold 30d (${baseUnit})`} value={fmtBase(row.q30)} sub={`raw ${fmtBase(row.raw30)} sold`} />
        <MetricCard label={`Sold 90d (${baseUnit})`} value={fmtBase(row.q90)} sub={money(row.a90)} />
        <MetricCard
          label={`Avg / day (${baseUnit})`}
          value={row.avgDaily.toFixed(2)}
          sub={row.moving === "fast" ? "Fast moving" : row.moving === "slow" ? "Slow moving" : "Normal"}
          icon={row.moving === "fast" ? Flame : row.moving === "slow" ? Snowflake : TrendingUp}
        />
        <MetricCard label={`Suggested (${baseUnit})`} value={row.suggestedQty} sub={`Cost ${money(row.reorderCost)}`} />
        <MetricCard
          label="Reorder Timing"
          value={
            row.recommendation === "urgent" ? "Now" :
            row.recommendation === "soon" ? `Within ${LEAD_TIME_DAYS}d` :
            row.recommendation === "ok" ? `In ~${Math.max(0, Math.floor(row.daysToOut - LEAD_TIME_DAYS))}d` :
            "—"
          }
          sub={`Lead time ${LEAD_TIME_DAYS}d`}
          icon={Clock}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-background p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">Unit Conversion</div>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-muted-foreground">Base unit</span><span className="font-medium">{baseUnit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Selling unit</span><span>{ups > 1 ? `varies (cuts/packs)` : baseUnit}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Conversion</span><span>{ups > 1 ? `${ups} per ${baseUnit}` : "1 : 1"}</span></div>
            {row.item.open_roll_remaining > 0 && (
              <div className="flex justify-between"><span className="text-muted-foreground">Open roll</span><span>{row.item.open_roll_remaining}</span></div>
            )}
          </div>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">Open Purchase Orders</div>
          {row.openPos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open POs for this item.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {row.openPos.map((po: string) => (
                <li key={po} className="flex items-center gap-2">
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{po}</span>
                  <span className="text-muted-foreground">— {row.orderSupplier}</span>
                </li>
              ))}
              <li className="text-xs text-muted-foreground">{row.pendingOrdered} unit(s) pending arrival</li>
            </ul>
          )}
        </div>
        <div className="rounded-lg border bg-background p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">Default Supplier</div>
          {row.itemSupplier ? (
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Supplier</span><span className="font-medium">{row.itemSupplier.supplier_name || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span>{row.itemSupplier.is_overseas ? "Overseas" : "Local"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Latest cost</span><span className="font-medium">{currencySymbolForDisplay(row.itemSupplier.currency)}{Number(row.itemSupplier.latest_cost).toFixed(2)} <span className="text-[10px] text-muted-foreground">{row.itemSupplier.currency}</span></span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">MOQ</span><span>{row.itemSupplier.moq || 1}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Lead time</span><span>{row.itemSupplier.lead_time_days != null ? `${row.itemSupplier.lead_time_days}d` : "—"}</span></div>
              {row.itemSupplier.last_purchased_at && (
                <div className="flex justify-between"><span className="text-muted-foreground">Last ordered</span><span>{format(parseISO(row.itemSupplier.last_purchased_at), "MMM d, yyyy")}</span></div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No supplier assigned to this product. Add one from Inventory → Suppliers.</p>
          )}
        </div>
        <div className="rounded-lg border bg-background p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-medium">Last Supplier Cost</div>
          {row.lastCost ? (
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Supplier</span><span>{row.lastCost.supplier || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">PO</span><span>{row.lastCost.po || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cost</span><span className="font-medium">{money(row.lastCost.cost)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{format(parseISO(row.lastCost.date), "MMM d, yyyy")}</span></div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No purchase history yet.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/purchase-orders">
          <Button size="sm"><ShoppingCart className="h-3.5 w-3.5 mr-1.5" /> Create Purchase Order</Button>
        </Link>
        <Link to={`/business-insights?item=${encodeURIComponent(row.item.sku)}`}>
          <Button size="sm" variant="outline"><BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Sales History</Button>
        </Link>
        <Button size="sm" variant="outline" onClick={onHistory}>
          <History className="h-3.5 w-3.5 mr-1.5" /> Inventory History
        </Button>
        <Button size="sm" variant="outline" onClick={onCostHistory}>
          <DollarSign className="h-3.5 w-3.5 mr-1.5" /> Cost History
        </Button>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, icon: Icon }: { label: string; value: any; sub?: string; icon?: any }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <div className="text-lg font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function currencySymbolForDisplay(c: string) {
  if (c === "RMB") return "¥";
  if (c === "USD") return "$";
  return "₱";
}
