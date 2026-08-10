import { Fragment, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/currency";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/StatCard";
import { SortableHeader } from "@/components/SortableHeader";
import { useSort } from "@/hooks/use-sort";
import { cn } from "@/lib/utils";
import { CalendarIcon, ShoppingCart, Receipt, DollarSign, Package, Search, ChevronRight, ChevronDown, Download, Filter, TrendingUp, AlertTriangle, ShoppingBag, Warehouse, Users, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranch } from "@/contexts/BranchContext";
import { FilterCombobox } from "@/components/FilterCombobox";
import { InsightsProductCard } from "@/components/InsightsProductCard";
import type { ProductMetric, SaleTxn } from "@/types/insights";
import * as XLSX from "xlsx";
import { toast } from "sonner";

type RangePreset = "today" | "7d" | "30d" | "60d" | "90d" | "month" | "all" | "custom";
type SourceFilter = "all" | "online" | "invoice";
type PaymentFilter = "all" | "paid" | "unpaid";
type ProductSourceFilter = "all" | "local" | "import";

const RANGE_OPTIONS: { v: RangePreset; l: string }[] = [
  { v: "today", l: "Today" },
  { v: "7d", l: "7d" },
  { v: "30d", l: "30d" },
  { v: "60d", l: "60d" },
  { v: "90d", l: "90d" },
  { v: "month", l: "This month" },
  { v: "all", l: "All" },
  { v: "custom", l: "Custom" },
];
const SOURCE_OPTIONS: { v: SourceFilter; l: string }[] = [
  { v: "all", l: "All sources" },
  { v: "online", l: "Online only" },
  { v: "invoice", l: "Invoice only" },
];
const PAYMENT_OPTIONS: { v: PaymentFilter; l: string }[] = [
  { v: "all", l: "All payments" },
  { v: "paid", l: "Paid only" },
  { v: "unpaid", l: "Unpaid only" },
];
const PRODUCT_SOURCE_OPTIONS: { v: ProductSourceFilter; l: string }[] = [
  { v: "all", l: "All types" },
  { v: "local", l: "Local" },
  { v: "import", l: "Import" },
];

/** Segmented chip row shared by the desktop filter bar and the mobile filter drawer. */
function ChipGroup<T extends string>({
  value,
  onChange,
  options,
  fill,
}: {
  value: T;
  /** Typed as a state setter so T infers from the setter, not widening to string. */
  onChange: Dispatch<SetStateAction<T>>;
  options: { v: T; l: string }[];
  /** Stretch chips to fill the row — used inside the mobile drawer. */
  fill?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", fill && "gap-1.5")}>
      {options.map((o) => (
        <Button
          key={o.v}
          variant={value === o.v ? "default" : "outline"}
          size="sm"
          className={cn("h-7 text-xs", fill && "h-9 flex-1 min-w-[30%]")}
          onClick={() => onChange(o.v)}
        >
          {o.l}
        </Button>
      ))}
    </div>
  );
}

interface ItemAgg {
  key: string;
  itemId: string | null;
  variationId: string | null;
  variationName: string | null;
  name: string;
  sku: string;
  qtyOnline: number;
  qtyInvoice: number;
  qtyTotal: number;
  revenueOnline: number;
  revenueInvoice: number;
  revenueTotal: number;
  orders: number;
  txns: SaleTxn[];
}

// Sortable <th> for plain HTML tables
function SortableTh({ sortKey, label, sort, onToggle, align = "left", className }: { sortKey: string; label: string; sort: { key: string | null; dir: "asc" | "desc" }; onToggle: (k: string) => void; align?: "left" | "right"; className?: string }) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-3 py-2 font-medium select-none", align === "right" && "text-right", className)}>
      <button type="button" onClick={() => onToggle(sortKey)} className={cn("inline-flex items-center gap-1 hover:text-foreground transition-colors", align === "right" && "ml-auto flex-row-reverse", active ? "text-foreground" : "text-muted-foreground")}>
        <span>{label}</span>
        <Icon className={cn("h-3 w-3", active ? "opacity-100" : "opacity-50")} />
      </button>
    </th>
  );
}

export default function BusinessInsightsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { activeBranchId, activeBranch } = useBranch();
  const money = (n: number) => (isAdmin ? peso(n) : "—");
  const [preset, setPreset] = useState<RangePreset>("today");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  // Controlled so choosing a start date can open the end picker straight away —
  // a range is two choices, and the second should not need a separate tap.
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [source, setSource] = useState<SourceFilter>("all");
  const [payment, setPayment] = useState<PaymentFilter>("all");
  const [search, setSearch] = useState("");
  const [productSource, setProductSource] = useState<ProductSourceFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedProduct, setExpandedProduct] = useState<Set<string>>(new Set());
  const toggleExpandProduct = (id: string) => {
    setExpandedProduct((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    if (preset === "today") return { dateFrom: startOfDay(now), dateTo: endOfDay(now) };
    if (preset === "7d") return { dateFrom: startOfDay(subDays(now, 6)), dateTo: endOfDay(now) };
    if (preset === "30d") return { dateFrom: startOfDay(subDays(now, 29)), dateTo: endOfDay(now) };
    if (preset === "60d") return { dateFrom: startOfDay(subDays(now, 59)), dateTo: endOfDay(now) };
    if (preset === "90d") return { dateFrom: startOfDay(subDays(now, 89)), dateTo: endOfDay(now) };
    if (preset === "month") return { dateFrom: startOfMonth(now), dateTo: endOfMonth(now) };
    if (preset === "all") return { dateFrom: new Date(2000, 0, 1), dateTo: endOfDay(now) };
    return {
      dateFrom: customFrom ? startOfDay(customFrom) : startOfDay(subDays(now, 29)),
      dateTo: customTo ? endOfDay(customTo) : endOfDay(now),
    };
  }, [preset, customFrom, customTo]);

  const fromStr = format(dateFrom, "yyyy-MM-dd");
  const toStr = format(dateTo, "yyyy-MM-dd");

  // Helper: fetch all rows in pages to bypass PostgREST's default 1000-row cap
  async function fetchAll<T = any>(build: () => any, pageSize = 1000): Promise<T[]> {
    const out: T[] = [];
    let from = 0;
    // Loop until a short page is returned
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await build().range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = (data || []) as T[];
      out.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  // Online sales — include ALL sales regardless of payment status so units/revenue
  // reflect actual sales volume. Cost & profit are only recognized for PAID sales.
  const { data: onlineRowsRaw = [] } = useQuery({
    queryKey: ["bi_online", fromStr, toStr, payment, activeBranchId],
    queryFn: async () => {
      return fetchAll(() => {
        let q = supabase
          .from("online_sales")
          .select("id, order_number, order_date, sales_channel, quantity, posted_price, amount_paid, item_id, variation_id, product_name, payment_status, paid_at, items(name, sku), item_variations(name, sku)")
          .eq("status", "completed")
          .gte("order_date", fromStr)
          .lte("order_date", toStr);
        if (payment === "paid") q = q.eq("payment_status", "paid");
        else if (payment === "unpaid") q = q.eq("payment_status", "unpaid");
        if (activeBranchId) q = q.eq("branch_id", activeBranchId);
        return q;
      });
    },
  });

  // Set of paid online sale IDs — profit/cost only apply to these.
  const paidOnlineIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of onlineRowsRaw as any[]) {
      if (r.payment_status === "paid") s.add(r.id);
    }
    return s;
  }, [onlineRowsRaw]);

  // Online sale cost snapshots (admin only)
  const { data: onlineFinancialsRows = [] } = useQuery({
    queryKey: ["bi_online_financials", (onlineRowsRaw as any[]).length, fromStr, toStr],
    enabled: isAdmin && (onlineRowsRaw as any[]).length > 0,
    queryFn: async () => {
      const ids = (onlineRowsRaw as any[]).map((r) => r.id);
      const chunkSize = 200;
      const out: any[] = [];
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const rows = await fetchAll<any>(() =>
          supabase
            .from("online_sale_financials")
            .select("online_sale_id, cost_snapshot, line_total_cost, line_profit")
            .in("online_sale_id", chunk)
        );
        out.push(...rows);
      }
      return out;
    },
  });
  const onlineFinMap = useMemo(() => {
    const m = new Map<string, { cost: number; profit: number; hasCost: boolean }>();
    for (const f of onlineFinancialsRows as any[]) {
      // Only recognize profit/cost for paid sales.
      if (f.cost_snapshot != null && paidOnlineIds.has(f.online_sale_id)) {
        m.set(f.online_sale_id, {
          cost: Number(f.line_total_cost || 0),
          profit: Number(f.line_profit || 0),
          hasCost: true,
        });
      }
    }
    return m;
  }, [onlineFinancialsRows, paidOnlineIds]);
  const missingOnlineCostCount = useMemo(
    () => (onlineFinancialsRows as any[]).filter((f) => f.cost_snapshot == null && paidOnlineIds.has(f.online_sale_id)).length,
    [onlineFinancialsRows, paidOnlineIds],
  );



  // Invoice items (only for confirmed/paid invoices in date range)
  const { data: invoiceRowsRaw = [] } = useQuery({
    queryKey: ["bi_invoice", fromStr, toStr, payment, activeBranchId],
    queryFn: async () => {
      const statuses =
        payment === "paid" ? ["paid", "completed"] : payment === "unpaid" ? ["confirmed", "unpaid", "shipped"] : ["confirmed", "paid", "unpaid", "shipped", "completed"];

      const invs = await fetchAll<any>(() => {
        let q = supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date, sales_agent, customer_id, status, customers(name)")
          .in("status", statuses as any)
          .gte("invoice_date", fromStr)
          .lte("invoice_date", toStr);
        if (activeBranchId) q = q.eq("branch_id", activeBranchId);
        return q;
      });
      const ids = invs.map((i: any) => i.id);
      if (!ids.length) return [];
      // Chunk the IN() filter and paginate per chunk
      const chunkSize = 200;
      const items: any[] = [];
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const rows = await fetchAll<any>(() =>
          supabase
            .from("invoice_items")
            .select("id, invoice_id, quantity, unit_price, item_id, variation_id, item_name, items(name, sku), item_variations(name, sku)")
            .in("invoice_id", chunk)
        );
        items.push(...rows);
      }
      const invMap = new Map<string, any>(invs.map((i: any) => [i.id, i]));
      return items.map((row: any) => ({ ...row, _invoice: invMap.get(row.invoice_id) }));
    },
  });

  // All items (for inventory / purchasing metrics)
  const { data: itemsAllRaw = [] } = useQuery({
    queryKey: ["bi_items_all"],
    queryFn: async () => fetchAll<any>(() =>
      supabase.from("items").select("id, name, sku, quantity, cost_price, selling_price, low_stock_threshold, source, created_at, category, brand")
    ),
  });

  // All variations — enable per-variation rows with independent stock/cost.
  const { data: variationsAllRaw = [] } = useQuery({
    queryKey: ["bi_variations_all"],
    queryFn: async () => fetchAll<any>(() =>
      // No quantity column here — variations do not hold their own stock, it sits
      // on the parent. Selecting it made PostgREST reject the whole request, so
      // this returned nothing and no variation rows were built at all.
      supabase.from("item_variations").select("id, item_id, name, sku, cost_price, selling_price")
    ),
  });

  // Real on-hand quantities. items.quantity stopped being maintained when
  // per-branch stock arrived, so it reports figures frozen at that migration.
  const { data: branchStockRaw = [] } = useQuery({
    queryKey: ["bi_branch_stock"],
    queryFn: async () => fetchAll<any>(() =>
      supabase.from("item_branch_stock").select("item_id, quantity")
    ),
  });

  const stockByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of branchStockRaw as any[]) {
      m.set(r.item_id, (m.get(r.item_id) || 0) + Number(r.quantity || 0));
    }
    return m;
  }, [branchStockRaw]);

  // Supplier links for every item (used by the Supplier filter)
  const { data: itemSupplierLinks = [] } = useQuery({
    queryKey: ["bi_item_suppliers"],
    queryFn: async () => {
      const links = await fetchAll<any>(() =>
        supabase.from("item_suppliers").select("item_id, supplier_id, overseas_supplier_id")
      );
      const [{ data: locals }, { data: overseas }] = await Promise.all([
        supabase.from("suppliers").select("id, name"),
        supabase.from("overseas_suppliers").select("id, name"),
      ]);
      const names = new Map<string, string>();
      for (const s of (locals as any[]) || []) names.set(s.id, s.name);
      for (const s of (overseas as any[]) || []) names.set(s.id, s.name);
      return links.map((l: any) => ({
        item_id: l.item_id,
        supplier: names.get(l.supplier_id || l.overseas_supplier_id) || null,
      })).filter((l: any) => l.supplier);
    },
  });

  // Filter option lists
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of itemsAllRaw as any[]) if (i.category) set.add(i.category);
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [itemsAllRaw]);
  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const i of itemsAllRaw as any[]) if (i.brand) set.add(i.brand);
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [itemsAllRaw]);
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of itemSupplierLinks as any[]) set.add(l.supplier);
    return Array.from(set).sort().map((v) => ({ value: v, label: v }));
  }, [itemSupplierLinks]);

  // Item ids allowed by the Category / Brand / Supplier filters (null = no restriction)
  const allowedItemIds = useMemo(() => {
    const active = categoryFilter !== "all" || brandFilter !== "all" || supplierFilter !== "all";
    if (!active) return null;
    let bySupplier: Set<string> | null = null;
    if (supplierFilter !== "all") {
      bySupplier = new Set((itemSupplierLinks as any[]).filter((l) => l.supplier === supplierFilter).map((l) => l.item_id));
    }
    const ids = new Set<string>();
    for (const i of itemsAllRaw as any[]) {
      if (categoryFilter !== "all" && i.category !== categoryFilter) continue;
      if (brandFilter !== "all" && i.brand !== brandFilter) continue;
      if (bySupplier && !bySupplier.has(i.id)) continue;
      ids.add(i.id);
    }
    return ids;
  }, [categoryFilter, brandFilter, supplierFilter, itemsAllRaw, itemSupplierLinks]);

  // Overlay the real quantity here so every downstream figure — inventory value,
  // the stock column, days of stock, GMROI and the Dead classification — is based
  // on it rather than the stale column.
  const itemsAll = useMemo(
    () => {
      const base = allowedItemIds
        ? (itemsAllRaw as any[]).filter((i) => allowedItemIds.has(i.id))
        : (itemsAllRaw as any[]);
      return base.map((i) => ({ ...i, quantity: stockByItem.get(i.id) ?? 0 }));
    },
    [itemsAllRaw, allowedItemIds, stockByItem],
  );
  const variationsAll = useMemo(
    () => (allowedItemIds ? (variationsAllRaw as any[]).filter((v) => allowedItemIds.has(v.item_id)) : (variationsAllRaw as any[])),
    [variationsAllRaw, allowedItemIds],
  );
  const onlineRows = useMemo(
    () => (allowedItemIds ? (onlineRowsRaw as any[]).filter((r) => r.item_id && allowedItemIds.has(r.item_id)) : (onlineRowsRaw as any[])),
    [onlineRowsRaw, allowedItemIds],
  );
  const invoiceRows = useMemo(
    () => (allowedItemIds ? (invoiceRowsRaw as any[]).filter((r) => r.item_id && allowedItemIds.has(r.item_id)) : (invoiceRowsRaw as any[])),
    [invoiceRowsRaw, allowedItemIds],
  );

  // All inventory movements — used to reconstruct historical stock levels for GMROI.
  const { data: movementsAll = [] } = useQuery({
    queryKey: ["bi_movements_all"],
    enabled: isAdmin,
    queryFn: async () => fetchAll<any>(() =>
      supabase.from("inventory_movements").select("item_id, type, quantity, created_at")
    ),
  });

  // All item cost history — used to reconstruct historical unit cost for GMROI.
  const { data: costHistoryAll = [] } = useQuery({
    queryKey: ["bi_cost_history_all"],
    enabled: isAdmin,
    queryFn: async () => fetchAll<any>(() =>
      supabase.from("item_cost_history").select("item_id, new_cost, created_at")
    ),
  });

  // Invoice item cost snapshots (admin only) for GP/margin per line
  const { data: financialsRows = [] } = useQuery({
    queryKey: ["bi_financials", fromStr, toStr, payment, (invoiceRows as any[]).length],
    enabled: isAdmin && (invoiceRows as any[]).length > 0,
    queryFn: async () => {
      const ids = Array.from(new Set((invoiceRows as any[]).map((r) => r.invoice_id).filter(Boolean)));
      if (!ids.length) return [];
      const chunkSize = 200;
      const out: any[] = [];
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const rows = await fetchAll<any>(() =>
          supabase
            .from("invoice_item_financials")
            .select("invoice_id, item_id, variation_id, cost_snapshot, quantity, unit_price, line_total_cost, line_profit")
            .in("invoice_id", chunk)
        );
        out.push(...rows);
      }
      return out;
    },
  });

  // Set of paid invoice IDs — profit/cost/revenue only count for these.
  // "Paid" = invoice status is "paid" or "completed".
  const paidInvoiceIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of invoiceRows as any[]) {
      const st = r._invoice?.status;
      if (st === "paid" || st === "completed") s.add(r.invoice_id);
    }
    return s;
  }, [invoiceRows]);

  // Financials lookup by invoice_id|item_id|variation_id (admin only).
  // Only sums lines from PAID invoices — matches the revenue rule so that
  // revenue - cost = gross profit stays consistent.
  const financialsMap = useMemo(() => {
    const m = new Map<string, { cost: number; profit: number; hasCost: boolean }>();
    for (const f of financialsRows as any[]) {
      if (!paidInvoiceIds.has(f.invoice_id)) continue;
      const key = `${f.invoice_id}|${f.item_id || ""}|${f.variation_id || ""}`;
      const e = m.get(key) || { cost: 0, profit: 0, hasCost: false };
      if (f.cost_snapshot != null) {
        e.cost += Number(f.line_total_cost || 0);
        e.profit += Number(f.line_profit || 0);
        e.hasCost = true;
      }
      m.set(key, e);
    }
    return m;
  }, [financialsRows, paidInvoiceIds]);

  // Count of PAID invoice lines excluded from profit calcs due to missing variation cost.
  const missingCostCount = useMemo(() => {
    return (financialsRows as any[]).filter(f => f.cost_snapshot == null && paidInvoiceIds.has(f.invoice_id)).length;
  }, [financialsRows, paidInvoiceIds]);


  const aggregated = useMemo<ItemAgg[]>(() => {
    const map = new Map<string, ItemAgg>();
    const get = (key: string, init: Omit<ItemAgg, "qtyOnline" | "qtyInvoice" | "qtyTotal" | "revenueOnline" | "revenueInvoice" | "revenueTotal" | "orders" | "txns">) => {
      let row = map.get(key);
      if (!row) {
        row = { ...init, qtyOnline: 0, qtyInvoice: 0, qtyTotal: 0, revenueOnline: 0, revenueInvoice: 0, revenueTotal: 0, orders: 0, txns: [] };
        map.set(key, row);
      }
      return row;
    };

    if (source !== "invoice") {
      for (const r of onlineRows as any[]) {
        const itemId = r.item_id || null;
        const variationId = r.variation_id || null;
        const variationName = r.item_variations?.name || null;
        const name = variationName ? `${r.items?.name || r.product_name} — ${variationName}` : (r.items?.name || r.product_name || "Unknown");
        const sku = r.item_variations?.sku || r.items?.sku || "—";
        const key = variationId ? `v:${variationId}` : itemId ? `i:${itemId}` : `n:${name}`;
        const row = get(key, { key, itemId, variationId, variationName, name, sku });
        const qty = Number(r.quantity || 0);
        const unit = Number(r.posted_price || 0);
        const rev = unit * qty;
        const isPaid = r.payment_status === "paid";
        row.qtyOnline += qty;
        // Only paid online sales contribute to revenue totals.
        if (isPaid) row.revenueOnline += rev;
        row.orders += 1;

        const channel = String(r.sales_channel || "online");
        const fin = onlineFinMap.get(r.id);
        row.txns.push({
          date: r.order_date || "",
          customer: channel.charAt(0).toUpperCase() + channel.slice(1),
          agent: "—",
          source: "online",
          reference: r.order_number || "—",
          quantity: qty,
          unitPrice: unit,
          amount: rev,
          itemId,
          variationId,
          variationName,
          cost: fin?.cost,
          profit: fin?.profit,
          paymentStatus: r.payment_status === "paid" ? "paid" : "unpaid",
        });

      }
    }

    if (source !== "online") {
      for (const r of invoiceRows as any[]) {
        const itemId = r.item_id || null;
        const variationId = r.variation_id || null;
        const variationName = r.item_variations?.name || null;
        const name = variationName ? `${r.items?.name || r.item_name} — ${variationName}` : (r.items?.name || r.item_name || "Unknown");
        const sku = r.item_variations?.sku || r.items?.sku || "—";
        const key = variationId ? `v:${variationId}` : itemId ? `i:${itemId}` : `n:${name}`;
        const row = get(key, { key, itemId, variationId, variationName, name, sku });
        const qty = Number(r.quantity || 0);
        const unit = Number(r.unit_price || 0);
        const rev = unit * qty;
        const invStatus = r._invoice?.status;
        const isPaid = invStatus === "paid" || invStatus === "completed";
        row.qtyInvoice += qty;
        // Only paid/completed invoices contribute to revenue totals.
        if (isPaid) row.revenueInvoice += rev;
        row.orders += 1;

        const inv = r._invoice || {};
        const fin = financialsMap.get(`${r.invoice_id}|${itemId || ""}|${variationId || ""}`);
        row.txns.push({
          date: inv.invoice_date || "",
          customer: inv.customers?.name || "Walk-in",
          agent: inv.sales_agent || "—",
          source: "invoice",
          reference: inv.invoice_number || "—",
          quantity: qty,
          unitPrice: unit,
          amount: rev,
          invoiceId: r.invoice_id,
          itemId,
          variationId,
          variationName,
          cost: isPaid ? fin?.cost : undefined,
          profit: isPaid ? fin?.profit : undefined,
          paymentStatus: isPaid ? "paid" : "unpaid",

        });
      }
    }

    const arr = Array.from(map.values()).map((r) => ({
      ...r,
      qtyTotal: r.qtyOnline + r.qtyInvoice,
      revenueTotal: r.revenueOnline + r.revenueInvoice,
      txns: [...r.txns].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    }));

    const q = search.trim().toLowerCase();
    return q
      ? arr.filter((r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
      : arr;
  }, [onlineRows, invoiceRows, source, search, financialsMap, onlineFinMap]);

  const { sort, toggle, sorted } = useSort<ItemAgg>(
    aggregated,
    {
      name: (r) => r.name,
      sku: (r) => r.sku,
      qtyOnline: (r) => r.qtyOnline,
      qtyInvoice: (r) => r.qtyInvoice,
      qtyTotal: (r) => r.qtyTotal,
      revenueOnline: (r) => r.revenueOnline,
      revenueInvoice: (r) => r.revenueInvoice,
      revenueTotal: (r) => r.revenueTotal,
      orders: (r) => r.orders,
    },
    { key: "revenueTotal", dir: "desc" },
  );

  const totals = useMemo(
    () =>
      aggregated.reduce(
        (acc, r) => {
          acc.qty += r.qtyTotal;
          acc.revOnline += r.revenueOnline;
          acc.revInvoice += r.revenueInvoice;
          acc.revTotal += r.revenueTotal;
          return acc;
        },
        { qty: 0, revOnline: 0, revInvoice: 0, revTotal: 0 },
      ),
    [aggregated],
  );

  // Outstanding revenue: unpaid invoices + unpaid online sales (does NOT affect
  // Revenue, COGS, GP, Margin, or Inventory calcs — display only).
  const outstanding = useMemo(() => {
    let inv = 0;
    for (const r of invoiceRows as any[]) {
      const st = r._invoice?.status;
      if (st !== "paid" && st !== "completed") {
        inv += Number(r.unit_price || 0) * Number(r.quantity || 0);
      }
    }
    let onl = 0;
    for (const r of onlineRows as any[]) {
      if (r.payment_status !== "paid") {
        onl += Number(r.posted_price || 0) * Number(r.quantity || 0);
      }
    }
    return { invoice: inv, online: onl, total: inv + onl };
  }, [invoiceRows, onlineRows]);

  // Count of PAID orders (unique invoices + unique paid online orders) for AOV.
  const paidOrderCount = useMemo(() => {
    const invSet = new Set<string>();
    for (const r of invoiceRows as any[]) {
      if (paidInvoiceIds.has(r.invoice_id)) invSet.add(r.invoice_id);
    }
    const onlSet = new Set<string>();
    for (const r of onlineRows as any[]) {
      if (r.payment_status === "paid") onlSet.add(String(r.order_number || r.id));
    }
    return invSet.size + onlSet.size;
  }, [invoiceRows, onlineRows, paidInvoiceIds]);

  // Customer analytics: separate online vs invoice.
  // Revenue excludes unpaid orders so it matches the totals shown elsewhere.
  const customerStats = useMemo(() => {
    // Online: group by sales_channel as "customer proxy" (no real customer on online)
    const onlineChannels = new Map<string, { revenue: number; orders: Set<string> }>();
    for (const r of onlineRows as any[]) {
      const channel = String(r.sales_channel || "others");
      const orderNum = String(r.order_number || r.id);
      const rev = Number(r.posted_price || 0) * Number(r.quantity || 0);
      const isPaid = r.payment_status === "paid";
      const e = onlineChannels.get(channel) || { revenue: 0, orders: new Set() };
      if (isPaid) e.revenue += rev;
      e.orders.add(orderNum);
      onlineChannels.set(channel, e);
    }
    const onlineUniqueOrders = new Set<string>();
    let onlineRevenue = 0;
    for (const r of onlineRows as any[]) {
      onlineUniqueOrders.add(String(r.order_number || r.id));
      if (r.payment_status === "paid") {
        onlineRevenue += Number(r.posted_price || 0) * Number(r.quantity || 0);
      }
    }

    // Invoice: group by customer
    const invoiceCustomers = new Map<string, { name: string; revenue: number; orders: Set<string> }>();
    let invoiceRevenue = 0;
    for (const r of invoiceRows as any[]) {
      const inv = r._invoice || {};
      const custId = inv.customer_id || `walkin:${inv.id}`;
      const name = inv.customers?.name || "Walk-in";
      const rev = Number(r.unit_price || 0) * Number(r.quantity || 0);
      const isPaid = inv.status === "paid" || inv.status === "completed";
      if (isPaid) invoiceRevenue += rev;
      const e = invoiceCustomers.get(custId) || { name, revenue: 0, orders: new Set() };
      if (isPaid) e.revenue += rev;
      e.orders.add(inv.id);
      invoiceCustomers.set(custId, e);
    }


    const onlineCustomerCount = onlineChannels.size;
    const invoiceCustomerCount = invoiceCustomers.size;
    const onlineAvg = onlineCustomerCount ? onlineRevenue / onlineCustomerCount : 0;
    const invoiceAvg = invoiceCustomerCount ? invoiceRevenue / invoiceCustomerCount : 0;

    const onlineList = Array.from(onlineChannels.entries())
      .map(([channel, v]) => ({ name: channel, revenue: v.revenue, orders: v.orders.size, avg: v.orders.size ? v.revenue / v.orders.size : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
    const invoiceList = Array.from(invoiceCustomers.values())
      .map((v) => ({ name: v.name, revenue: v.revenue, orders: v.orders.size, avg: v.orders.size ? v.revenue / v.orders.size : 0 }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      onlineCustomerCount,
      invoiceCustomerCount,
      onlineAvg,
      invoiceAvg,
      onlineList,
      invoiceList,
    };
  }, [onlineRows, invoiceRows]);

  const handleExport = () => {
    const wb = XLSX.utils.book_new();

    // === Sheet 1: Product Performance (parent + variation, all metrics) ===
    const perfRows = filteredProducts.map((p) => {
      const row: Record<string, unknown> = {
        Type: p.kind === "variation" ? "Variation" : "Parent",
        Item: p.name,
        "Variation Label": p.variationLabel || "",
        SKU: p.sku,
        Source: p.source || "local",
        Stock: p.stock,
        Threshold: p.threshold,
        "Selling Price": p.sellingPrice,
        "Qty Sold": p.qtySold,
        "Daily Sales": Number(p.dailySales.toFixed(4)),
        "Days Remaining": Number.isFinite(p.daysRemaining) ? Number(p.daysRemaining.toFixed(1)) : "∞",
        Action: p.action,
      };
      if (isAdmin) {
        row["Cost"] = p.cost;
        row["Revenue"] = p.revenue;
        row["Total Cost (COGS)"] = p.totalCost;
        row["Gross Profit"] = p.grossProfit;
        row["Margin %"] = Number(p.margin.toFixed(2));
        row["Avg Inventory Value"] = p.avgInventoryValue ?? "";
        row["GMROI"] = p.gmroi === null ? "N/A" : Number(p.gmroi.toFixed(4));
      }
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perfRows), "Product Performance");

    // === Sheet 2: Sales Summary (per-unit sold in range) ===
    const summaryRows = sorted.map((r) => {
      const base: Record<string, unknown> = {
        Item: r.name,
        SKU: r.sku,
        "Qty Online": r.qtyOnline,
        "Qty Invoice": r.qtyInvoice,
        "Qty Total": r.qtyTotal,
        Orders: r.orders,
      };
      if (isAdmin) {
        base["Online ₱"] = r.revenueOnline;
        base["Invoice ₱"] = r.revenueInvoice;
        base["Total ₱"] = r.revenueTotal;
      }
      return base;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Sales Summary");

    // === Sheet 3: Transactions (per-order line detail) ===
    const txnRows = sorted.flatMap((r) =>
      r.txns.map((t) => {
        const base: Record<string, unknown> = {
          Item: r.name,
          SKU: r.sku,
          Date: t.date,
          Source: t.source,
          Customer: t.customer,
          "Sales Agent": t.agent,
          Reference: t.reference,
          Quantity: t.quantity,
        };
        if (isAdmin) {
          base["Unit ₱"] = t.unitPrice;
          base["Amount ₱"] = t.amount;
          base["Cost ₱"] = t.cost ?? "";
          base["Profit ₱"] = t.profit ?? "";
        }
        return base;
      }),
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txnRows), "Transactions");

    // === Sheet 4: KPI Summary ===
    const kpiRows: Record<string, unknown>[] = [
      { Metric: "Date Range", Value: `${format(dateFrom, "yyyy-MM-dd")} → ${format(dateTo, "yyyy-MM-dd")}` },
      { Metric: "Source Filter", Value: source },
      { Metric: "Products (rows)", Value: filteredProducts.length },
      { Metric: "Parent Products", Value: filteredProducts.filter((p) => p.kind === "parent").length },
      { Metric: "Variations", Value: filteredProducts.filter((p) => p.kind === "variation").length },
      { Metric: "Total Qty Sold", Value: filteredProducts.reduce((s, p) => s + p.qtySold, 0) },
    ];
    if (isAdmin) {
      const totalRev = filteredProducts.reduce((s, p) => s + p.revenue, 0);
      const totalCogs = filteredProducts.reduce((s, p) => s + p.totalCost, 0);
      const totalProfit = filteredProducts.reduce((s, p) => s + p.grossProfit, 0);
      kpiRows.push(
        { Metric: "Total Revenue (Paid)", Value: totalRev },
        { Metric: "Total COGS", Value: totalCogs },
        { Metric: "Total Gross Profit", Value: totalProfit },
        { Metric: "Blended Margin %", Value: totalRev > 0 ? Number(((totalProfit / totalRev) * 100).toFixed(2)) : 0 },
      );
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), "KPI Summary");

    const range = `${format(dateFrom, "yyyyMMdd")}-${format(dateTo, "yyyyMMdd")}`;
    XLSX.writeFile(wb, `business-insights_${source}_${range}.xlsx`);
    toast.success(`Exported ${perfRows.length} product row${perfRows.length === 1 ? "" : "s"}`);
  };


  // Days in range (for daily-sales calc)
  const daysInRange = Math.max(1, Math.round((dateTo.getTime() - dateFrom.getTime()) / 86400000) + 1);

  // Per-unit (parent OR variation) aggregated sales. Key = `${itemId}|${variationId||""}`.
  // Variations are NEVER rolled into their parent — each row is independent.
  const unitKey = (itemId: string | null, variationId: string | null) =>
    `${itemId || ""}|${variationId || ""}`;

  const perUnitSales = useMemo(() => {
    const m = new Map<string, { qty: number; revenue: number; orders: number; cost: number; profit: number; hasCost: boolean }>();
    for (const r of aggregated) {
      if (!r.itemId) continue;
      const k = unitKey(r.itemId, r.variationId);
      const e = m.get(k) || { qty: 0, revenue: 0, orders: 0, cost: 0, profit: 0, hasCost: false };
      e.qty += r.qtyTotal;
      e.revenue += r.revenueTotal;
      e.orders += r.orders;
      for (const t of r.txns) {
        if (t.cost != null) { e.cost += t.cost; e.hasCost = true; }
        if (t.profit != null) e.profit += t.profit;
      }
      m.set(k, e);
    }
    return m;
  }, [aggregated]);

  // Enhanced product metrics — one row per parent product AND one row per
  // variation. The ProductMetric shape lives in @/types/insights so the mobile
  // card component can consume it too.

  // Build per-item indices for movements (signed) and cost history (sorted asc).
  const { movementsByItem, costHistoryByItem } = useMemo(() => {
    const outSet = new Set(["out_invoice", "out_online_sale", "adjust_missing"]);
    const inSet = new Set(["in_po", "adjust_surplus"]);
    const mv = new Map<string, { at: number; signed: number }[]>();
    for (const m of movementsAll as any[]) {
      if (!m.item_id || !m.created_at) continue;
      const qty = Number(m.quantity || 0);
      let signed = 0;
      if (inSet.has(m.type)) signed = qty;
      else if (outSet.has(m.type)) signed = -qty;
      else continue;
      const arr = mv.get(m.item_id) || [];
      arr.push({ at: new Date(m.created_at).getTime(), signed });
      mv.set(m.item_id, arr);
    }
    const ch = new Map<string, { at: number; cost: number }[]>();
    for (const h of costHistoryAll as any[]) {
      if (!h.item_id || !h.created_at) continue;
      const arr = ch.get(h.item_id) || [];
      arr.push({ at: new Date(h.created_at).getTime(), cost: Number(h.new_cost || 0) });
      ch.set(h.item_id, arr);
    }
    for (const arr of ch.values()) arr.sort((a, b) => a.at - b.at);
    return { movementsByItem: mv, costHistoryByItem: ch };
  }, [movementsAll, costHistoryAll]);

  const productMetrics = useMemo<ProductMetric[]>(() => {
    const fromMs = dateFrom.getTime();
    const toMs = dateTo.getTime();
    const itemsById = new Map<string, any>((itemsAll as any[]).map((it) => [it.id, it]));
    const out: ProductMetric[] = [];

    const buildRow = (
      base: {
        key: string; itemId: string; variationId: string | null; kind: "parent" | "variation";
        name: string; sku: string; variationLabel: string | null; source: string;
        stock: number; cost: number; sellingPrice: number; threshold: number;
        parentCreatedMs: number;
      },
    ): ProductMetric => {
      const sale = perUnitSales.get(base.key) || { qty: 0, revenue: 0, orders: 0, cost: 0, profit: 0, hasCost: false };
      const dailySales = sale.qty / daysInRange;
      const daysRemaining = dailySales > 0 ? base.stock / dailySales : (base.stock > 0 ? Infinity : 0);
      const margin = sale.revenue > 0 ? (sale.profit / sale.revenue) * 100 : 0;

      // GMROI only for parent rows (variation-level movement history unavailable).
      let avgInventoryValue: number | null = null;
      let gmroi: number | null = null;
      if (base.kind === "parent") {
        const movements = movementsByItem.get(base.itemId) || [];
        const history = costHistoryByItem.get(base.itemId) || [];
        let afterTo = 0;
        let afterFrom = 0;
        for (const mv of movements) {
          if (mv.at > toMs) afterTo += mv.signed;
          if (mv.at >= fromMs) afterFrom += mv.signed;
        }
        const endQty = base.stock - afterTo;
        const beginQty = base.stock - afterFrom;
        const costAt = (ms: number): number | null => {
          let picked: number | null = null;
          for (const h of history) {
            if (h.at <= ms) picked = h.cost;
            else break;
          }
          return picked;
        };
        const itemExistedAtStart = base.parentCreatedMs > 0 && base.parentCreatedMs <= fromMs;
        const itemExistsInRange = base.parentCreatedMs === 0 || base.parentCreatedMs <= toMs;
        if (itemExistsInRange) {
          const endCost = costAt(toMs) ?? (base.cost > 0 ? base.cost : null);
          let beginCost: number | null = costAt(fromMs - 1);
          if (beginCost === null && itemExistedAtStart) beginCost = base.cost > 0 ? base.cost : null;
          const beginValue = itemExistedAtStart
            ? (beginCost !== null ? Math.max(0, beginQty) * beginCost : null)
            : 0;
          const endValue = endCost !== null ? Math.max(0, endQty) * endCost : null;
          if (beginValue !== null && endValue !== null) {
            avgInventoryValue = (beginValue + endValue) / 2;
            if (avgInventoryValue > 0) gmroi = sale.profit / avgInventoryValue;
          }
        }
      }

      let action: ProductMetric["action"] = "Maintain";
      if (sale.qty === 0 && base.stock > 0) action = "Dead";
      else if (daysRemaining < 14) action = "Buy";
      else if (daysRemaining > 180) action = "Overstock";
      else if (daysRemaining > 90) action = "Reduce";

      return {
        key: base.key,
        itemId: base.itemId,
        variationId: base.variationId,
        kind: base.kind,
        name: base.name,
        sku: base.sku,
        variationLabel: base.variationLabel,
        source: base.source,
        stock: base.stock,
        cost: base.cost,
        sellingPrice: base.sellingPrice,
        threshold: base.threshold,
        qtySold: sale.qty,
        revenue: sale.revenue,
        totalCost: sale.cost,
        grossProfit: sale.profit,
        margin,
        dailySales,
        daysRemaining,
        gmroi,
        avgInventoryValue,
        action,
      };
    };

    // Parent rows (one per item).
    for (const it of itemsAll as any[]) {
      out.push(buildRow({
        key: unitKey(it.id, null),
        itemId: it.id,
        variationId: null,
        kind: "parent",
        name: it.name,
        sku: it.sku || "—",
        variationLabel: null,
        source: it.source || "local",
        stock: Number(it.quantity || 0),
        cost: Number(it.cost_price || 0),
        sellingPrice: Number(it.selling_price || 0),
        threshold: Number(it.low_stock_threshold || 0),
        parentCreatedMs: it.created_at ? new Date(it.created_at).getTime() : 0,
      }));
    }

    // Variation rows (one per variation).
    for (const v of variationsAll as any[]) {
      const parent = itemsById.get(v.item_id);
      if (!parent) continue;
      out.push(buildRow({
        key: unitKey(v.item_id, v.id),
        itemId: v.item_id,
        variationId: v.id,
        kind: "variation",
        name: `${parent.name} — ${v.name}`,
        sku: v.sku || parent.sku || "—",
        variationLabel: v.name,
        source: parent.source || "local",
        // Stock lives on the parent item, not the variation.
        stock: 0,
        cost: Number(v.cost_price || 0),
        sellingPrice: Number(v.selling_price || 0),
        threshold: 0,
        parentCreatedMs: parent.created_at ? new Date(parent.created_at).getTime() : 0,
      }));
    }

    return out;
  }, [itemsAll, variationsAll, perUnitSales, daysInRange, movementsByItem, costHistoryByItem, dateFrom, dateTo]);

  // Per-unit transactions for expanded row.
  const perUnitTxns = useMemo(() => {
    const m = new Map<string, SaleTxn[]>();
    for (const r of aggregated) {
      if (!r.itemId) continue;
      const k = unitKey(r.itemId, r.variationId);
      const arr = m.get(k) || [];
      for (const t of r.txns) arr.push(t);
      m.set(k, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return m;
  }, [aggregated]);

  const productSearch = search.trim().toLowerCase();
  const filteredProducts = useMemo(() => {
    let list = productMetrics;
    if (productSource !== "all") list = list.filter((p) => (p.source || "local") === productSource);
    if (productSearch) list = list.filter((p) => p.name.toLowerCase().includes(productSearch) || p.sku.toLowerCase().includes(productSearch));
    return list;
  }, [productMetrics, productSource, productSearch]);

  const productSort = useSort(filteredProducts, {
    name: (r) => r.name,
    sku: (r) => r.sku,
    source: (r) => r.source,
    stock: (r) => r.stock,
    qtySold: (r) => r.qtySold,
    revenue: (r) => r.revenue,
    cost: (r) => r.totalCost,
    grossProfit: (r) => r.grossProfit,
    margin: (r) => r.margin,
    gmroi: (r) => r.gmroi ?? -Infinity,
  }, { key: "revenue", dir: "desc" });

  // Top 5 (Overview): sort against full productMetrics
  const top5Sort = useSort(productMetrics, {
    name: (r) => r.name,
    qtySold: (r) => r.qtySold,
    revenue: (r) => r.revenue,
    grossProfit: (r) => r.grossProfit,
  }, { key: "revenue", dir: "desc" });
  const top5 = useMemo(() => top5Sort.sorted.slice(0, 5), [top5Sort.sorted]);

  // Customers tab sorts
  const onlineCustSort = useSort(customerStats.onlineList, {
    name: (r) => r.name,
    orders: (r) => r.orders,
    revenue: (r) => r.revenue,
    avg: (r) => r.avg,
  }, { key: "revenue", dir: "desc" });
  const invoiceCustSort = useSort(customerStats.invoiceList, {
    name: (r) => r.name,
    orders: (r) => r.orders,
    revenue: (r) => r.revenue,
    avg: (r) => r.avg,
  }, { key: "revenue", dir: "desc" });

  // Filters that live in the mobile drawer — the count drives the badge on the
  // "Filters" button so nothing silently stays applied while hidden.
  const drawerFilterCount = [
    source !== "all",
    payment !== "all",
    categoryFilter !== "all",
    brandFilter !== "all",
    supplierFilter !== "all",
    productSource !== "all",
  ].filter(Boolean).length;

  const resetDrawerFilters = () => {
    setSource("all");
    setPayment("all");
    setCategoryFilter("all");
    setBrandFilter("all");
    setSupplierFilter("all");
    setProductSource("all");
  };

  const customRangePickers = (
    <div className="flex items-center gap-1">
      <Popover open={fromOpen} onOpenChange={setFromOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-7 text-xs flex-1 md:w-[120px] md:flex-none justify-start", !customFrom && "text-muted-foreground")}>
            <CalendarIcon className="h-3 w-3 mr-1" />
            {customFrom ? format(customFrom, "MM/dd/yyyy") : "From"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={customFrom}
            onSelect={(d) => {
              setCustomFrom(d);
              setFromOpen(false);
              if (d) setToOpen(true);
            }}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
      <span className="text-xs text-muted-foreground">—</span>
      <Popover open={toOpen} onOpenChange={setToOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-7 text-xs flex-1 md:w-[120px] md:flex-none justify-start", !customTo && "text-muted-foreground")}>
            <CalendarIcon className="h-3 w-3 mr-1" />
            {customTo ? format(customTo, "MM/dd/yyyy") : "To"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={customTo}
            defaultMonth={customFrom}
            disabled={customFrom ? { before: customFrom } : undefined}
            onSelect={(d) => {
              setCustomTo(d);
              setToOpen(false);
            }}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="page-header">
        <h1 className="page-title">Business Insights</h1>
        <p className="page-description">All sales (online + invoices) per item. Click a row to see when, who, and how many.</p>
      </div>

      {/* Filters — desktop: everything inline. */}
      <div className="rounded-xl border bg-card p-3 sm:p-4 hidden md:flex flex-wrap items-center gap-2">
        <ChipGroup value={preset} onChange={setPreset} options={RANGE_OPTIONS} />
        {preset === "custom" && customRangePickers}
        <div className="h-5 w-px bg-border mx-1" />
        <ChipGroup value={source} onChange={setSource} options={SOURCE_OPTIONS} />
        <div className="h-5 w-px bg-border mx-1" />
        <ChipGroup value={payment} onChange={setPayment} options={PAYMENT_OPTIONS} />
        <div className="h-5 w-px bg-border mx-1" />
        <div className="flex items-center gap-1 flex-wrap">
          <FilterCombobox value={categoryFilter} onChange={setCategoryFilter} options={categoryOptions} allLabel="All categories" className="h-7 text-xs w-[150px]" />
          <FilterCombobox value={brandFilter} onChange={setBrandFilter} options={brandOptions} allLabel="All brands" className="h-7 text-xs w-[150px]" />
          <FilterCombobox value={supplierFilter} onChange={setSupplierFilter} options={supplierOptions} allLabel="All suppliers" className="h-7 text-xs w-[160px]" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search item or SKU..."
              className="h-7 text-xs pl-7 w-[220px]"
            />
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Export
          </Button>
        </div>
      </div>

      {/* Filters — mobile: one scrollable row of date presets plus a drawer, so
          the controls take ~2 rows instead of ~8 before any data is reachable. */}
      <div className="md:hidden space-y-2">
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {RANGE_OPTIONS.map((p) => (
            <Button
              key={p.v}
              variant={preset === p.v ? "default" : "outline"}
              size="sm"
              className="h-8 shrink-0 rounded-full px-3 text-xs"
              onClick={() => setPreset(p.v)}
            >
              {p.l}
            </Button>
          ))}
        </div>
        {preset === "custom" && customRangePickers}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search item or SKU..."
              className="h-9 text-sm pl-8"
            />
          </div>
          <Sheet open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 px-3 text-xs" aria-label="Filters">
                <Filter className="h-4 w-4" />
                {drawerFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5">{drawerFilterCount}</Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
              </SheetHeader>
              <div className="space-y-5 py-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Sales source</Label>
                  <ChipGroup value={source} onChange={setSource} options={SOURCE_OPTIONS} fill />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Payment status</Label>
                  <ChipGroup value={payment} onChange={setPayment} options={PAYMENT_OPTIONS} fill />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Product type</Label>
                  <ChipGroup value={productSource} onChange={setProductSource} options={PRODUCT_SOURCE_OPTIONS} fill />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Category</Label>
                  <FilterCombobox value={categoryFilter} onChange={setCategoryFilter} options={categoryOptions} allLabel="All categories" className="h-9 w-full text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Brand</Label>
                  <FilterCombobox value={brandFilter} onChange={setBrandFilter} options={brandOptions} allLabel="All brands" className="h-9 w-full text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Supplier</Label>
                  <FilterCombobox value={supplierFilter} onChange={setSupplierFilter} options={supplierOptions} allLabel="All suppliers" className="h-9 w-full text-sm" />
                </div>
              </div>
              <SheetFooter className="flex-row justify-between gap-2">
                <Button variant="ghost" onClick={resetDrawerFilters}>Clear all</Button>
                <Button onClick={() => setFilterDrawerOpen(false)}>Done</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
          <Button variant="outline" size="sm" className="h-9 shrink-0 px-3 text-xs" onClick={handleExport} aria-label="Export">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {activeBranch ? `${activeBranch.branch_name} (${activeBranch.branch_code})` : "All branches"} · {format(dateFrom, "MMM d, yyyy")} — {format(dateTo, "MMM d, yyyy")} · {daysInRange} day{daysInRange === 1 ? "" : "s"}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 md:inline-flex md:w-auto">
          <TabsTrigger value="overview"><TrendingUp className="h-3.5 w-3.5 mr-1.5" />Overview</TabsTrigger>
          <TabsTrigger value="products"><Package className="h-3.5 w-3.5 mr-1.5" />Products</TabsTrigger>
          <TabsTrigger value="customers"><Users className="h-3.5 w-3.5 mr-1.5" />Customers</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          {(() => {
            const collected = totals.revTotal;
            const outstandingTotal = outstanding.total;
            const potential = collected + outstandingTotal;
            const grossProfitTotal = productMetrics.reduce((s, p) => s + p.grossProfit, 0);
            const avgMargin = collected > 0 ? (grossProfitTotal / collected) * 100 : 0;
            const inventoryValue = (itemsAll as any[]).reduce((s, i) => s + Number(i.quantity || 0) * Number(i.cost_price || 0), 0);
            const aov = paidOrderCount > 0 ? collected / paidOrderCount : 0;
            return (
              <>
                {/* First row: revenue breakdown */}
                <div className={cn("grid gap-3 sm:gap-4 grid-cols-2", isAdmin ? "lg:grid-cols-4" : "lg:grid-cols-1")}>
                  {isAdmin && <StatCard title="Online Revenue" value={money(totals.revOnline)} icon={ShoppingCart} variant="success" description="Paid online orders" />}
                  {isAdmin && <StatCard title="Invoice Revenue" value={money(totals.revInvoice)} icon={Receipt} variant="success" description="Paid invoices" />}
                  {isAdmin && <StatCard title="Collected Revenue" value={money(collected)} icon={DollarSign} variant="success" description="Online + invoice (paid)" />}
                  {isAdmin && <StatCard title="Outstanding Revenue" value={money(outstandingTotal)} icon={AlertTriangle} variant="warning" description="Unpaid / pending balance" />}
                  {!isAdmin && <StatCard title="Units Sold" value={totals.qty} icon={Package} />}
                </div>

                {/* Second row: profitability + operational */}
                {isAdmin && (
                  <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                    <StatCard title="Gross Profit" value={money(grossProfitTotal)} icon={TrendingUp} variant="success" description="Paid orders only" />
                    <StatCard title="Average Margin" value={`${avgMargin.toFixed(1)}%`} icon={TrendingUp} description="Paid orders only" />
                    <StatCard title="Inventory Value" value={money(inventoryValue)} icon={Warehouse} />
                    <StatCard title="Average Order Value" value={money(aov)} description={`${paidOrderCount} paid order${paidOrderCount === 1 ? "" : "s"}`} icon={ShoppingBag} />
                  </div>
                )}

                {/* Revenue summary */}
                {isAdmin && (
                  <div className="rounded-xl border bg-card p-4">
                    <h2 className="text-sm font-semibold mb-3">Revenue Summary</h2>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between py-1.5 border-b">
                        <span className="text-muted-foreground">Collected Revenue</span>
                        <span className="font-semibold tabular-nums text-green-600">{money(collected)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-b">
                        <span className="text-muted-foreground">Outstanding Revenue</span>
                        <span className="font-semibold tabular-nums text-amber-600">{money(outstandingTotal)}</span>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <span className="font-medium">Potential Revenue</span>
                        <span className="font-bold tabular-nums text-base">{money(potential)}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Outstanding revenue is display-only — it is excluded from Revenue, COGS, Gross Profit, Margin, and Inventory calculations.
                    </p>
                  </div>
                )}
              </>
            );
          })()}

          {/* Top 5 products */}
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Top Products</h2>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <SortableTh sortKey="name" label="Item" sort={top5Sort.sort} onToggle={top5Sort.toggle} />
                    <SortableTh sortKey="qtySold" label="Units Sold" sort={top5Sort.sort} onToggle={top5Sort.toggle} align="right" />
                    {isAdmin && <SortableTh sortKey="revenue" label="Revenue" sort={top5Sort.sort} onToggle={top5Sort.toggle} align="right" />}
                    {/* Gross Profit would be clipped on a phone — the wrapper is overflow-hidden. */}
                    {isAdmin && <SortableTh sortKey="grossProfit" label="Gross Profit" sort={top5Sort.sort} onToggle={top5Sort.toggle} align="right" className="hidden sm:table-cell" />}
                  </tr>
                </thead>
                <tbody>
                  {top5.map((p) => (
                    <tr key={p.key} className="border-t">
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{p.name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{p.sku}</div>
                      </td>
                      <td className="px-3 py-1.5 text-right">{p.qtySold}</td>
                      {isAdmin && <td className="px-3 py-1.5 text-right font-semibold">{money(p.revenue)}</td>}
                      {isAdmin && <td className="px-3 py-1.5 text-right text-green-600 hidden sm:table-cell">{money(p.grossProfit)}</td>}
                    </tr>
                  ))}
                  {productMetrics.every((p) => p.qtySold === 0) && (
                    <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No sales in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>



        {/* PRODUCTS */}
        <TabsContent value="products" className="space-y-4">
          {isAdmin && (missingCostCount > 0 || missingOnlineCostCount > 0) && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 space-y-1">
              {missingCostCount > 0 && (
                <div><strong>{missingCostCount}</strong> invoice line{missingCostCount === 1 ? "" : "s"} excluded from gross profit / margin / GMROI because their variation has no cost assigned.</div>
              )}
              {missingOnlineCostCount > 0 && (
                <div><strong>{missingOnlineCostCount}</strong> paid online sale{missingOnlineCostCount === 1 ? "" : "s"} excluded from gross profit / margin because the product had no cost at time of upload.</div>
              )}
              <div className="opacity-80">Revenue is still counted. Set costs in Inventory → Variations to include them.</div>
            </div>
          )}

          {/* Mobile: card list — the desktop table needs sideways scrolling to
              reach Revenue/GP/Margin, which is the main pain on a phone. */}
          <div className="md:hidden space-y-2.5">
            <div className="flex items-center gap-2">
              <Select
                value={productSort.sort.key ?? "revenue"}
                onValueChange={(v) => productSort.setSort({ key: v, dir: productSort.sort.dir })}
              >
                <SelectTrigger className="h-9 flex-1 text-xs">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="qtySold">Units sold</SelectItem>
                  {isAdmin && <SelectItem value="revenue">Revenue</SelectItem>}
                  {isAdmin && <SelectItem value="grossProfit">Gross profit</SelectItem>}
                  {isAdmin && <SelectItem value="margin">Margin</SelectItem>}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-9 shrink-0 px-3 text-xs"
                onClick={() =>
                  productSort.setSort({
                    key: productSort.sort.key ?? "revenue",
                    dir: productSort.sort.dir === "asc" ? "desc" : "asc",
                  })
                }
              >
                {productSort.sort.dir === "asc" ? <ArrowUp className="h-3.5 w-3.5 mr-1" /> : <ArrowDown className="h-3.5 w-3.5 mr-1" />}
                {productSort.sort.dir === "asc" ? "Asc" : "Desc"}
              </Button>
            </div>

            <div className="px-1 text-xs text-muted-foreground">
              {productSort.sorted.length} row{productSort.sorted.length === 1 ? "" : "s"} · tap a card for sales history
            </div>

            {productSort.sorted.length === 0 ? (
              <div className="rounded-xl border bg-card py-10 text-center text-xs text-muted-foreground">No items.</div>
            ) : (
              productSort.sorted.slice(0, 500).map((p) => (
                <InsightsProductCard
                  key={p.key}
                  product={p}
                  txns={perUnitTxns.get(p.key) || []}
                  isAdmin={isAdmin}
                  money={money}
                  isOpen={expandedProduct.has(p.key)}
                  onToggle={() => toggleExpandProduct(p.key)}
                />
              ))
            )}
          </div>

          <div className="rounded-xl border bg-card overflow-hidden hidden md:block">
            <div className="p-3 border-b flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[200px]">
                <h2 className="text-sm font-semibold">Product Performance</h2>
                <p className="text-xs text-muted-foreground">One row per product. Click a row to see per-order sales{isAdmin ? " and gross profit" : ""}.</p>
              </div>
              <ChipGroup value={productSource} onChange={setProductSource} options={PRODUCT_SOURCE_OPTIONS} />
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExport}>
                <Download className="h-3.5 w-3.5 mr-1" />Export
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <SortableHeader sortKey="name" label="Item" sort={productSort.sort} onToggle={productSort.toggle} />
                    <SortableHeader sortKey="source" label="Type" sort={productSort.sort} onToggle={productSort.toggle} />
                    <SortableHeader sortKey="stock" label="Stock" sort={productSort.sort} onToggle={productSort.toggle} align="right" />
                    <SortableHeader sortKey="qtySold" label="Sold" sort={productSort.sort} onToggle={productSort.toggle} align="right" />
                    {isAdmin && <SortableHeader sortKey="revenue" label="Revenue" sort={productSort.sort} onToggle={productSort.toggle} align="right" />}
                    {isAdmin && <SortableHeader sortKey="cost" label="Cost" sort={productSort.sort} onToggle={productSort.toggle} align="right" />}
                    {isAdmin && <SortableHeader sortKey="grossProfit" label="Gross Profit" sort={productSort.sort} onToggle={productSort.toggle} align="right" />}
                    {isAdmin && <SortableHeader sortKey="margin" label="Margin" sort={productSort.sort} onToggle={productSort.toggle} align="right" />}
                    {isAdmin && <SortableHeader sortKey="gmroi" label="GMROI" sort={productSort.sort} onToggle={productSort.toggle} align="right" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productSort.sorted.length === 0 ? (
                    <TableRow><TableCell colSpan={isAdmin ? 10 : 5} className="text-center text-xs text-muted-foreground py-10">No items.</TableCell></TableRow>
                  ) : productSort.sorted.slice(0, 500).map((p) => {
                    const isOpen = expandedProduct.has(p.key);
                    const txns = perUnitTxns.get(p.key) || [];
                    return (
                      <Fragment key={p.key}>
                        <TableRow className="hover:bg-muted/30 cursor-pointer" onClick={() => toggleExpandProduct(p.key)}>
                          <TableCell className="w-8 p-2 align-middle">
                            {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell>
                            <div className={cn("font-medium text-sm flex items-center gap-1.5", p.kind === "variation" && "pl-3")}>
                              {p.kind === "variation" && <span className="text-muted-foreground/60">↳</span>}
                              <span>{p.name}</span>
                              {p.kind === "variation" && (
                                <span className="inline-flex items-center rounded bg-accent/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Variation
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">{p.sku}</div>
                          </TableCell>
                          <TableCell>
                            <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", p.source === "import" ? "bg-blue-500/10 text-blue-600" : "bg-secondary text-secondary-foreground")}>
                              {p.source || "local"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-sm">{p.stock}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{p.qtySold}</TableCell>
                          {isAdmin && <TableCell className="text-right text-sm">{money(p.revenue)}</TableCell>}
                          {isAdmin && <TableCell className="text-right text-sm text-muted-foreground">{money(p.totalCost)}</TableCell>}
                          {isAdmin && <TableCell className="text-right text-sm text-green-600">{money(p.grossProfit)}</TableCell>}
                          {isAdmin && <TableCell className="text-right text-sm">{p.qtySold ? `${p.margin.toFixed(1)}%` : "—"}</TableCell>}
                          {isAdmin && (
                            <TableCell className="text-right text-sm">
                              {p.gmroi === null ? (
                                <span
                                  className="text-muted-foreground cursor-help"
                                  title={p.kind === "variation" ? "GMROI is tracked at the parent product level." : "GMROI cannot be calculated because there is insufficient inventory history."}
                                >
                                  N/A
                                </span>
                              ) : (
                                `${p.gmroi.toFixed(2)}×`
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={isAdmin ? 10 : 5} className="p-0">
                              <div className="px-4 py-3 space-y-3">
                                <div className="text-xs font-semibold text-muted-foreground">
                                  Sales history ({txns.length}){isAdmin ? " — with per-order gross profit" : ""}
                                </div>
                                <div className="rounded-md border bg-background overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead className="bg-muted/40">
                                      <tr className="text-left">
                                        <th className="px-3 py-2 font-medium">Date</th>
                                        <th className="px-3 py-2 font-medium">Source</th>
                                        <th className="px-3 py-2 font-medium">Customer</th>
                                        <th className="px-3 py-2 font-medium">Sales Agent</th>
                                        <th className="px-3 py-2 font-medium">Reference</th>
                                        <th className="px-3 py-2 font-medium">Variation</th>
                                        <th className="px-3 py-2 font-medium text-right">Qty</th>
                                        {isAdmin && <th className="px-3 py-2 font-medium text-right">Unit ₱</th>}
                                        {isAdmin && <th className="px-3 py-2 font-medium text-right">Amount</th>}
                                        {isAdmin && <th className="px-3 py-2 font-medium text-right">Cost</th>}
                                        {isAdmin && <th className="px-3 py-2 font-medium text-right">Gross Profit</th>}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {txns.length === 0 ? (
                                        <tr><td colSpan={isAdmin ? 10 : 6} className="px-3 py-4 text-center text-muted-foreground">No sales in this range.</td></tr>
                                      ) : txns.map((t, i) => (
                                        <tr key={i} className="border-t">
                                          <td className="px-3 py-1.5 whitespace-nowrap">{t.date ? format(new Date(t.date), "MMM d, yyyy") : "—"}</td>
                                          <td className="px-3 py-1.5">
                                            <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", t.source === "online" ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground")}>
                                              {t.source === "online" ? "Online" : "Invoice"}
                                            </span>
                                          </td>
                                          <td className="px-3 py-1.5">{t.customer}</td>
                                          <td className="px-3 py-1.5 text-muted-foreground">{t.agent}</td>
                                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{t.reference}</td>
                                          <td className="px-3 py-1.5 text-muted-foreground">{t.variationName || <span className="text-muted-foreground/60">—</span>}</td>
                                          <td className="px-3 py-1.5 text-right font-semibold">{t.quantity}</td>
                                          {isAdmin && <td className="px-3 py-1.5 text-right">{money(t.unitPrice)}</td>}
                                          {isAdmin && <td className={cn("px-3 py-1.5 text-right", t.paymentStatus === "unpaid" && "text-muted-foreground italic")} title={t.paymentStatus === "unpaid" ? "Excluded from revenue totals until marked Paid." : undefined}>{t.paymentStatus === "unpaid" ? <span className="text-amber-600">{money(t.amount)}*</span> : money(t.amount)}</td>}
                                          {isAdmin && <td className="px-3 py-1.5 text-right text-muted-foreground" title={t.paymentStatus === "unpaid" ? "Cost is recognized once the order is marked as Paid." : undefined}>{t.cost != null ? money(t.cost) : (t.paymentStatus === "unpaid" ? <span className="italic text-amber-600">Pending payment</span> : "—")}</td>}
                                          {isAdmin && <td className={cn("px-3 py-1.5 text-right", t.profit != null && t.profit >= 0 ? "text-green-600" : t.profit != null ? "text-red-600" : "text-muted-foreground")} title={t.paymentStatus === "unpaid" ? "Gross profit is recognized once the order is marked as Paid." : undefined}>{t.profit != null ? money(t.profit) : (t.paymentStatus === "unpaid" ? <span className="italic text-amber-600">Pending payment</span> : "—")}</td>}
                                        </tr>

                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>


        {/* CUSTOMERS */}
        <TabsContent value="customers" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Online Customers</h2>
                  <p className="text-xs text-muted-foreground">Grouped by sales channel</p>
                </div>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Channels Ordered</div>
                  <div className="text-xl font-semibold mt-0.5">{customerStats.onlineCustomerCount}</div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg per Channel</div>
                  <div className="text-xl font-semibold mt-0.5">{money(customerStats.onlineAvg)}</div>
                </div>
              </div>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <SortableTh sortKey="name" label="Channel" sort={onlineCustSort.sort} onToggle={onlineCustSort.toggle} />
                      <SortableTh sortKey="orders" label="Orders" sort={onlineCustSort.sort} onToggle={onlineCustSort.toggle} align="right" />
                      {isAdmin && <SortableTh sortKey="revenue" label="Revenue" sort={onlineCustSort.sort} onToggle={onlineCustSort.toggle} align="right" />}
                      {isAdmin && <SortableTh sortKey="avg" label="Avg/Order" sort={onlineCustSort.sort} onToggle={onlineCustSort.toggle} align="right" className="hidden sm:table-cell" />}
                    </tr>
                  </thead>
                  <tbody>
                    {onlineCustSort.sorted.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No online sales</td></tr>
                    ) : onlineCustSort.sorted.map((c) => (
                      <tr key={c.name} className="border-t">
                        <td className="px-3 py-1.5 capitalize">{c.name}</td>
                        <td className="px-3 py-1.5 text-right">{c.orders}</td>
                        {isAdmin && <td className="px-3 py-1.5 text-right font-semibold">{money(c.revenue)}</td>}
                        {isAdmin && <td className="px-3 py-1.5 text-right text-muted-foreground hidden sm:table-cell">{money(c.avg)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>

            <div className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Invoice Customers</h2>
                  <p className="text-xs text-muted-foreground">
                    {isAdmin ? "Unique customers with revenue and gross profit" : "Unique customers with confirmed/paid invoices"}
                  </p>
                </div>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Customers Ordered</div>
                  <div className="text-xl font-semibold mt-0.5">{customerStats.invoiceCustomerCount}</div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg per Customer</div>
                  <div className="text-xl font-semibold mt-0.5">{money(customerStats.invoiceAvg)}</div>
                </div>
              </div>
              <div className="rounded-md border overflow-hidden max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-left">
                      <SortableTh sortKey="name" label="Customer" sort={invoiceCustSort.sort} onToggle={invoiceCustSort.toggle} />
                      <SortableTh sortKey="orders" label="Orders" sort={invoiceCustSort.sort} onToggle={invoiceCustSort.toggle} align="right" />
                      {isAdmin && <SortableTh sortKey="revenue" label="Revenue" sort={invoiceCustSort.sort} onToggle={invoiceCustSort.toggle} align="right" />}
                      {isAdmin && <SortableTh sortKey="avg" label="Avg/Order" sort={invoiceCustSort.sort} onToggle={invoiceCustSort.toggle} align="right" className="hidden sm:table-cell" />}
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceCustSort.sorted.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No invoice sales</td></tr>
                    ) : invoiceCustSort.sorted.map((c, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5">{c.name}</td>
                        <td className="px-3 py-1.5 text-right">{c.orders}</td>
                        {isAdmin && <td className="px-3 py-1.5 text-right font-semibold">{money(c.revenue)}</td>}
                        {isAdmin && <td className="px-3 py-1.5 text-right text-muted-foreground hidden sm:table-cell">{money(c.avg)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </div>
          </div>
        </TabsContent>

      </Tabs>
    </div>
  );
}
