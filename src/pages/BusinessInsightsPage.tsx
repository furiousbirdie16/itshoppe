import { Fragment, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/currency";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, differenceInCalendarDays, parseISO } from "date-fns";
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
import { StatCard, FormulaRow } from "@/components/StatCard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SortableHeader } from "@/components/SortableHeader";
import { useSort } from "@/hooks/use-sort";
import { cn } from "@/lib/utils";
import { CalendarIcon, ShoppingCart, Receipt, DollarSign, Package, Search, ChevronRight, ChevronDown, Download, Filter, TrendingUp, AlertTriangle, ShoppingBag, Users, ArrowUp, ArrowDown, ArrowUpDown, Columns3, PackagePlus, PackageX, Boxes, Clock, Truck, LineChart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllRows } from "@/lib/paginate";
import { useBranch } from "@/contexts/BranchContext";
import { TodayMovementExport } from "@/components/TodayMovementExport";
import { costFromRows } from "@/lib/branch-cost";
import { FilterCombobox } from "@/components/FilterCombobox";
import { InsightsProductCard } from "@/components/InsightsProductCard";
import { BranchStockSplit } from "@/components/BranchStockSplit";
import { useStockSplit } from "@/hooks/use-stock-split";
import { ACTION_CLASS, fmtDays, fmtUnits, makeBuckets } from "@/lib/insights";
import { stockUnitsSold } from "@/lib/restock";
import { InsightsTrendChart, type TrendPoint } from "@/components/InsightsTrendChart";
import { InsightsPurchasesTab } from "@/components/InsightsPurchasesTab";
import { InsightsForecastTab } from "@/components/InsightsForecastTab";
import type { ProductAction, ProductMetric, SaleTxn } from "@/types/insights";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { docNo } from "@/lib/doc-number";
import { searchMatches } from "@/lib/search";

type RangePreset = "today" | "7d" | "30d" | "60d" | "90d" | "month" | "all" | "custom";
type SourceFilter = "all" | "online" | "invoice";
type PaymentFilter = "all" | "paid" | "unpaid";
type ProductSourceFilter = "all" | "local" | "import";

const RANGE_OPTIONS: { v: RangePreset; l: string }[] = [
  { v: "today", l: "Today" },
  { v: "7d", l: "Last 7 days" },
  { v: "30d", l: "Last 30 days" },
  { v: "60d", l: "Last 60 days" },
  { v: "90d", l: "Last 90 days" },
  { v: "month", l: "This month" },
  { v: "all", l: "All time" },
  { v: "custom", l: "Custom range" },
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
type ActionFilter = "all" | ProductAction;
const ACTION_OPTIONS: { v: ActionFilter; l: string }[] = [
  { v: "all", l: "All actions" },
  { v: "Buy", l: "Buy — running low" },
  { v: "Maintain", l: "Maintain" },
  { v: "Reduce", l: "Reduce" },
  { v: "Overstock", l: "Overstock" },
  { v: "Dead", l: "Dead — not selling" },
];

// Product columns that are off by default so the table fits without sideways
// scrolling; the "Columns" menu turns them on.
type OptionalCol = "type" | "cost" | "gmroi";
const OPTIONAL_COLS: { v: OptionalCol; l: string; adminOnly: boolean }[] = [
  { v: "type", l: "Type (local / import)", adminOnly: false },
  { v: "cost", l: "Cost (COGS)", adminOnly: true },
  { v: "gmroi", l: "GMROI", adminOnly: true },
];
const COLS_STORAGE_KEY = "bi_product_columns";
function loadCols(): Set<OptionalCol> {
  try {
    const raw = localStorage.getItem(COLS_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as OptionalCol[]);
  } catch {
    // Storage blocked or corrupt — fall back to the default columns.
  }
  return new Set();
}

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

// Its own component, with its own open state, because the page renders this
// twice — once in the desktop filter bar and once in the mobile one. Both are
// always mounted (only CSS hides one), so sharing open state made the hidden
// copy's dismissable layer treat the visible one's focus as an outside click
// and shut both instantly.
function CustomRangePickers({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: Date | undefined;
  to: Date | undefined;
  onFrom: (d: Date | undefined) => void;
  onTo: (d: Date | undefined) => void;
}) {
  // Controlled so choosing a start date can open the end picker straight away —
  // a range is two choices, and the second should not need a separate tap.
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <Popover open={fromOpen} onOpenChange={setFromOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-7 text-xs flex-1 md:w-[120px] md:flex-none justify-start", !from && "text-muted-foreground")}>
            <CalendarIcon className="h-3 w-3 mr-1" />
            {from ? format(from, "MM/dd/yyyy") : "From"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={from}
            onSelect={(d) => {
              onFrom(d);
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
          <Button variant="outline" size="sm" className={cn("h-7 text-xs flex-1 md:w-[120px] md:flex-none justify-start", !to && "text-muted-foreground")}>
            <CalendarIcon className="h-3 w-3 mr-1" />
            {to ? format(to, "MM/dd/yyyy") : "To"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={to}
            defaultMonth={from}
            disabled={from ? { before: from } : undefined}
            onSelect={(d) => {
              onTo(d);
              setToOpen(false);
            }}
            initialFocus
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function BusinessInsightsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const { activeBranchId, activeBranch, branches } = useBranch();
  // Stock is every branch added together under "All branches"; show the split.
  const stockSplit = useStockSplit();
  const combinedBranches = activeBranchId === null && branches.length > 1;
  const money = (n: number) => (isAdmin ? peso(n) : "—");
  // Arriving from a "Sales History" link elsewhere in the app: ?item=<sku>.
  // The page opens on the product with its whole history in view, rather than
  // today's overview with the item nowhere to be seen.
  const [searchParams] = useSearchParams();
  const itemParam = searchParams.get("item") || "";
  const [tab, setTab] = useState(itemParam ? "products" : "overview");
  // Defaults to 30 days: a single day says little, and stock-cover figures are
  // derived from the range's sales speed.
  const [preset, setPreset] = useState<RangePreset>(itemParam ? "all" : "30d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [source, setSource] = useState<SourceFilter>("all");
  const [payment, setPayment] = useState<PaymentFilter>("all");
  const [search, setSearch] = useState(itemParam);
  const [productSource, setProductSource] = useState<ProductSourceFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [visibleCols, setVisibleCols] = useState<Set<OptionalCol>>(loadCols);
  const toggleCol = (c: OptionalCol) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(Array.from(next))); } catch { /* per-viewer nicety only */ }
      return next;
    });
  };
  // Parents whose variations are unfolded beneath them in the Products tab.
  const [openVariations, setOpenVariations] = useState<Set<string>>(new Set());
  const toggleVariations = (itemId: string) => {
    setOpenVariations((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };
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
  const effectiveTo = useMemo(() => {
    const today = endOfDay(new Date());
    return dateTo > today ? today : dateTo;
  }, [dateTo]);

  // The comparison period: the same number of days immediately before this
  // range. "All time" has nothing before it.
  const prevRange = useMemo(() => {
    if (preset === "all") return null;
    const span = Math.max(1, differenceInCalendarDays(effectiveTo, dateFrom) + 1);
    return {
      from: format(subDays(dateFrom, span), "yyyy-MM-dd"),
      to: format(subDays(dateFrom, 1), "yyyy-MM-dd"),
      days: span,
    };
  }, [preset, dateFrom, effectiveTo]);

  // Helper: fetch all rows in pages to bypass PostgREST's default 1000-row cap

  // Online sales — include ALL sales regardless of payment status so units/revenue
  // reflect actual sales volume. Cost & profit are only recognized for PAID sales.
  const { data: onlineRowsRaw = [] } = useQuery({
    queryKey: ["bi_online", fromStr, toStr, payment, activeBranchId],
    queryFn: async () => {
      return fetchAllRows(() => {
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
        const rows = await fetchAllRows<any>(() =>
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

      const invs = await fetchAllRows<any>(() => {
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
        const rows = await fetchAllRows<any>(() =>
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
    queryFn: async () => fetchAllRows<any>(() =>
      supabase.from("items").select("id, name, sku, quantity, cost_price, selling_price, low_stock_threshold, source, created_at, category, brand, units_per_stock")
    ),
  });

  // All variations — enable per-variation rows with independent stock/cost.
  const { data: variationsAllRaw = [] } = useQuery({
    queryKey: ["bi_variations_all"],
    queryFn: async () => fetchAllRows<any>(() =>
      // No quantity column here — variations do not hold their own stock, it sits
      // on the parent. Selecting it made PostgREST reject the whole request, so
      // this returned nothing and no variation rows were built at all.
      supabase.from("item_variations").select("id, item_id, name, sku, cost_price, cost_is_manual, selling_price, factor, type")
    ),
  });

  // Real on-hand quantities. items.quantity stopped being maintained when
  // per-branch stock arrived, so it reports figures frozen at that migration.
  const { data: branchStockRaw = [] } = useQuery({
    // Follows the branch picker like the sales do: Manila's sales against
    // every branch's stock made days-left and the stock column read wrong.
    queryKey: ["bi_branch_stock", activeBranchId],
    queryFn: async () => fetchAllRows<any>(() => {
      let q = supabase.from("item_branch_stock").select("id, item_id, quantity, cost_price").order("id");
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      return q;
    }),
  });

  const stockByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of branchStockRaw as any[]) {
      m.set(r.item_id, (m.get(r.item_id) || 0) + Number(r.quantity || 0));
    }
    return m;
  }, [branchStockRaw]);
  // Each branch's cost: one branch's own, or every branch blended by stock.
  const costRowsByItem = useMemo(() => {
    const m = new Map<string, { quantity: number; cost_price: number | null }[]>();
    for (const r of branchStockRaw as any[]) m.set(r.item_id, [...(m.get(r.item_id) || []), r]);
    return m;
  }, [branchStockRaw]);

  // Supplier links for every item (used by the Supplier filter)
  const { data: itemSupplierLinks = [] } = useQuery({
    queryKey: ["bi_item_suppliers"],
    queryFn: async () => {
      const links = await fetchAllRows<any>(() =>
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
      return base.map((i) => ({
        ...i,
        quantity: stockByItem.get(i.id) ?? 0,
        cost_price: costFromRows(Number(i.cost_price || 0), costRowsByItem.get(i.id) || []),
      }));
    },
    [itemsAllRaw, allowedItemIds, stockByItem, costRowsByItem],
  );
  const variationsAll = useMemo(() => {
    const base = allowedItemIds ? (variationsAllRaw as any[]).filter((v) => allowedItemIds.has(v.item_id)) : (variationsAllRaw as any[]);
    // A variation not costed by hand is its share of the parent's cost — at
    // this branch, so it follows the parent's branch cost.
    const parentById = new Map((itemsAll as any[]).map((i) => [i.id, i]));
    return base.map((v) => {
      const parent = parentById.get(v.item_id);
      if (v.cost_is_manual || !parent) return v;
      const ups = Number(parent.units_per_stock || 1) || 1;
      return { ...v, cost_price: Number(parent.cost_price || 0) * (Number(v.factor || 1) / ups) };
    });
  }, [variationsAllRaw, allowedItemIds, itemsAll]);
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
    queryFn: async () => fetchAllRows<any>(() =>
      supabase.from("inventory_movements").select("item_id, type, quantity, created_at")
    ),
  });

  // All item cost history — used to reconstruct historical unit cost for GMROI.
  const { data: costHistoryAll = [] } = useQuery({
    queryKey: ["bi_cost_history_all"],
    enabled: isAdmin,
    queryFn: async () => fetchAllRows<any>(() =>
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
        const rows = await fetchAllRows<any>(() =>
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
          reference: docNo(inv.invoice_number) || "—",
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

    // Search is a Products-tab control, so it is applied there (filteredProducts)
    // and in the export — not here, where it would silently shrink the
    // Overview's revenue and chart.
    return arr;
  }, [onlineRows, invoiceRows, source, financialsMap, onlineFinMap]);

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
        "Days Remaining": p.kind === "variation" ? "" : Number.isFinite(p.daysRemaining) ? Number(p.daysRemaining.toFixed(1)) : "∞",
        Action: p.action ?? "",
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
    const q = search.trim().toLowerCase();
    const salesRows = q ? sorted.filter((r) => searchMatches(q, r.name, r.sku)) : sorted;
    const summaryRows = salesRows.map((r) => {
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
    const txnRows = salesRows.flatMap((r) =>
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


  // Days in range (for daily-sales calc). Counted up to today: "This month"
  // ends on the last of the month, and dividing by days that have not happened
  // yet understated the sales speed.
  const daysInRange = Math.max(1, differenceInCalendarDays(effectiveTo, dateFrom) + 1);

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

    // Variations draw on their parent's stock, so the parent's stock cover has
    // to count their sales too — otherwise a parent sold only through its
    // variations reads as "Dead" while it is selling.
    const variationQtyByItem = new Map<string, number>();
    for (const v of variationsAll as any[]) {
      // Stock units used: a 10-pack takes 10, a 3 m cut takes 3/305 of a roll.
      const q = stockUnitsSold(perUnitSales.get(unitKey(v.item_id, v.id))?.qty || 0, v, itemsById.get(v.item_id)?.units_per_stock);
      if (q) variationQtyByItem.set(v.item_id, (variationQtyByItem.get(v.item_id) || 0) + q);
    }

    const buildRow = (
      base: {
        key: string; itemId: string; variationId: string | null; kind: "parent" | "variation";
        name: string; sku: string; variationLabel: string | null; source: string;
        stock: number; cost: number; sellingPrice: number; threshold: number;
        parentCreatedMs: number;
      },
    ): ProductMetric => {
      const sale = perUnitSales.get(base.key) || { qty: 0, revenue: 0, orders: 0, cost: 0, profit: 0, hasCost: false };
      const variationQtySold = base.kind === "parent" ? variationQtyByItem.get(base.itemId) || 0 : 0;
      const dailySales = (sale.qty + variationQtySold) / daysInRange;
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

      // No recommendation for variations (their stock is the parent's) or for
      // items with neither stock nor sales — "Buy" there was a false alarm.
      let action: ProductMetric["action"] = null;
      if (base.kind === "parent") {
        if (dailySales === 0) action = base.stock > 0 ? "Dead" : null;
        else if (daysRemaining < 14) action = "Buy";
        else if (daysRemaining > 180) action = "Overstock";
        else if (daysRemaining > 90) action = "Reduce";
        else action = "Maintain";
      }

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
        variationQtySold,
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
    if (productSearch) list = list.filter((p) => searchMatches(productSearch, p.name, p.sku));
    if (actionFilter !== "all") list = list.filter((p) => p.action === actionFilter);
    return list;
  }, [productMetrics, productSource, productSearch, actionFilter]);


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

  // Variations fold under their parent. A variation is listed on its own only
  // when its parent is filtered out (e.g. a search that matches the variation).
  const variationsByParent = useMemo(() => {
    const m = new Map<string, ProductMetric[]>();
    for (const p of productSort.sorted) {
      if (p.kind !== "variation") continue;
      const arr = m.get(p.itemId) || [];
      arr.push(p);
      m.set(p.itemId, arr);
    }
    return m;
  }, [productSort.sorted]);
  const productRows = useMemo(() => {
    const parentIds = new Set(productSort.sorted.filter((p) => p.kind === "parent").map((p) => p.itemId));
    const out: { p: ProductMetric; nested: boolean }[] = [];
    for (const p of productSort.sorted) {
      if (p.kind === "parent") {
        out.push({ p, nested: false });
        if (openVariations.has(p.itemId)) {
          for (const v of variationsByParent.get(p.itemId) || []) out.push({ p: v, nested: true });
        }
      } else if (!parentIds.has(p.itemId)) {
        out.push({ p, nested: false });
      }
    }
    return out;
  }, [productSort.sorted, variationsByParent, openVariations]);

  // Top 5 (Overview): sort against full productMetrics
  const top5Sort = useSort(productMetrics, {
    name: (r) => r.name,
    qtySold: (r) => r.qtySold,
    revenue: (r) => r.revenue,
    grossProfit: (r) => r.grossProfit,
  }, { key: "revenue", dir: "desc" });
  const top5 = useMemo(() => top5Sort.sorted.slice(0, 5), [top5Sort.sorted]);

  // Previous-period totals for the Overview's change chips. Same rules as the
  // current period: revenue and AOV count paid orders only, units count all.
  const { data: prevRows } = useQuery({
    queryKey: ["bi_prev", prevRange?.from, prevRange?.to, payment, activeBranchId],
    enabled: !!prevRange,
    queryFn: async () => {
      const { from, to } = prevRange!;
      const online = await fetchAllRows<any>(() => {
        let q = supabase
          .from("online_sales")
          .select("id, order_number, quantity, posted_price, item_id, payment_status")
          .eq("status", "completed")
          .gte("order_date", from)
          .lte("order_date", to);
        if (payment === "paid") q = q.eq("payment_status", "paid");
        else if (payment === "unpaid") q = q.eq("payment_status", "unpaid");
        if (activeBranchId) q = q.eq("branch_id", activeBranchId);
        return q;
      });
      const statuses =
        payment === "paid" ? ["paid", "completed"] : payment === "unpaid" ? ["confirmed", "unpaid", "shipped"] : ["confirmed", "paid", "unpaid", "shipped", "completed"];
      const invs = await fetchAllRows<any>(() => {
        let q = supabase
          .from("invoices")
          .select("id, status")
          .in("status", statuses as any)
          .gte("invoice_date", from)
          .lte("invoice_date", to);
        if (activeBranchId) q = q.eq("branch_id", activeBranchId);
        return q;
      });
      const invStatus = new Map<string, string>(invs.map((i: any) => [i.id, i.status]));
      const ids = invs.map((i: any) => i.id);
      const items: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const rows = await fetchAllRows<any>(() =>
          supabase.from("invoice_items").select("invoice_id, quantity, unit_price, item_id").in("invoice_id", chunk)
        );
        items.push(...rows.map((r: any) => ({ ...r, _status: invStatus.get(r.invoice_id) })));
      }
      return { online, items };
    },
  });

  const prevTotals = useMemo(() => {
    if (!prevRange || !prevRows) return null;
    const allowed = (itemId: string | null) => !allowedItemIds || (!!itemId && allowedItemIds.has(itemId));
    let revenue = 0;
    let units = 0;
    const paidOrders = new Set<string>();
    if (source !== "invoice") {
      for (const r of prevRows.online) {
        if (!allowed(r.item_id)) continue;
        const qty = Number(r.quantity || 0);
        units += qty;
        if (r.payment_status === "paid") {
          revenue += Number(r.posted_price || 0) * qty;
          paidOrders.add(`o:${r.order_number || r.id}`);
        }
      }
    }
    if (source !== "online") {
      for (const r of prevRows.items) {
        if (!allowed(r.item_id)) continue;
        const qty = Number(r.quantity || 0);
        units += qty;
        if (r._status === "paid" || r._status === "completed") {
          revenue += Number(r.unit_price || 0) * qty;
          paidOrders.add(`i:${r.invoice_id}`);
        }
      }
    }
    return { revenue, units, paidOrders: paidOrders.size, aov: paidOrders.size ? revenue / paidOrders.size : 0 };
  }, [prevRange, prevRows, source, allowedItemIds]);

  /** Fractional change, or null when there is no prior figure to compare with. */
  const change = (cur: number, prev: number | undefined) =>
    prev === undefined || prev === 0 ? null : (cur - prev) / Math.abs(prev);

  // Trend chart buckets: daily up to ~2 months, weekly up to a year, then monthly.
  const trend = useMemo(() => {
    const txns = aggregated.flatMap((r) => r.txns).filter((t) => t.date);
    let start = startOfDay(dateFrom);
    if (preset === "all") {
      const first = txns.reduce<string | null>((m, t) => (m === null || t.date < m ? t.date : m), null);
      start = first ? startOfDay(parseISO(first)) : startOfDay(subDays(effectiveTo, 29));
    }
    const { bucket, keyOf, slots } = makeBuckets(start, effectiveTo);
    const points = new Map<string, TrendPoint>(
      slots.map((sl) => [sl.key, { label: sl.label, title: sl.title, revenue: 0, profit: 0, units: 0 }]),
    );
    for (const t of txns) {
      const pt = points.get(keyOf(parseISO(t.date)));
      if (!pt) continue;
      pt.units += t.quantity;
      if (t.paymentStatus === "paid") pt.revenue += t.amount;
      if (t.profit != null) pt.profit += t.profit;
    }
    return { bucket, data: Array.from(points.values()) };
  }, [aggregated, dateFrom, effectiveTo, preset]);

  // "Needs attention" — counted over every product, not the Products-tab filters.
  const attention = useMemo(() => {
    const parents = productMetrics.filter((p) => p.kind === "parent");
    const of = (a: ProductAction) => parents.filter((p) => p.action === a);
    const buy = of("Buy");
    const dead = of("Dead");
    const overstock = of("Overstock");
    return {
      buy,
      dead,
      deadValue: dead.reduce((s, p) => s + p.stock * p.cost, 0),
      overstock,
      overstockValue: overstock.reduce((s, p) => s + p.stock * p.cost, 0),
    };
  }, [productMetrics]);

  const unpaidOrderCount = useMemo(() => {
    const ids = new Set<string>();
    for (const r of invoiceRows as any[]) {
      const st = r._invoice?.status;
      if (st !== "paid" && st !== "completed") ids.add(`i:${r.invoice_id}`);
    }
    for (const r of onlineRows as any[]) {
      if (r.payment_status !== "paid") ids.add(`o:${r.order_number || r.id}`);
    }
    return ids.size;
  }, [invoiceRows, onlineRows]);

  const showProducts = (a: ActionFilter) => {
    setActionFilter(a);
    setTab("products");
  };

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
  ].filter(Boolean).length;

  const resetDrawerFilters = () => {
    setSource("all");
    setPayment("all");
    setCategoryFilter("all");
    setBrandFilter("all");
    setSupplierFilter("all");
  };

  const productColCount = 5 + (visibleCols.has("type") ? 1 : 0) + (isAdmin ? 2 + (visibleCols.has("cost") ? 1 : 0) + (visibleCols.has("gmroi") ? 1 : 0) : 0);
  const missingCostTotal = missingCostCount + missingOnlineCostCount;
  const inventoryValue = (itemsAll as any[]).reduce((s, i) => s + Number(i.quantity || 0) * Number(i.cost_price || 0), 0);
  const rangeLabel = RANGE_OPTIONS.find((o) => o.v === preset)?.l ?? "";

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header — one slim toolbar shared by desktop and mobile: range, filters, export. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="page-header !mb-0">
          <h1 className="page-title">Business Insights</h1>
          <p className="page-description">Sales, profit and stock performance across online orders and invoices.</p>
        </div>
        <div className="flex items-center gap-2">
          <TodayMovementExport />
          <Select value={preset} onValueChange={(v) => setPreset(v as RangePreset)}>
            <SelectTrigger className="h-9 flex-1 text-sm md:w-[170px] md:flex-none" aria-label="Date range">
              <CalendarIcon className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue>{rangeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Sheet open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 px-3 text-xs" aria-label="Filters">
                <Filter className="h-4 w-4 md:mr-1.5" />
                <span className="hidden md:inline">Filters</span>
                {drawerFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5" data-testid="filter-count">{drawerFilterCount}</Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" aria-describedby={undefined}>
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
              </SheetHeader>
              <p className="text-xs text-muted-foreground pt-1">Applies to every tab.</p>
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
            <Download className="h-4 w-4 md:mr-1.5" />
            <span className="hidden md:inline">Export</span>
          </Button>
        </div>
      </div>

      {preset === "custom" && (
        <div className="flex md:justify-end">
          <CustomRangePickers from={customFrom} to={customTo} onFrom={setCustomFrom} onTo={setCustomTo} />
        </div>
      )}

      <div className="text-xs text-muted-foreground -mt-2">
        {activeBranch ? `${activeBranch.branch_name} (${activeBranch.branch_code})` : "All branches"} · {format(dateFrom, "MMM d, yyyy")} — {format(dateTo, "MMM d, yyyy")} · {daysInRange} day{daysInRange === 1 ? "" : "s"}
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        {/* Scrolls sideways on a phone rather than squeezing five labels into one row. */}
        <div className="-mx-3 overflow-x-auto px-3 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="inline-flex w-max">
            <TabsTrigger value="overview"><TrendingUp className="h-3.5 w-3.5 mr-1.5" />Overview</TabsTrigger>
            <TabsTrigger value="products"><Package className="h-3.5 w-3.5 mr-1.5" />Products</TabsTrigger>
            <TabsTrigger value="purchases"><Truck className="h-3.5 w-3.5 mr-1.5" />Purchases</TabsTrigger>
            <TabsTrigger value="forecast"><LineChart className="h-3.5 w-3.5 mr-1.5" />Forecast</TabsTrigger>
            <TabsTrigger value="customers"><Users className="h-3.5 w-3.5 mr-1.5" />Customers</TabsTrigger>
          </TabsList>
        </div>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          {(() => {
            const collected = totals.revTotal;
            const grossProfitTotal = productMetrics.reduce((s, p) => s + p.grossProfit, 0);
            const avgMargin = collected > 0 ? (grossProfitTotal / collected) * 100 : 0;
            const aov = paidOrderCount > 0 ? collected / paidOrderCount : 0;
            const productsSold = productMetrics.filter((p) => p.qtySold > 0).length;
            return (
              <div className="space-y-1.5">
                <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
                  {isAdmin ? (
                    <>
                      <StatCard
                        title="Revenue"
                        value={money(collected)}
                        icon={DollarSign}
                        variant="success"
                        description="Paid orders"
                        delta={change(collected, prevTotals?.revenue)}
                        formula={
                          <div className="space-y-0.5">
                            <FormulaRow label="Online" value={money(totals.revOnline)} />
                            <FormulaRow label="Invoices" value={money(totals.revInvoice)} />
                            {prevTotals && <FormulaRow label="Previous period" value={money(prevTotals.revenue)} muted />}
                          </div>
                        }
                      />
                      <StatCard
                        title="Gross Profit"
                        value={money(grossProfitTotal)}
                        icon={TrendingUp}
                        variant="success"
                        description={`${avgMargin.toFixed(1)}% margin`}
                      />
                      <StatCard
                        title="Outstanding"
                        value={money(outstanding.total)}
                        icon={AlertTriangle}
                        variant="warning"
                        description={`${unpaidOrderCount} unpaid order${unpaidOrderCount === 1 ? "" : "s"}`}
                        formula={
                          <div className="space-y-0.5">
                            <FormulaRow label="Invoices" value={money(outstanding.invoice)} />
                            <FormulaRow label="Online" value={money(outstanding.online)} />
                            <p className="pt-1 text-muted-foreground">Not counted in revenue, profit or margin until paid.</p>
                          </div>
                        }
                      />
                      <StatCard
                        title="Avg Order Value"
                        value={money(aov)}
                        icon={ShoppingBag}
                        description={`${paidOrderCount} paid order${paidOrderCount === 1 ? "" : "s"}`}
                        delta={prevTotals && prevTotals.paidOrders > 0 ? change(aov, prevTotals.aov) : null}
                      />
                    </>
                  ) : (
                    <>
                      <StatCard title="Units Sold" value={totals.qty} icon={Package} delta={change(totals.qty, prevTotals?.units)} />
                      <StatCard title="Products Sold" value={productsSold} icon={ShoppingBag} description="With at least one sale" />
                    </>
                  )}
                </div>
                {prevRange && (
                  <p className="text-[11px] text-muted-foreground">
                    Changes compare with the previous {prevRange.days} day{prevRange.days === 1 ? "" : "s"} ({format(parseISO(prevRange.from), "MMM d")} – {format(parseISO(prevRange.to), "MMM d, yyyy")}).
                  </p>
                )}
              </div>
            );
          })()}

          <InsightsTrendChart data={trend.data} bucket={trend.bucket} isAdmin={isAdmin} money={money} />

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Top 5 products */}
            <div className="min-w-0 rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Top Products</h2>
                <Button variant="ghost" size="sm" className="h-7 text-xs -mr-2" onClick={() => showProducts("all")}>
                  View all <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                </Button>
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
                          <div className="tabular-nums text-[10px] text-muted-foreground">{p.sku}</div>
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

            {/* Needs attention — each line opens the matching Products list. */}
            <div className="min-w-0 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold mb-3">Needs Attention</h2>
              {(() => {
                const items: { key: string; icon: typeof Clock; tone: string; title: string; detail: string; count: number; onClick?: () => void; to?: string }[] = [
                  {
                    key: "buy",
                    icon: PackagePlus,
                    tone: "text-red-600 bg-red-500/10",
                    title: "Reorder soon",
                    detail: "Under 14 days of stock at the current sales speed",
                    count: attention.buy.length,
                    onClick: () => showProducts("Buy"),
                  },
                  {
                    key: "dead",
                    icon: PackageX,
                    tone: "text-muted-foreground bg-muted",
                    title: "Not selling",
                    detail: isAdmin ? `${money(attention.deadValue)} of stock with no sales in this range` : "In stock with no sales in this range",
                    count: attention.dead.length,
                    onClick: () => showProducts("Dead"),
                  },
                  {
                    key: "overstock",
                    icon: Boxes,
                    tone: "text-orange-600 bg-orange-500/10",
                    title: "Overstocked",
                    detail: isAdmin ? `Over 180 days of stock · ${money(attention.overstockValue)} tied up` : "Over 180 days of stock",
                    count: attention.overstock.length,
                    onClick: () => showProducts("Overstock"),
                  },
                ];
                if (isAdmin) {
                  items.push({
                    key: "unpaid",
                    icon: Clock,
                    tone: "text-amber-600 bg-amber-500/10",
                    title: "Unpaid orders",
                    detail: `${money(outstanding.total)} not yet collected`,
                    count: unpaidOrderCount,
                    to: "/pending-payments",
                  });
                  if (missingCostTotal > 0) {
                    items.push({
                      key: "cost",
                      icon: AlertTriangle,
                      tone: "text-amber-600 bg-amber-500/10",
                      title: "Sales missing a cost",
                      detail: "Left out of gross profit and margin — set costs in Inventory",
                      count: missingCostTotal,
                      to: "/inventory",
                    });
                  }
                }
                const shown = items.filter((i) => i.count > 0);
                if (shown.length === 0) {
                  return <p className="py-6 text-center text-xs text-muted-foreground">Nothing needs attention right now.</p>;
                }
                return (
                  <div className="divide-y rounded-md border">
                    {shown.map((i) => {
                      const body = (
                        <>
                          <span className={cn("h-8 w-8 shrink-0 rounded-lg flex items-center justify-center", i.tone)}>
                            <i.icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{i.title}</span>
                            <span className="block text-xs text-muted-foreground">{i.detail}</span>
                          </span>
                          <span className="text-sm font-semibold tabular-nums">{i.count}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </>
                      );
                      const cls = "flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors";
                      return i.to ? (
                        <Link key={i.key} to={i.to} className={cls}>{body}</Link>
                      ) : (
                        <button key={i.key} type="button" onClick={i.onClick} className={cls}>{body}</button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </TabsContent>

        {/* PRODUCTS */}
        <TabsContent value="products" className="space-y-3">
          {/* One toolbar for every product-only control. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative basis-full md:basis-auto md:flex-1 md:max-w-xs">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search item or SKU..."
                className="h-9 text-sm pl-8"
              />
            </div>
            <Select value={productSource} onValueChange={(v) => setProductSource(v as ProductSourceFilter)}>
              <SelectTrigger className="h-9 flex-1 md:w-[120px] md:flex-none text-xs" aria-label="Product type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_SOURCE_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={(v) => setActionFilter(v as ActionFilter)}>
              <SelectTrigger className="h-9 flex-1 md:w-[170px] md:flex-none text-xs" aria-label="Suggested action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
              </SelectContent>
            </Select>
            {isAdmin && missingCostTotal > 0 && (
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <span className="inline-flex h-9 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-50 px-2.5 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200 cursor-help">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {missingCostTotal} missing cost
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs whitespace-normal text-xs leading-relaxed space-y-1">
                  {missingCostCount > 0 && (
                    <p><strong>{missingCostCount}</strong> invoice line{missingCostCount === 1 ? "" : "s"} excluded from gross profit / margin / GMROI because their variation has no cost assigned.</p>
                  )}
                  {missingOnlineCostCount > 0 && (
                    <p><strong>{missingOnlineCostCount}</strong> paid online sale{missingOnlineCostCount === 1 ? "" : "s"} excluded from gross profit / margin because the product had no cost at time of upload.</p>
                  )}
                  <p className="opacity-80">Revenue is still counted. Set costs in Inventory → Variations to include them.</p>
                </TooltipContent>
              </Tooltip>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden md:inline-flex h-9 text-xs ml-auto">
                  <Columns3 className="h-3.5 w-3.5 mr-1.5" />Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">Extra columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {OPTIONAL_COLS.filter((c) => isAdmin || !c.adminOnly).map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.v}
                    checked={visibleCols.has(c.v)}
                    onCheckedChange={() => toggleCol(c.v)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {c.l}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="px-1 text-xs text-muted-foreground">
            {filteredProducts.filter((p) => p.kind === "parent").length} product{filteredProducts.filter((p) => p.kind === "parent").length === 1 ? "" : "s"}
            {isAdmin && <> · inventory value {money(inventoryValue)}</>}
            <span className="hidden md:inline"> · click a row for its sales history</span>
            <span className="md:hidden"> · tap a card for sales history</span>
          </div>

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

            {productRows.length === 0 ? (
              <div className="rounded-lg border bg-card py-10 text-center text-xs text-muted-foreground">No items.</div>
            ) : (
              productRows.slice(0, 500).map(({ p, nested }) => {
                const kids = p.kind === "parent" ? variationsByParent.get(p.itemId)?.length || 0 : 0;
                return (
                  <div key={p.key} className={cn("space-y-1", nested && "ml-4")}>
                    <InsightsProductCard
                      product={p}
                      stockSplit={combinedBranches && p.kind === "parent" ? stockSplit.get(p.itemId) : undefined}
                      txns={perUnitTxns.get(p.key) || []}
                      isAdmin={isAdmin}
                      money={money}
                      isOpen={expandedProduct.has(p.key)}
                      onToggle={() => toggleExpandProduct(p.key)}
                    />
                    {kids > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleVariations(p.itemId)}
                        className="inline-flex items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {openVariations.has(p.itemId) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        {openVariations.has(p.itemId) ? "Hide" : "Show"} {kids} variation{kids === 1 ? "" : "s"}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="rounded-lg border bg-card overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <SortableHeader sortKey="name" label="Item" sort={productSort.sort} onToggle={productSort.toggle} />
                    {visibleCols.has("type") && <SortableHeader sortKey="source" label="Type" sort={productSort.sort} onToggle={productSort.toggle} />}
                    <SortableHeader sortKey="stock" label="Stock" sort={productSort.sort} onToggle={productSort.toggle} align="right" />
                    <SortableHeader sortKey="qtySold" label="Sold" sort={productSort.sort} onToggle={productSort.toggle} align="right" />
                    {isAdmin && <SortableHeader sortKey="revenue" label="Revenue" sort={productSort.sort} onToggle={productSort.toggle} align="right" />}
                    {isAdmin && visibleCols.has("cost") && <SortableHeader sortKey="cost" label="Cost" sort={productSort.sort} onToggle={productSort.toggle} align="right" />}
                    {isAdmin && <SortableHeader sortKey="grossProfit" label="Gross Profit" sort={productSort.sort} onToggle={productSort.toggle} align="right" />}
                    {isAdmin && visibleCols.has("gmroi") && <SortableHeader sortKey="gmroi" label="GMROI" sort={productSort.sort} onToggle={productSort.toggle} align="right" />}
                    <TableHead className="text-xs text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productRows.length === 0 ? (
                    <TableRow><TableCell colSpan={productColCount} className="text-center text-xs text-muted-foreground py-10">No items.</TableCell></TableRow>
                  ) : productRows.slice(0, 500).map(({ p, nested }) => {
                    const isOpen = expandedProduct.has(p.key);
                    const txns = perUnitTxns.get(p.key) || [];
                    const kids = p.kind === "parent" ? variationsByParent.get(p.itemId)?.length || 0 : 0;
                    return (
                      <Fragment key={p.key}>
                        <TableRow className={cn("hover:bg-muted/30 cursor-pointer", nested && "bg-muted/10")} onClick={() => toggleExpandProduct(p.key)}>
                          <TableCell className="w-8 p-2 align-middle">
                            {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                          <TableCell>
                            <div className={cn("font-medium text-sm flex items-center gap-1.5", nested && "pl-4")}>
                              {p.kind === "variation" && <span className="text-muted-foreground/60">↳</span>}
                              <span>{nested ? p.variationLabel : p.name}</span>
                              {!visibleCols.has("type") && !nested && p.source === "import" && (
                                <span className="inline-flex items-center rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">Import</span>
                              )}
                            </div>
                            <div className={cn("flex items-center gap-2 tabular-nums text-[10px] text-muted-foreground", nested && "pl-4")}>
                              <span>{p.sku}</span>
                              {kids > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); toggleVariations(p.itemId); }}
                                  className="inline-flex items-center gap-0.5 rounded px-1 -mx-1 hover:bg-muted hover:text-foreground"
                                  aria-expanded={openVariations.has(p.itemId)}
                                >
                                  {openVariations.has(p.itemId) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  {kids} variation{kids === 1 ? "" : "s"}
                                </button>
                              )}
                            </div>
                          </TableCell>
                          {visibleCols.has("type") && (
                            <TableCell>
                              <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", p.source === "import" ? "bg-blue-500/10 text-blue-600" : "bg-secondary text-secondary-foreground")}>
                                {p.source || "local"}
                              </span>
                            </TableCell>
                          )}
                          <TableCell className="text-right text-sm">
                            {p.kind === "variation" ? <span className="text-muted-foreground">—</span> : (
                              <>
                                <span className={cn(p.threshold > 0 && p.stock <= p.threshold && "text-destructive font-medium")}>{p.stock}</span>
                                {combinedBranches && <BranchStockSplit split={stockSplit.get(p.itemId)} />}
                              </>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            <div>{p.qtySold}</div>
                            {p.variationQtySold > 0 && <div className="text-[10px] text-muted-foreground">+{fmtUnits(p.variationQtySold)} via variations</div>}
                          </TableCell>
                          {isAdmin && <TableCell className="text-right text-sm">{money(p.revenue)}</TableCell>}
                          {isAdmin && visibleCols.has("cost") && <TableCell className="text-right text-sm text-muted-foreground">{money(p.totalCost)}</TableCell>}
                          {isAdmin && (
                            <TableCell className="text-right text-sm">
                              <div className={cn(p.grossProfit < 0 ? "text-red-600" : p.grossProfit > 0 ? "text-green-600" : "text-muted-foreground")}>{money(p.grossProfit)}</div>
                              {p.qtySold > 0 && <div className="text-[10px] text-muted-foreground">{p.margin.toFixed(1)}% margin</div>}
                            </TableCell>
                          )}
                          {isAdmin && visibleCols.has("gmroi") && (
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
                          <TableCell className="text-right">
                            {p.action ? (
                              <>
                                <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium", ACTION_CLASS[p.action])}>{p.action}</span>
                                {p.action !== "Dead" && <div className="mt-0.5 text-[10px] text-muted-foreground">{fmtDays(p.daysRemaining)} days left</div>}
                              </>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={productColCount} className="p-0">
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
                                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{t.reference}</td>
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


        {/* PURCHASES */}
        <TabsContent value="purchases">
          <InsightsPurchasesTab
            fromStr={fromStr}
            toStr={toStr}
            dateFrom={dateFrom}
            effectiveTo={effectiveTo}
            allTime={preset === "all"}
            branchId={activeBranchId}
            isAdmin={isAdmin}
            money={money}
            supplierFilter={supplierFilter}
          />
        </TabsContent>

        {/* FORECAST */}
        <TabsContent value="forecast">
          <InsightsForecastTab
            branchId={activeBranchId}
            isAdmin={isAdmin}
            money={money}
            items={itemsAll as any[]}
            variations={variationsAll as any[]}
            allowedItemIds={allowedItemIds}
          />
        </TabsContent>

        {/* CUSTOMERS */}
        <TabsContent value="customers" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-semibold">Online Customers</h2>
                  <p className="text-xs text-muted-foreground">Grouped by sales channel</p>
                </div>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Channels Ordered</div>
                  <div className="text-xl font-semibold mt-0.5">{customerStats.onlineCustomerCount}</div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Avg per Channel</div>
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

            <div className="rounded-lg border bg-card p-4">
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
                  <div className="text-xs text-muted-foreground">Customers Ordered</div>
                  <div className="text-xl font-semibold mt-0.5">{customerStats.invoiceCustomerCount}</div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-xs text-muted-foreground">Avg per Customer</div>
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
