import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { peso } from "@/lib/currency";
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/StatCard";
import { SortableHeader } from "@/components/SortableHeader";
import { useSort } from "@/hooks/use-sort";
import { cn } from "@/lib/utils";
import { CalendarIcon, ShoppingCart, Receipt, DollarSign, Package, Search, ChevronRight, ChevronDown } from "lucide-react";

type RangePreset = "today" | "7d" | "30d" | "month" | "custom";
type SourceFilter = "all" | "online" | "invoice";

interface SaleTxn {
  date: string;
  who: string;
  source: "online" | "invoice";
  reference: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface ItemAgg {
  key: string;
  itemId: string | null;
  variationId: string | null;
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

export default function BusinessInsightsPage() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [source, setSource] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");

  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    if (preset === "today") return { dateFrom: startOfDay(now), dateTo: endOfDay(now) };
    if (preset === "7d") return { dateFrom: startOfDay(subDays(now, 6)), dateTo: endOfDay(now) };
    if (preset === "30d") return { dateFrom: startOfDay(subDays(now, 29)), dateTo: endOfDay(now) };
    if (preset === "month") return { dateFrom: startOfMonth(now), dateTo: endOfMonth(now) };
    return {
      dateFrom: customFrom ? startOfDay(customFrom) : startOfDay(subDays(now, 29)),
      dateTo: customTo ? endOfDay(customTo) : endOfDay(now),
    };
  }, [preset, customFrom, customTo]);

  const fromStr = format(dateFrom, "yyyy-MM-dd");
  const toStr = format(dateTo, "yyyy-MM-dd");

  // Online sales (qty from quantity column, price posted_price)
  const { data: onlineRows = [] } = useQuery({
    queryKey: ["bi_online", fromStr, toStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("online_sales")
        .select("id, quantity, posted_price, item_id, variation_id, product_name, items(name, sku), item_variations(name, sku)")
        .eq("status", "completed")
        .gte("order_date", fromStr)
        .lte("order_date", toStr);
      return data || [];
    },
  });

  // Invoice items (only for confirmed/paid invoices in date range)
  const { data: invoiceRows = [] } = useQuery({
    queryKey: ["bi_invoice", fromStr, toStr],
    queryFn: async () => {
      const { data: invs } = await supabase
        .from("invoices")
        .select("id")
        .in("status", ["confirmed", "paid"])
        .gte("invoice_date", fromStr)
        .lte("invoice_date", toStr);
      const ids = (invs || []).map((i: any) => i.id);
      if (!ids.length) return [];
      const { data } = await supabase
        .from("invoice_items")
        .select("id, invoice_id, quantity, unit_price, item_id, variation_id, item_name, items(name, sku), item_variations(name, sku)")
        .in("invoice_id", ids);
      return data || [];
    },
  });

  // Aggregate per item/variation key
  const aggregated = useMemo<ItemAgg[]>(() => {
    const map = new Map<string, ItemAgg>();
    const get = (key: string, init: Omit<ItemAgg, "qtyOnline" | "qtyInvoice" | "qtyTotal" | "revenueOnline" | "revenueInvoice" | "revenueTotal" | "orders">) => {
      let row = map.get(key);
      if (!row) {
        row = { ...init, qtyOnline: 0, qtyInvoice: 0, qtyTotal: 0, revenueOnline: 0, revenueInvoice: 0, revenueTotal: 0, orders: 0 };
        map.set(key, row);
      }
      return row;
    };

    if (source !== "invoice") {
      for (const r of onlineRows as any[]) {
        const itemId = r.item_id || null;
        const variationId = r.variation_id || null;
        const name = r.item_variations?.name ? `${r.items?.name || r.product_name} — ${r.item_variations.name}` : (r.items?.name || r.product_name || "Unknown");
        const sku = r.item_variations?.sku || r.items?.sku || "—";
        const key = variationId ? `v:${variationId}` : itemId ? `i:${itemId}` : `n:${name}`;
        const row = get(key, { key, itemId, variationId, name, sku });
        const qty = Number(r.quantity || 0);
        const rev = Number(r.posted_price || 0) * qty;
        row.qtyOnline += qty;
        row.revenueOnline += rev;
        row.orders += 1;
      }
    }

    if (source !== "online") {
      for (const r of invoiceRows as any[]) {
        const itemId = r.item_id || null;
        const variationId = r.variation_id || null;
        const name = r.item_variations?.name ? `${r.items?.name || r.item_name} — ${r.item_variations.name}` : (r.items?.name || r.item_name || "Unknown");
        const sku = r.item_variations?.sku || r.items?.sku || "—";
        const key = variationId ? `v:${variationId}` : itemId ? `i:${itemId}` : `n:${name}`;
        const row = get(key, { key, itemId, variationId, name, sku });
        const qty = Number(r.quantity || 0);
        const rev = Number(r.unit_price || 0) * qty;
        row.qtyInvoice += qty;
        row.revenueInvoice += rev;
        row.orders += 1;
      }
    }

    const arr = Array.from(map.values()).map((r) => ({
      ...r,
      qtyTotal: r.qtyOnline + r.qtyInvoice,
      revenueTotal: r.revenueOnline + r.revenueInvoice,
    }));

    const q = search.trim().toLowerCase();
    return q
      ? arr.filter((r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q))
      : arr;
  }, [onlineRows, invoiceRows, source, search]);

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

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Business Insights</h1>
        <p className="page-description">All sales (online + invoices) and quantity sold per item, in one place.</p>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-card p-3 sm:p-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          {([
            { v: "today", l: "Today" },
            { v: "7d", l: "7d" },
            { v: "30d", l: "30d" },
            { v: "month", l: "This month" },
            { v: "custom", l: "Custom" },
          ] as { v: RangePreset; l: string }[]).map((p) => (
            <Button
              key={p.v}
              variant={preset === p.v ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPreset(p.v)}
            >
              {p.l}
            </Button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-7 text-xs w-[120px] justify-start", !customFrom && "text-muted-foreground")}>
                  <CalendarIcon className="h-3 w-3 mr-1" />
                  {customFrom ? format(customFrom, "MM/dd/yyyy") : "From"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <span className="text-xs text-muted-foreground">—</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-7 text-xs w-[120px] justify-start", !customTo && "text-muted-foreground")}>
                  <CalendarIcon className="h-3 w-3 mr-1" />
                  {customTo ? format(customTo, "MM/dd/yyyy") : "To"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
        )}
        <div className="h-5 w-px bg-border mx-1" />
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "online", "invoice"] as SourceFilter[]).map((s) => (
            <Button
              key={s}
              variant={source === s ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs capitalize"
              onClick={() => setSource(s)}
            >
              {s === "all" ? "All sources" : s === "online" ? "Online only" : "Invoice only"}
            </Button>
          ))}
        </div>
        <div className="ml-auto relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item or SKU..."
            className="h-7 text-xs pl-7 w-[220px]"
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard title="Online Revenue" value={peso(totals.revOnline)} icon={ShoppingCart} variant="success" />
        <StatCard title="Invoice Revenue" value={peso(totals.revInvoice)} icon={Receipt} variant="success" />
        <StatCard title="Total Revenue" value={peso(totals.revTotal)} icon={DollarSign} variant="success" />
        <StatCard title="Units Sold" value={totals.qty} icon={Package} />
      </div>

      <div className="text-xs text-muted-foreground">
        {format(dateFrom, "MMM d, yyyy")} — {format(dateTo, "MMM d, yyyy")} · {sorted.length} item{sorted.length === 1 ? "" : "s"}
      </div>

      {/* Table */}
      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader sortKey="name" label="Item" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="sku" label="SKU" sort={sort} onToggle={toggle} />
              <SortableHeader sortKey="qtyOnline" label="Qty Online" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="qtyInvoice" label="Qty Invoice" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="qtyTotal" label="Qty Total" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="revenueOnline" label="Online ₱" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="revenueInvoice" label="Invoice ₱" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="revenueTotal" label="Total ₱" sort={sort} onToggle={toggle} align="right" />
              <SortableHeader sortKey="orders" label="Orders" sort={sort} onToggle={toggle} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-xs text-muted-foreground py-10">
                  No sales in this range.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r) => (
                <TableRow key={r.key} className="hover:bg-muted/30">
                  <TableCell className="font-medium text-sm">{r.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{r.sku}</TableCell>
                  <TableCell className="text-sm text-right">{r.qtyOnline || "—"}</TableCell>
                  <TableCell className="text-sm text-right">{r.qtyInvoice || "—"}</TableCell>
                  <TableCell className="text-sm text-right font-semibold">{r.qtyTotal}</TableCell>
                  <TableCell className="text-sm text-right">{r.revenueOnline ? peso(r.revenueOnline) : "—"}</TableCell>
                  <TableCell className="text-sm text-right">{r.revenueInvoice ? peso(r.revenueInvoice) : "—"}</TableCell>
                  <TableCell className="text-sm text-right font-semibold">{peso(r.revenueTotal)}</TableCell>
                  <TableCell className="text-sm text-right text-muted-foreground">{r.orders}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
