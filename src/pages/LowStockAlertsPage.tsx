import { useMemo, useState, useEffect, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay, subDays } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { SortableHeader } from "@/components/SortableHeader";
import { useSort } from "@/hooks/use-sort";
import { useInsightsPurchases } from "@/hooks/use-insights-purchases";
import { useRestockInputs } from "@/hooks/use-restock-inputs";
import { useStockSplit } from "@/hooks/use-stock-split";
import { BranchStockSplit } from "@/components/BranchStockSplit";
import { peso } from "@/lib/currency";
import { fmtUnits } from "@/lib/insights";
import {
  DEFAULT_LEAD_DAYS,
  HISTORY_DAYS,
  SAFETY_DAYS,
  itemDemand,
  type DemandSale,
  planReorder,
  resolveLeadTime,
  stockUnitsSold,
  type LeadTime,
  type ReorderGroup,
  type SupplierLeadStats,
} from "@/lib/restock";
import { useAuth } from "@/contexts/AuthContext";
import ItemHistoryDialog from "@/components/ItemHistoryDialog";
import CostHistoryDialog from "@/components/CostHistoryDialog";
import { createPurchaseOrder, createPOItems, generatePONumber, createOverseasPurchaseOrder, createOverseasPOItems, generateOverseasPONumber, getItemsWithStock } from "@/lib/api";
import { listItemSuppliersForItems, upsertItemSupplier, type ItemSupplierRow } from "@/lib/itemSuppliers";
import type { Supplier, OverseasSupplier } from "@/types/database";
import { toast } from "sonner";
import { ShoppingCart, Search, ChevronRight, ChevronDown, History, DollarSign, BarChart3, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Item } from "@/types/database";
import { docNo } from "@/lib/doc-number";
import { searchMatches } from "@/lib/search";

type Group = Exclude<ReorderGroup, "ok">;

// After delivery, an order should last this long before the next one.
const COVER_DAYS = 30;

const GROUPS: { v: Group; label: string; hint: string }[] = [
  { v: "now", label: "Order now", hint: "Will run short before a new order could arrive, or below its minimum with nothing on order." },
  { v: "ordered", label: "On order", hint: "Low or due soon, with an order already coming. The order-by date says when more is needed." },
  { v: "watch", label: "Watch", hint: "Below its minimum but not selling, or due to be ordered within two weeks." },
];

interface SaleRow {
  /** Unique per sale line — remembers an "include this big order" choice. */
  id: string;
  /** Invoice or order number. */
  ref: string;
  item_id: string;
  /** Stock units used — a cut off a roll is a fraction of one. */
  baseQty: number;
  amount: number;
  date: string;
}

interface OpenPo {
  number: string;
  supplier: string;
  expected: string | null;
  remaining: number;
}

const fmtDate = (d: string | Date) => format(typeof d === "string" ? parseISO(d) : d, "MMM d");

function leadLabel(lead: LeadTime) {
  if (lead.source === "set") return `${lead.days}d lead`;
  if (lead.source === "history") return `${lead.days}d lead (past deliveries)`;
  return `${lead.days}d lead (default)`;
}

export default function LowStockAlertsPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = role === "admin";
  const money = (n: number) => (isAdmin ? peso(n) : "—");

  const [group, setGroup] = useState<Group>("now");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "local" | "import">("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [costHistoryItem, setCostHistoryItem] = useState<Item | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Rows the PO dialog is open for — the selection, or a single row's Order button.
  const [poRows, setPoRows] = useState<ReturnType<typeof buildRow>[] | null>(null);
  const [recentlyCreatedPoItems, setRecentlyCreatedPoItems] = useState<Set<string>>(new Set());
  const today = useMemo(() => startOfDay(new Date()), []);

  // items.quantity is frozen at the per-branch migration; item_branch_stock is
  // the live figure. Reading the old column made every alert here wrong.
  const { data: items = [], isLoading } = useQuery<Item[]>({
    queryKey: ["lowstock-items-with-stock"],
    queryFn: () => getItemsWithStock(),
  });

  const { data: variations = [] } = useQuery({
    queryKey: ["lowstock-variations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("item_variations").select("id, item_id, type, factor");
      if (error) throw error;
      return data as { id: string; item_id: string; type: string; factor: number }[];
    },
  });

  // Ninety days of sales is well past PostgREST's 1000-row cap, so these reads
  // page through it — an unpaginated read silently dropped most of it and every
  // days-left figure on this page came out far too optimistic.
  const since = useMemo(() => format(subDays(today, HISTORY_DAYS), "yyyy-MM-dd"), [today]);
  const { data: salesRows = [] } = useQuery<SaleRow[]>({
    queryKey: ["lowstock-sales", since, items.length, variations.length],
    enabled: items.length > 0,
    queryFn: async () => {
      const [invRows, onlRows] = await Promise.all([
        fetchAllRows<any>(() =>
          supabase
            .from("invoice_items")
            .select("id, item_id, variation_id, quantity, unit_price, invoices!inner(invoice_number, invoice_date, status)")
            .gte("invoices.invoice_date", since)
            // Cancelled orders never sold, and reserved ones have not sold yet —
            // counting either as demand shortens days-left and triggers early
            // reorders. A reserved order is counted once it becomes a real sale.
            .not("invoices.status", "in", "(draft,cancelled,reserved)")
            .order("id"),
        ),
        fetchAllRows<any>(() =>
          supabase
            .from("online_sales")
            .select("id, order_number, item_id, variation_id, quantity, deal_price, order_date, status")
            .gte("order_date", since)
            .eq("status", "completed")
            .order("id"),
        ),
      ]);
      const itemsById = new Map(items.map((i) => [i.id, i]));
      const variationById = new Map(variations.map((v) => [v.id, v]));
      const toRow = (id: string, ref: string, itemId: string, variationId: string | null, qty: number, price: number, date: string): SaleRow => ({
        id,
        ref,
        item_id: itemId,
        baseQty: stockUnitsSold(qty, variationId ? variationById.get(variationId) : null, itemsById.get(itemId)?.units_per_stock),
        amount: qty * price,
        date,
      });
      const out: SaleRow[] = [];
      for (const r of invRows) if (r.item_id) out.push(toRow(`inv:${r.id}`, docNo(r.invoices?.invoice_number) || "Invoice", r.item_id, r.variation_id, Number(r.quantity || 0), Number(r.unit_price || 0), r.invoices?.invoice_date));
      for (const r of onlRows) if (r.item_id) out.push(toRow(`onl:${r.id}`, r.order_number || "Online order", r.item_id, r.variation_id, Number(r.quantity || 0), Number(r.deal_price || 0), r.order_date));
      return out;
    },
  });

  // Open orders and what past deliveries say about each supplier — shared with
  // Business Insights, so both pages agree.
  const { orders, onOrderByItem, leadTimeBySupplier } = useInsightsPurchases(null);
  // Ordering is for the whole business, so stock here is every branch added
  // together — always shown split so a count at one branch can be checked.
  const stockSplit = useStockSplit();
  // Receipts and stock corrections to rebuild each day's stock, and the big
  // orders chosen to count anyway — shared with the Forecast tab.
  const { adjustmentsByItem, receiptsByItem, includeIds, toggleInclude } = useRestockInputs(orders, today);

  // Latest cost change per item
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
        map[r.item_id] = { date: r.created_at, cost: Number(r.new_cost || 0), supplier: r.supplier_name, po: r.po_number };
      }
      return map;
    },
  });

  // Preferred supplier link per item (cost, MOQ, typed lead time)
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const { data: itemSupplierMap = new Map() } = useQuery<Map<string, ItemSupplierRow>>({
    queryKey: ["lowstock-item-suppliers", itemIds.length],
    queryFn: () => listItemSuppliersForItems(itemIds),
    enabled: itemIds.length > 0,
  });

  const rows = useMemo(() => {
    const salesByItem = new Map<string, SaleRow[]>();
    for (const s of salesRows) {
      const arr = salesByItem.get(s.item_id) || [];
      arr.push(s);
      salesByItem.set(s.item_id, arr);
    }
    // Open POs and the most recent local supplier per item, from PO history.
    const openByItem = new Map<string, OpenPo[]>();
    const latestLocal = new Map<string, { id: string; name: string; date: string }>();
    for (const po of orders) {
      for (const l of po.lines) {
        if (!l.itemId) continue;
        const rem = l.qty - l.received;
        if (po.status !== "received" && rem > 0) {
          const arr = openByItem.get(l.itemId) || [];
          arr.push({ number: docNo(po.number) || po.number, supplier: po.supplier, expected: po.expected, remaining: rem });
          openByItem.set(l.itemId, arr);
        }
        if (po.kind === "local" && po.supplierId && po.orderDate) {
          const cur = latestLocal.get(l.itemId);
          if (!cur || po.orderDate > cur.date) latestLocal.set(l.itemId, { id: po.supplierId, name: po.supplier, date: po.orderDate });
        }
      }
    }
    return items.map((it) =>
      buildRow(it, {
        sales: salesByItem.get(it.id) || [],
        openPos: (openByItem.get(it.id) || []).sort((a, b) => (a.expected || "9999").localeCompare(b.expected || "9999")),
        onOrder: onOrderByItem.get(it.id) || 0,
        itemSupplier: itemSupplierMap.get(it.id),
        latestLocal: latestLocal.get(it.id),
        lastCost: lastCostMap[it.id],
        leadTimeBySupplier,
        receipts: receiptsByItem.get(it.id) || [],
        adjustments: adjustmentsByItem.get(it.id) || [],
        includeIds,
        today,
      }),
    );
  }, [items, salesRows, orders, onOrderByItem, itemSupplierMap, lastCostMap, leadTimeBySupplier, receiptsByItem, adjustmentsByItem, includeIds, today]);

  const listed = useMemo(() => rows.filter((r) => r.plan.group !== "ok"), [rows]);

  const supplierOptions = useMemo(
    () => Array.from(new Set(listed.map((r) => r.supplier?.name).filter(Boolean) as string[])).sort(),
    [listed],
  );

  const matching = useMemo(() => {
    let out = listed;
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((r) => searchMatches(q, r.item.name, r.item.sku, (r.item as any).brand, (r.item as any).category));
    }
    if (sourceFilter !== "all") out = out.filter((r) => (r.item.source || "local") === sourceFilter);
    if (supplierFilter !== "all") out = out.filter((r) => r.supplier?.name === supplierFilter);
    return out;
  }, [listed, search, sourceFilter, supplierFilter]);

  const counts = useMemo(() => {
    const c: Record<Group, number> = { now: 0, ordered: 0, watch: 0 };
    for (const r of matching) c[r.plan.group as Group] += 1;
    return c;
  }, [matching]);

  const inGroup = useMemo(() => matching.filter((r) => r.plan.group === group), [matching, group]);
  const { sort, toggle: toggleSort, sorted } = useSort(inGroup, {
    product: (r) => r.item.name,
    stock: (r) => r.item.quantity,
    daysLeft: (r) => (Number.isFinite(r.plan.daysLeft) ? r.plan.daysLeft : Number.MAX_SAFE_INTEGER),
    onOrder: (r) => r.onOrder,
    // On order: soonest arrival first. Otherwise: soonest order-by date.
    when: (r) =>
      group === "ordered"
        ? r.openPos[0]?.expected || "9999"
        : Number.isFinite(r.plan.orderByDays) ? r.plan.orderByDays : Number.MAX_SAFE_INTEGER,
    qty: (r) => r.plan.suggested,
  }, { key: "when", dir: "asc" });

  const colCount = group === "ordered" ? 7 : 8;
  const groupCost = inGroup.reduce((s, r) => s + r.reorderCost, 0);
  const leadSources = useMemo(() => {
    const c = { set: 0, history: 0, default: 0 };
    for (const r of inGroup) c[r.lead.source] += 1;
    return c;
  }, [inGroup]);

  const updateThreshold = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      const { error } = await supabase.from("items").update({ low_stock_threshold: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lowstock-items-with-stock"] });
      toast.success("Minimum stock updated");
    },
    onError: (e: any) => toast.error(e?.message || "Failed to update minimum stock"),
  });

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const allSelected = sorted.length > 0 && sorted.every((r) => selectedIds.has(r.item.id));
  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of sorted) {
        if (allSelected) next.delete(r.item.id); else next.add(r.item.id);
      }
      return next;
    });
  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.item.id)), [rows, selectedIds]);
  // Stable between renders: the dialog re-seeds its form whenever this changes.
  const dialogRows = useMemo(() => (poRows || []).map((r) => ({ ...r, suggestedQty: r.plan.suggested })), [poRows]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Reorder List</h1>
          <p className="text-sm text-muted-foreground mt-1">What to order, how many, and by when — from the last {HISTORY_DAYS} days of sales and your suppliers' lead times. Stock is all branches together.</p>
        </div>
        <Button disabled={selectedRows.length === 0} onClick={() => setPoRows(selectedRows)} className="shrink-0">
          <ShoppingCart className="h-4 w-4 mr-1.5" />
          Create PO{selectedRows.length ? ` (${selectedRows.length})` : ""}
        </Button>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Reorder groups" className="inline-flex w-full rounded-lg bg-muted p-1 lg:w-auto">
          {GROUPS.map((g) => (
            <button
              key={g.v}
              role="tab"
              aria-selected={group === g.v}
              title={g.hint}
              onClick={() => setGroup(g.v)}
              className={cn(
                "flex-1 lg:flex-none rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
                group === g.v ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
              <span className={cn("ml-1.5 tabular-nums", g.v === "now" && counts.now > 0 ? "text-destructive" : "text-muted-foreground")}>{counts[g.v]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative basis-full sm:basis-auto sm:w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search name or SKU..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
          </div>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="h-9 flex-1 sm:w-[170px] sm:flex-none text-xs" aria-label="Supplier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All suppliers</SelectItem>
              {supplierOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
            <SelectTrigger className="h-9 flex-1 sm:w-[120px] sm:flex-none text-xs" aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="local">Local</SelectItem>
              <SelectItem value="import">Import</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="text-xs text-muted-foreground px-1">
        {GROUPS.find((g) => g.v === group)!.hint}
        {group === "now" && inGroup.length > 0 && isAdmin && <> · about <span className="font-medium text-foreground">{money(groupCost)}</span> at last cost</>}
        {leadSources.default > 0 && (
          <span className="text-amber-600"> · {leadSources.default} item{leadSources.default === 1 ? " uses" : "s use"} the {DEFAULT_LEAD_DAYS}-day default lead time — set it on the supplier link for a better plan</span>
        )}
      </div>

      {/* Phones: one card per item — the table needs sideways scrolling to reach the quantity. */}
      <div className="md:hidden space-y-2.5">
        {isLoading ? (
          <div className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : sorted.length === 0 ? (
          <div className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">
            {group === "now" ? "Nothing needs ordering right now." : group === "ordered" ? "Nothing low is on order." : "Nothing to watch."}
          </div>
        ) : sorted.map((r) => {
          const isOpen = expanded.has(r.item.id);
          return (
            <div key={r.item.id} className="rounded-xl border bg-card">
              <div className="flex items-start gap-3 p-3">
                <Checkbox className="mt-0.5" checked={selectedIds.has(r.item.id)} onCheckedChange={() => toggleSelect(r.item.id)} aria-label={`Select ${r.item.name}`} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggleExpand(r.item.id)} aria-expanded={isOpen}>
                  <div className="text-sm font-semibold leading-snug">{r.item.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.supplier?.name || <span className="text-amber-600">no supplier</span>}
                    <span className={cn((r.lead.source === "default" || r.lead.mismatch) && "text-amber-600")}> · {leadLabel(r.lead)}</span>
                  </div>
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t px-3 py-2.5 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Stock / Min</div>
                  <span className={cn("font-semibold tabular-nums", r.plan.belowMin && "text-destructive")}>{fmtUnits(r.item.quantity)}</span>
                  <span className="text-muted-foreground"> / </span>
                  <MinStockEditor value={r.threshold} onSave={(v) => updateThreshold.mutate({ id: r.item.id, value: v })} />
                  <BranchStockSplit split={stockSplit.get(r.item.id)} />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{group === "ordered" ? "Arrives" : "Order by"}</div>
                  <WhenCell row={r} group={group} today={today} />
                </div>
                <div className="text-right">
                  {group === "ordered" ? (
                    <>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">On order</div>
                      <div className="font-semibold tabular-nums">{fmtUnits(r.onOrder)}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Order qty</div>
                      <div className="font-semibold tabular-nums">{r.plan.suggested > 0 ? r.plan.suggested.toLocaleString() : "—"}</div>
                      {isAdmin && r.plan.suggested > 0 && <div className="text-[10px] text-muted-foreground tabular-nums">{money(r.reorderCost)}</div>}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                <button type="button" onClick={() => toggleExpand(r.item.id)} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Details
                </button>
                {group !== "ordered" && (
                  <Button size="sm" variant={group === "now" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setPoRows([r])}>
                    <ShoppingCart className="h-3.5 w-3.5 mr-1" />Order
                  </Button>
                )}
              </div>
              {isOpen && (
                <div className="border-t bg-muted/20 p-3">
                  <ItemDetails row={r} money={money} isAdmin={isAdmin} onHistory={() => setHistoryItem(r.item)} onCostHistory={isAdmin ? () => setCostHistoryItem(r.item) : undefined} onToggleInclude={toggleInclude} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
                </TableHead>
                <SortableHeader sortKey="product" label="Item" sort={sort} onToggle={toggleSort} />
                <SortableHeader sortKey="stock" label="Stock / Min" sort={sort} onToggle={toggleSort} align="right" />
                <SortableHeader sortKey="daysLeft" label="Days left" sort={sort} onToggle={toggleSort} align="right" />
                <SortableHeader sortKey="onOrder" label="On order" sort={sort} onToggle={toggleSort} align="right" />
                <SortableHeader sortKey="when" label={group === "ordered" ? "Arrives" : "Order by"} sort={sort} onToggle={toggleSort} />
                {group !== "ordered" && <SortableHeader sortKey="qty" label="Order qty" sort={sort} onToggle={toggleSort} align="right" />}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={colCount} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="text-center py-12 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
                    {group === "now" ? "Nothing needs ordering right now." : group === "ordered" ? "Nothing low is on order." : "Nothing to watch."}
                  </TableCell>
                </TableRow>
              ) : sorted.map((r) => {
                const isOpen = expanded.has(r.item.id);
                const unit = r.item.base_unit || "pcs";
                const daysLeft = r.plan.daysLeft;
                return (
                  <Fragment key={r.item.id}>
                    <TableRow className={cn("cursor-pointer", isOpen && "bg-muted/30")} onClick={() => toggleExpand(r.item.id)}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selectedIds.has(r.item.id)} onCheckedChange={() => toggleSelect(r.item.id)} aria-label={`Select ${r.item.name}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-1.5">
                          {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{r.item.name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {r.item.sku || "—"} · {r.supplier?.name || <span className="text-amber-600">no supplier</span>}
                              <span className={cn(" ", (r.lead.source === "default" || r.lead.mismatch) && "text-amber-600")}> · {leadLabel(r.lead)}</span>
                            </div>
                            {recentlyCreatedPoItems.has(r.item.id) && (
                              <Badge variant="outline" className="mt-1 bg-primary/10 text-primary border-primary/30 text-[10px]">PO created</Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <span className={cn("font-semibold tabular-nums", r.plan.belowMin && "text-destructive")}>{fmtUnits(r.item.quantity)}</span>
                        <span className="text-muted-foreground"> / </span>
                        <MinStockEditor value={r.threshold} onSave={(v) => updateThreshold.mutate({ id: r.item.id, value: v })} />
                        <div className="text-[10px] text-muted-foreground">{unit}</div>
                        <BranchStockSplit split={stockSplit.get(r.item.id)} />
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.item.quantity <= 0 ? <span className="text-destructive">Out</span> : Number.isFinite(daysLeft) ? `${Math.floor(daysLeft)}d` : <span className="text-muted-foreground">No sales</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {r.onOrder > 0 ? fmtUnits(r.onOrder) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        <WhenCell row={r} group={group} today={today} />
                      </TableCell>
                      {group !== "ordered" && (
                      <TableCell className="text-right whitespace-nowrap">
                        {r.plan.suggested > 0 ? (
                          <>
                            <div className="font-semibold tabular-nums">{r.plan.suggested.toLocaleString()}</div>
                            {isAdmin && <div className="text-[10px] text-muted-foreground tabular-nums">{money(r.reorderCost)}</div>}
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      )}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {group !== "ordered" && (
                          <Button size="sm" variant={group === "now" ? "default" : "outline"} className="h-8 px-2.5 text-xs" onClick={() => setPoRows([r])} aria-label={`Order ${r.item.name}`}>
                            <ShoppingCart className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Order</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={colCount} className="bg-muted/20 p-4">
                          <ItemDetails
                            row={r}
                            money={money}
                            isAdmin={isAdmin}
                            onHistory={() => setHistoryItem(r.item)}
                            onCostHistory={isAdmin ? () => setCostHistoryItem(r.item) : undefined}
                            onToggleInclude={toggleInclude}
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
      {isAdmin && <CostHistoryDialog item={costHistoryItem} open={!!costHistoryItem} onOpenChange={(o) => !o && setCostHistoryItem(null)} />}

      <BulkPODialog
        open={!!poRows}
        onOpenChange={(o) => !o && setPoRows(null)}
        rows={dialogRows}
        money={money}
        onCreated={(ids) => {
          setRecentlyCreatedPoItems((prev) => new Set([...prev, ...ids]));
          setSelectedIds(new Set());
          setPoRows(null);
          // The new draft PO puts these items on order.
          queryClient.invalidateQueries({ queryKey: ["bi_purchases"] });
          queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
        }}
      />
    </div>
  );
}

/** Everything one row needs, worked out once per item. */
function buildRow(
  it: Item,
  ctx: {
    sales: SaleRow[];
    openPos: OpenPo[];
    onOrder: number;
    itemSupplier: ItemSupplierRow | undefined;
    latestLocal: { id: string; name: string } | undefined;
    lastCost: { date: string; cost: number; supplier: string | null; po: string | null } | undefined;
    leadTimeBySupplier: Map<string, SupplierLeadStats>;
    receipts: { daysAgo: number; units: number }[];
    adjustments: { daysAgo: number; units: number }[];
    includeIds: Set<string>;
    today: Date;
  },
) {
  const lines: DemandSale[] = [];
  let q7 = 0, q30 = 0, q90 = 0, a90 = 0;
  for (const s of ctx.sales) {
    if (!s.date) continue;
    const ago = differenceInCalendarDays(ctx.today, parseISO(s.date));
    if (ago < 0 || ago > HISTORY_DAYS) continue;
    lines.push({ id: s.id, ref: s.ref, daysAgo: ago, units: s.baseQty });
    if (ago <= 7) q7 += s.baseQty;
    if (ago <= 30) q30 += s.baseQty;
    q90 += s.baseQty;
    a90 += s.amount;
  }
  const demand = itemDemand({
    sales: lines,
    stockNow: it.quantity,
    receipts: ctx.receipts,
    adjustments: ctx.adjustments,
    createdAt: it.created_at,
    today: ctx.today,
    includeIds: ctx.includeIds,
  });
  const rate = demand.rate;

  // Preferred supplier: the item's supplier link, else the last local supplier it was bought from.
  const link = ctx.itemSupplier;
  const supplier =
    link && link.is_overseas && link.overseas_supplier_id
      ? { id: link.overseas_supplier_id, name: link.supplier_name || "Supplier", overseas: true as const }
      : link && !link.is_overseas && link.supplier_id
        ? { id: link.supplier_id, name: link.supplier_name || "Supplier", overseas: false as const }
        : ctx.latestLocal
          ? { ...ctx.latestLocal, overseas: false as const }
          : undefined;
  const lead = resolveLeadTime(link?.lead_time_days, supplier ? ctx.leadTimeBySupplier.get(supplier.id) : null);
  const threshold = it.low_stock_threshold ?? 0;
  const plan = planReorder({
    stock: it.quantity,
    onOrder: ctx.onOrder,
    rate,
    leadDays: lead.days,
    coverDays: COVER_DAYS,
    minStock: threshold,
    moq: link?.moq,
    // Each open order from the day it is due, so stock that is not here yet is
    // not treated as on the shelf. Late or undated orders count as arriving now.
    incoming: ctx.openPos.map((po) => ({
      qty: po.remaining,
      inDays: po.expected ? Math.max(0, differenceInCalendarDays(parseISO(po.expected), ctx.today)) : 0,
    })),
  });
  return {
    item: it,
    threshold,
    rate,
    demand,
    q7, q30, q90, a90,
    plan,
    lead,
    supplier,
    onOrder: ctx.onOrder,
    openPos: ctx.openPos,
    lastCost: ctx.lastCost,
    itemSupplier: link,
    // Fields the PO dialog reads.
    latestSupplier: supplier,
    reorderCost: plan.suggested * (ctx.lastCost?.cost ?? it.cost_price ?? 0),
  };
}

type Row = ReturnType<typeof buildRow>;

/** "Order by" for the Order now / Watch groups, "Arrives" for On order. */
function WhenCell({ row: r, group, today }: { row: Row; group: Group; today: Date }) {
  if (group === "ordered") {
    const next = r.openPos[0];
    if (!next) return <span className="text-muted-foreground">—</span>;
    const late = !!next.expected && parseISO(next.expected) < today;
    // Still short of the target once it arrives: say when to order the rest.
    const more = r.plan.suggested > 0 && Number.isFinite(r.plan.orderByDays);
    return (
      <>
        <div className={cn(late && "text-destructive font-medium")}>{next.expected ? fmtDate(next.expected) : "No date"}{late && " · late"}</div>
        <div className="text-[10px] text-muted-foreground">{next.number}</div>
        {more && (
          <div className={cn("text-[10px]", r.plan.orderByDays <= 7 ? "text-amber-600" : "text-muted-foreground")}>
            order {r.plan.suggested.toLocaleString()} more {r.plan.orderByDays <= 0 ? "now" : `by ${fmtDate(addDays(today, r.plan.orderByDays))}`}
          </div>
        )}
      </>
    );
  }
  if (!Number.isFinite(r.plan.orderByDays)) {
    return <span className="text-muted-foreground text-xs">No sales in {HISTORY_DAYS}d</span>;
  }
  const d = r.plan.orderByDays;
  if (d <= 0) {
    return (
      <>
        <div className="text-destructive font-medium">Now</div>
        {d < 0 && <div className="text-[10px] text-destructive">{-d} day{d === -1 ? "" : "s"} late</div>}
      </>
    );
  }
  return (
    <>
      <div className={cn(d <= 7 && "text-amber-600")}>{fmtDate(addDays(today, d))}</div>
      <div className="text-[10px] text-muted-foreground">in {d} day{d === 1 ? "" : "s"}</div>
    </>
  );
}

/** The minimum stock level, shown as a number until clicked. */
function MinStockEditor({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="tabular-nums text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
        title="Minimum stock — click to change"
      >
        {value || "—"}
      </button>
    );
  }
  const commit = (raw: string) => {
    const v = parseInt(raw);
    setEditing(false);
    if (!isNaN(v) && v >= 0 && v !== value) onSave(v);
  };
  return (
    <Input
      type="number"
      min={0}
      autoFocus
      defaultValue={value}
      aria-label="Minimum stock"
      className="inline-block h-7 w-16 text-right text-xs"
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

// ===== Bulk PO Dialog =====
// Module-level so the "still loading" default is the same array every render —
// a fresh [] would re-run the form-seeding effect in a loop.
const NO_SUPPLIERS: Supplier[] = [];
const NO_OVERSEAS: OverseasSupplier[] = [];
interface BulkPORow {
  item: Item;
  suggestedQty: number;
  lastCost?: { cost: number };
  latestSupplier?: { id: string; name: string; overseas?: boolean };
  itemSupplier?: ItemSupplierRow;
}

type RowKind = "local" | "overseas";

interface RowEdit {
  qty: number;
  cost: number;
  supplier_id: string;
  supplier_name: string;
  kind: RowKind;
  currency: string;
  exchange_rate: number;
  saveDefault: boolean;
}

function fmtMoney(n: number, currency: string) {
  const sym = currency === "RMB" ? "¥" : currency === "USD" ? "$" : "₱";
  return `${sym}${n.toFixed(2)} ${currency}`;
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
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data: allSuppliers = NO_SUPPLIERS } = useQuery<Supplier[]>({
    queryKey: ["bulkpo-suppliers"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("*").order("name");
      return (data as Supplier[]) || [];
    },
    enabled: open,
  });

  const { data: allOverseas = NO_OVERSEAS } = useQuery<OverseasSupplier[]>({
    queryKey: ["bulkpo-overseas-suppliers"],
    queryFn: async () => {
      const { data } = await supabase.from("overseas_suppliers").select("*").order("name");
      return (data as OverseasSupplier[]) || [];
    },
    enabled: open,
  });

  // Initialize edits whenever rows change / dialog opens
  useEffect(() => {
    if (!open) return;
    setEdits((prev) => {
      const next: typeof prev = {};
      for (const r of rows) {
        // Routing: import → overseas, otherwise local
        const isImport = r.item.source === "import" || !!r.itemSupplier?.is_overseas;
        const kind: RowKind = isImport ? "overseas" : "local";

        let supplier_id = "";
        let supplier_name = "";
        let currency = isImport ? "USD" : "PHP";
        let exchange_rate = 1;

        if (kind === "overseas") {
          if (r.itemSupplier?.is_overseas && r.itemSupplier.overseas_supplier_id) {
            supplier_id = r.itemSupplier.overseas_supplier_id;
            supplier_name = r.itemSupplier.supplier_name || "Supplier";
            currency = r.itemSupplier.currency || "USD";
            const sup = allOverseas.find((s) => s.id === supplier_id);
            exchange_rate = Number(sup?.exchange_rate || 1);
          }
        } else {
          if (r.itemSupplier && !r.itemSupplier.is_overseas && r.itemSupplier.supplier_id) {
            supplier_id = r.itemSupplier.supplier_id;
            supplier_name = r.itemSupplier.supplier_name || "Supplier";
          } else if (r.latestSupplier && !r.latestSupplier.overseas) {
            supplier_id = r.latestSupplier.id;
            supplier_name = r.latestSupplier.name;
          }
        }

        const seedCost = r.itemSupplier && (r.itemSupplier.is_overseas === isImport)
          ? Number(r.itemSupplier.latest_cost)
          : isImport
          ? (Number(r.item.cost_price_rmb) || 0)
          : (r.lastCost?.cost ?? r.item.cost_price ?? 0);
        const seedQty = Math.max(r.itemSupplier?.moq || 1, r.suggestedQty || 1);

        next[r.item.id] = prev[r.item.id] ?? {
          qty: seedQty,
          cost: seedCost,
          supplier_id,
          supplier_name: supplier_name || (kind === "overseas" ? "Unassigned overseas supplier" : "Unknown supplier"),
          kind,
          currency,
          exchange_rate,
          saveDefault: !r.itemSupplier && !!supplier_id,
        };
      }
      return next;
    });
  }, [open, rows, allOverseas]);

  // Group by kind + supplier_id (or "unknown")
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; kind: RowKind; supplier_id: string; supplier_name: string; currency: string; rows: BulkPORow[] }>();
    for (const r of rows) {
      const e = edits[r.item.id];
      if (!e) continue;
      const sid = e.supplier_id || "__unknown__";
      const key = `${e.kind}::${sid}`;
      if (!m.has(key)) m.set(key, { key, kind: e.kind, supplier_id: sid, supplier_name: e.supplier_name, currency: e.currency, rows: [] });
      m.get(key)!.rows.push(r);
    }
    return Array.from(m.values());
  }, [rows, edits]);

  const handleSubmit = async () => {
    const valid = groups.filter((g) => g.supplier_id !== "__unknown__");
    const skipped = rows.filter((r) => !edits[r.item.id]?.supplier_id);
    if (valid.length === 0) {
      toast.error("No items have a supplier assigned — pick one inline before creating");
      return;
    }
    setSubmitting(true);
    const createdItemIds: string[] = [];
    let createdLocal = 0;
    let createdOverseas = 0;
    let savedDefaults = 0;
    try {
      for (const g of valid) {
        const total = g.rows.reduce((s, r) => {
          const e = edits[r.item.id];
          return s + (e?.qty || 0) * (e?.cost || 0);
        }, 0);

        if (g.kind === "overseas") {
          const po_number = await generateOverseasPONumber();
          const sup = allOverseas.find((s) => s.id === g.supplier_id);
          const exchange_rate = Number(sup?.exchange_rate || 1);
          const po = await createOverseasPurchaseOrder({
            po_number,
            supplier_id: g.supplier_id,
            status: "draft",
            order_date: new Date().toISOString().split("T")[0],
            notes: "Auto-created from the Reorder List",
            total_amount: total,
            currency: g.currency as any,
            exchange_rate,
          } as any);
          const lineItems = g.rows.map((r) => {
            const e = edits[r.item.id];
            return {
              po_id: po.id,
              item_id: r.item.id,
              item_name: r.item.name,
              description: "",
              quantity: e?.qty || 1,
              unit_cost: e?.cost || 0,
              received_quantity: 0,
            };
          });
          await createOverseasPOItems(lineItems);
          createdOverseas += 1;
        } else {
          const po_number = await generatePONumber();
          const po = await createPurchaseOrder({
            po_number,
            supplier_id: g.supplier_id,
            status: "draft",
            order_date: new Date().toISOString().split("T")[0],
            notes: "Auto-created from the Reorder List",
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
          createdLocal += 1;
        }

        for (const r of g.rows) {
          createdItemIds.push(r.item.id);
          const e = edits[r.item.id];
          if (e?.saveDefault && e?.supplier_id && !r.itemSupplier) {
            try {
              await upsertItemSupplier({
                item_id: r.item.id,
                supplier_id: g.kind === "local" ? e.supplier_id : null,
                overseas_supplier_id: g.kind === "overseas" ? e.supplier_id : null,
                currency: e.currency,
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
      const parts: string[] = [];
      if (createdLocal) parts.push(`${createdLocal} local PO${createdLocal === 1 ? "" : "s"}`);
      if (createdOverseas) parts.push(`${createdOverseas} overseas PO${createdOverseas === 1 ? "" : "s"}`);
      toast.success(
        `Created ${parts.join(" + ")}` +
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

  const updateEdit = (itemId: string, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...patch },
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Purchase Orders</DialogTitle>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items selected.</p>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Local products are routed to local Purchase Orders; import products are routed to Overseas POs.
              One PO is created per supplier.
            </p>
            {groups.map((g) => {
              const isUnknown = g.supplier_id === "__unknown__";
              return (
                <div key={g.key} className="rounded-lg border bg-card">
                  <div className="flex items-center justify-between p-3 border-b bg-muted/40">
                    <div className="font-medium text-sm flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {g.kind === "overseas" ? "Overseas PO" : "Local PO"}
                      </Badge>
                      {isUnknown ? (
                        <span className="text-destructive">No supplier on file — assign below or it will be skipped</span>
                      ) : (
                        <>Supplier: {g.supplier_name} {g.kind === "overseas" && <span className="text-xs text-muted-foreground">({g.currency})</span>}</>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">{g.rows.length} item(s)</Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        {isUnknown && <TableHead className="w-56">Assign supplier</TableHead>}
                        <TableHead className="w-24 text-right">Qty</TableHead>
                        <TableHead className="w-32 text-right">Unit Cost</TableHead>
                        <TableHead className="w-28 text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.rows.map((r) => {
                        const e = edits[r.item.id];
                        const subtotal = (e?.qty || 0) * (e?.cost || 0);
                        const supplierMeta = r.itemSupplier;
                        const supplierOptions = g.kind === "overseas" ? allOverseas : allSuppliers;
                        return (
                          <Fragment key={r.item.id}>
                            <TableRow>
                              <TableCell className="text-sm">
                                <div className="font-medium flex items-center gap-1.5">
                                  {r.item.name}
                                  <Badge variant="outline" className="text-[9px] h-4">{r.item.source === "import" ? "Import" : "Local"}</Badge>
                                </div>
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
                                      if (g.kind === "overseas") {
                                        const sup = allOverseas.find(s => s.id === v);
                                        updateEdit(r.item.id, {
                                          supplier_id: v,
                                          supplier_name: sup?.name || "Supplier",
                                          currency: sup?.currency || "USD",
                                          exchange_rate: Number(sup?.exchange_rate || 1),
                                          saveDefault: true,
                                        });
                                      } else {
                                        const sup = allSuppliers.find(s => s.id === v);
                                        updateEdit(r.item.id, {
                                          supplier_id: v,
                                          supplier_name: sup?.name || "Supplier",
                                          currency: "PHP",
                                          saveDefault: true,
                                        });
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={g.kind === "overseas" ? "Pick overseas supplier…" : "Pick supplier…"} /></SelectTrigger>
                                    <SelectContent>
                                      {supplierOptions.map((s: any) => (
                                        <SelectItem key={s.id} value={s.id}>
                                          {s.name}{g.kind === "overseas" ? ` (${s.currency})` : ""}
                                        </SelectItem>
                                      ))}
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
                              <TableCell className="text-right text-sm font-medium">
                                {g.kind === "overseas" ? fmtMoney(subtotal, e?.currency || "USD") : money(subtotal)}
                              </TableCell>
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
              );
            })}
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function ItemDetails({
  row: r,
  money,
  isAdmin,
  onHistory,
  onCostHistory,
  onToggleInclude,
}: {
  row: Row;
  money: (n: number) => string;
  isAdmin: boolean;
  onHistory: () => void;
  /** Omitted for non-admins — cost history is admin-only. */
  onCostHistory?: () => void;
  /** Count a set-aside big order after all, or set it aside again. */
  onToggleInclude: (lineId: string) => void;
}) {
  const unit = r.item.base_unit || "pcs";
  const lead = r.lead;
  const learned = lead.learned;
  const link = r.itemSupplier;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3 text-sm">
        <div className="rounded-lg border bg-background p-3 space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Sales ({unit})</div>
          <Detail label="Last 7 days">{fmtUnits(r.q7)}</Detail>
          <Detail label="Last 30 days">{fmtUnits(r.q30)}</Detail>
          <Detail label={`Last ${HISTORY_DAYS} days`}>{fmtUnits(r.q90)}{isAdmin && <span className="text-muted-foreground"> · {money(r.a90)}</span>}</Detail>
          <Detail label="Rate used">
            <span className="font-medium">{r.rate > 0 ? `${r.rate < 1 ? r.rate.toFixed(2) : r.rate.toFixed(1)} / day` : "No sales"}</span>
            {r.demand.usedDays > 0 && (
              <div className="text-[11px] text-muted-foreground">
                {fmtUnits(r.demand.usedUnits)} sales over {r.demand.usedDays} day{r.demand.usedDays === 1 ? "" : "s"} with stock
              </div>
            )}
          </Detail>
          {r.demand.shortDays > 0 && (
            <Detail label="Not counted">
              <span className="text-muted-foreground">{r.demand.shortDays} day{r.demand.shortDays === 1 ? "" : "s"} too low on stock to sell</span>
            </Detail>
          )}
          {[...r.demand.leftOut.map((o) => ({ o, inc: false })), ...r.demand.included.map((o) => ({ o, inc: true }))].map(({ o, inc }) => (
            <Detail key={o.id} label={inc ? "Big order (counted)" : "Left out"}>
              <span className="text-muted-foreground">{fmtUnits(o.units)} {unit} · {o.ref}</span>{" "}
              <button type="button" onClick={() => onToggleInclude(o.id)} className="text-xs text-primary hover:underline">
                {inc ? "Leave out" : "Include"}
              </button>
            </Detail>
          ))}
          <p className="pt-1 text-[11px] text-muted-foreground">
            Recent weeks count most. Days too low on stock to fill a usual order, and one-off big orders, are left out. Cuts count as their share of a {unit}.
          </p>
        </div>

        <div className="rounded-lg border bg-background p-3 space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Lead time</div>
          <Detail label="Using">
            <span className="font-medium">{lead.days} days</span>{" "}
            <span className="text-muted-foreground">
              {lead.source === "set" ? "(set on supplier link)" : lead.source === "history" ? "(past deliveries)" : "(default)"}
            </span>
          </Detail>
          {learned ? (
            <>
              <Detail label="Past deliveries">
                {Math.round(learned.days)} days <span className="text-muted-foreground">· typical of {learned.deliveries}</span>
              </Detail>
              {learned.productionDays != null && learned.transitDays != null && (
                <Detail label="Split">{Math.round(learned.productionDays)} production + {Math.round(learned.transitDays)} transit</Detail>
              )}
              {learned.onTimePct != null && <Detail label="On time">{learned.onTimePct.toFixed(0)}%</Detail>}
            </>
          ) : (
            <Detail label="Past deliveries"><span className="text-muted-foreground">None recorded</span></Detail>
          )}
          {lead.mismatch && (
            <p className="pt-1 text-[11px] text-amber-600">
              Deliveries usually take {Math.round(learned!.days)} days, not the {lead.setDays} set — consider updating the supplier link.
            </p>
          )}
          {lead.source === "default" && (
            <p className="pt-1 text-[11px] text-amber-600">
              No lead time set and no deliveries recorded. Set it in Inventory → item → Suppliers.
            </p>
          )}
          <p className="pt-1 text-[11px] text-muted-foreground">
            Order qty covers the lead time, {SAFETY_DAYS} days of safety stock and {COVER_DAYS} days after delivery{link?.moq ? `, at least the MOQ of ${link.moq}` : ""}.
          </p>
        </div>

        <div className="rounded-lg border bg-background p-3 space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 font-medium">Supplier & orders</div>
          <Detail label="Supplier">{r.supplier ? `${r.supplier.name}${r.supplier.overseas ? " (overseas)" : ""}` : <span className="text-amber-600">None — add one in Inventory → Suppliers</span>}</Detail>
          {isAdmin && link && (
            <Detail label="Latest cost">{currencySymbolForDisplay(link.currency)}{Number(link.latest_cost).toFixed(2)} <span className="text-[10px] text-muted-foreground">{link.currency}</span></Detail>
          )}
          {isAdmin && r.lastCost && (
            <Detail label="Last cost change">{money(r.lastCost.cost)} <span className="text-muted-foreground">· {format(parseISO(r.lastCost.date), "MMM d, yyyy")}</span></Detail>
          )}
          {link?.last_purchased_at && <Detail label="Last ordered">{format(parseISO(link.last_purchased_at), "MMM d, yyyy")}</Detail>}
          {r.openPos.length === 0 ? (
            <Detail label="On order"><span className="text-muted-foreground">Nothing</span></Detail>
          ) : (
            r.openPos.map((po) => (
              <Detail key={po.number} label={po.number}>
                {fmtUnits(po.remaining)} {unit} <span className="text-muted-foreground">· {po.expected ? `due ${format(parseISO(po.expected), "MMM d")}` : "no date"}</span>
              </Detail>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* A new tab, so the list you were working through is still there when
            you have finished reading the history. Falls back to the name: an
            item without a SKU would otherwise search for nothing. */}
        <Link to={`/business-insights?item=${encodeURIComponent(r.item.sku || r.item.name)}`} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="outline"><BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Sales History</Button>
        </Link>
        <Button size="sm" variant="outline" onClick={onHistory}>
          <History className="h-3.5 w-3.5 mr-1.5" /> Inventory History
        </Button>
        {onCostHistory && (
          <Button size="sm" variant="outline" onClick={onCostHistory}>
            <DollarSign className="h-3.5 w-3.5 mr-1.5" /> Cost History
          </Button>
        )}
      </div>
    </div>
  );
}

function currencySymbolForDisplay(c: string) {
  if (c === "RMB") return "¥";
  if (c === "USD") return "$";
  return "₱";
}
