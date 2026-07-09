import { Fragment, useMemo, useState } from "react";
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
import { StatCard } from "@/components/StatCard";
import { SortableHeader } from "@/components/SortableHeader";
import { useSort } from "@/hooks/use-sort";
import { cn } from "@/lib/utils";
import { CalendarIcon, ShoppingCart, Receipt, DollarSign, Package, Search, ChevronRight, ChevronDown, Download, TrendingUp, TrendingDown, AlertTriangle, ShoppingBag, Warehouse, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import * as XLSX from "xlsx";
import { toast } from "sonner";

type RangePreset = "today" | "7d" | "30d" | "month" | "all" | "custom";
type SourceFilter = "all" | "online" | "invoice";
type PaymentFilter = "all" | "paid" | "unpaid";

interface SaleTxn {
  date: string;
  customer: string;
  agent: string;
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
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const money = (n: number) => (isAdmin ? peso(n) : "—");
  const [preset, setPreset] = useState<RangePreset>("today");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [source, setSource] = useState<SourceFilter>("all");
  const [payment, setPayment] = useState<PaymentFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  // Online sales (qty from quantity column, price posted_price)
  const { data: onlineRows = [] } = useQuery({
    queryKey: ["bi_online", fromStr, toStr, payment],
    queryFn: async () => {
      return fetchAll(() => {
        let q = supabase
          .from("online_sales")
          .select("id, order_number, order_date, sales_channel, quantity, posted_price, item_id, variation_id, product_name, payment_status, items(name, sku), item_variations(name, sku)")
          .eq("status", "completed")
          .gte("order_date", fromStr)
          .lte("order_date", toStr);
        if (payment !== "all") q = q.eq("payment_status", payment);
        return q;
      });
    },
  });

  // Invoice items (only for confirmed/paid invoices in date range)
  const { data: invoiceRows = [] } = useQuery({
    queryKey: ["bi_invoice", fromStr, toStr, payment],
    queryFn: async () => {
      const statuses =
        payment === "paid" ? ["paid", "completed"] : payment === "unpaid" ? ["confirmed", "unpaid", "shipped"] : ["confirmed", "paid", "unpaid", "shipped", "completed"];

      const invs = await fetchAll<any>(() =>
        supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date, sales_agent, customer_id, status, customers(name)")
          .in("status", statuses as any)
          .gte("invoice_date", fromStr)
          .lte("invoice_date", toStr)
      );
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


  // Aggregate per item/variation key
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
        const name = r.item_variations?.name ? `${r.items?.name || r.product_name} — ${r.item_variations.name}` : (r.items?.name || r.product_name || "Unknown");
        const sku = r.item_variations?.sku || r.items?.sku || "—";
        const key = variationId ? `v:${variationId}` : itemId ? `i:${itemId}` : `n:${name}`;
        const row = get(key, { key, itemId, variationId, name, sku });
        const qty = Number(r.quantity || 0);
        const unit = Number(r.posted_price || 0);
        const rev = unit * qty;
        row.qtyOnline += qty;
        row.revenueOnline += rev;
        row.orders += 1;
        const channel = String(r.sales_channel || "online");
        row.txns.push({
          date: r.order_date || "",
          customer: channel.charAt(0).toUpperCase() + channel.slice(1),
          agent: "—",
          source: "online",
          reference: r.order_number || "—",
          quantity: qty,
          unitPrice: unit,
          amount: rev,
        });
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
        const unit = Number(r.unit_price || 0);
        const rev = unit * qty;
        row.qtyInvoice += qty;
        row.revenueInvoice += rev;
        row.orders += 1;
        const inv = r._invoice || {};
        row.txns.push({
          date: inv.invoice_date || "",
          customer: inv.customers?.name || "Walk-in",
          agent: inv.sales_agent || "—",
          source: "invoice",
          reference: inv.invoice_number || "—",
          quantity: qty,
          unitPrice: unit,
          amount: rev,
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

  // Customer analytics: separate online vs invoice
  const customerStats = useMemo(() => {
    // Online: group by sales_channel as "customer proxy" (no real customer on online)
    const onlineChannels = new Map<string, { revenue: number; orders: Set<string> }>();
    for (const r of onlineRows as any[]) {
      const channel = String(r.sales_channel || "others");
      const orderNum = String(r.order_number || r.id);
      const rev = Number(r.posted_price || 0) * Number(r.quantity || 0);
      const e = onlineChannels.get(channel) || { revenue: 0, orders: new Set() };
      e.revenue += rev;
      e.orders.add(orderNum);
      onlineChannels.set(channel, e);
    }
    const onlineUniqueOrders = new Set<string>();
    let onlineRevenue = 0;
    for (const r of onlineRows as any[]) {
      onlineUniqueOrders.add(String(r.order_number || r.id));
      onlineRevenue += Number(r.posted_price || 0) * Number(r.quantity || 0);
    }

    // Invoice: group by customer
    const invoiceCustomers = new Map<string, { name: string; revenue: number; orders: Set<string> }>();
    let invoiceRevenue = 0;
    for (const r of invoiceRows as any[]) {
      const inv = r._invoice || {};
      const custId = inv.customer_id || `walkin:${inv.id}`;
      const name = inv.customers?.name || "Walk-in";
      const rev = Number(r.unit_price || 0) * Number(r.quantity || 0);
      invoiceRevenue += rev;
      const e = invoiceCustomers.get(custId) || { name, revenue: 0, orders: new Set() };
      e.revenue += rev;
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
    if (sorted.length === 0) {
      toast.error("Nothing to export for the current filter");
      return;
    }
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
        }
        return base;
      }),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Items");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txnRows), "Transactions");
    const range = `${format(dateFrom, "yyyyMMdd")}-${format(dateTo, "yyyyMMdd")}`;
    XLSX.writeFile(wb, `business-insights_${source}_${range}.xlsx`);
    toast.success(`Exported ${summaryRows.length} item${summaryRows.length === 1 ? "" : "s"}`);
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Business Insights</h1>
        <p className="page-description">All sales (online + invoices) per item. Click a row to see when, who, and how many.</p>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-card p-3 sm:p-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          {([
            { v: "today", l: "Today" },
            { v: "7d", l: "7d" },
            { v: "30d", l: "30d" },
            { v: "month", l: "This month" },
            { v: "all", l: "All" },
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
        <div className="h-5 w-px bg-border mx-1" />
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "paid", "unpaid"] as PaymentFilter[]).map((p) => (
            <Button
              key={p}
              variant={payment === p ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs capitalize"
              onClick={() => setPayment(p)}
            >
              {p === "all" ? "All payments" : p === "paid" ? "Paid only" : "Unpaid only"}
            </Button>
          ))}
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

      {/* Summary cards */}
      <div className={cn("grid gap-3 sm:gap-4 grid-cols-2", isAdmin ? "lg:grid-cols-4" : "lg:grid-cols-1")}>
        {isAdmin && <StatCard title="Online Revenue" value={money(totals.revOnline)} icon={ShoppingCart} variant="success" />}
        {isAdmin && <StatCard title="Invoice Revenue" value={money(totals.revInvoice)} icon={Receipt} variant="success" />}
        {isAdmin && <StatCard title="Total Revenue" value={money(totals.revTotal)} icon={DollarSign} variant="success" />}
        <StatCard title="Units Sold" value={totals.qty} icon={Package} />
      </div>

      <div className="text-xs text-muted-foreground">
        {format(dateFrom, "MMM d, yyyy")} — {format(dateTo, "MMM d, yyyy")} · {sorted.length} item{sorted.length === 1 ? "" : "s"}
      </div>

      {/* Customer Analytics */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Online */}
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
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium text-right">Orders</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                  <th className="px-3 py-2 font-medium text-right">Avg/Order</th>
                </tr>
              </thead>
              <tbody>
                {customerStats.onlineList.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No online sales</td></tr>
                ) : customerStats.onlineList.map((c) => (
                  <tr key={c.name} className="border-t">
                    <td className="px-3 py-1.5 capitalize">{c.name}</td>
                    <td className="px-3 py-1.5 text-right">{c.orders}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{money(c.revenue)}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{money(c.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Invoice */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold">Invoice Customers</h2>
              <p className="text-xs text-muted-foreground">Unique customers with confirmed/paid invoices</p>
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
          <div className="rounded-md border overflow-hidden max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 sticky top-0">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium text-right">Orders</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                  <th className="px-3 py-2 font-medium text-right">Avg/Order</th>
                </tr>
              </thead>
              <tbody>
                {customerStats.invoiceList.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No invoice sales</td></tr>
                ) : customerStats.invoiceList.map((c, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5">{c.name}</td>
                    <td className="px-3 py-1.5 text-right">{c.orders}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{money(c.revenue)}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{money(c.avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="data-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
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
                <TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-10">
                  No sales in this range.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r) => {
                const isOpen = expanded.has(r.key);
                return (
                  <Fragment key={r.key}>
                    <TableRow
                      
                      className="hover:bg-muted/30 cursor-pointer"
                      onClick={() => toggleExpand(r.key)}
                    >
                      <TableCell className="w-8 p-2 align-middle">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{r.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{r.sku}</TableCell>
                      <TableCell className="text-sm text-right">{r.qtyOnline || "—"}</TableCell>
                      <TableCell className="text-sm text-right">{r.qtyInvoice || "—"}</TableCell>
                      <TableCell className="text-sm text-right font-semibold">{r.qtyTotal}</TableCell>
                      <TableCell className="text-sm text-right">{r.revenueOnline ? money(r.revenueOnline) : "—"}</TableCell>
                      <TableCell className="text-sm text-right">{r.revenueInvoice ? money(r.revenueInvoice) : "—"}</TableCell>
                      <TableCell className="text-sm text-right font-semibold">{money(r.revenueTotal)}</TableCell>
                      <TableCell className="text-sm text-right text-muted-foreground">{r.orders}</TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow key={`${r.key}-detail`} className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={10} className="p-0">
                          <div className="px-4 py-3">
                            <div className="text-xs font-semibold text-muted-foreground mb-2">
                              Sales history ({r.txns.length})
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
                                    <th className="px-3 py-2 font-medium text-right">Qty</th>
                                    <th className="px-3 py-2 font-medium text-right">Unit ₱</th>
                                    <th className="px-3 py-2 font-medium text-right">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.txns.map((t, i) => (
                                    <tr key={i} className="border-t">
                                      <td className="px-3 py-1.5 whitespace-nowrap">
                                        {t.date ? format(new Date(t.date), "MMM d, yyyy") : "—"}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        <span
                                          className={cn(
                                            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                                            t.source === "online"
                                              ? "bg-primary/10 text-primary"
                                              : "bg-secondary text-secondary-foreground",
                                          )}
                                        >
                                          {t.source === "online" ? "Online" : "Invoice"}
                                        </span>
                                      </td>
                                      <td className="px-3 py-1.5">{t.customer}</td>
                                      <td className="px-3 py-1.5 text-muted-foreground">{t.agent}</td>
                                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{t.reference}</td>
                                      <td className="px-3 py-1.5 text-right font-semibold">{t.quantity}</td>
                                      <td className="px-3 py-1.5 text-right">{money(t.unitPrice)}</td>
                                      <td className="px-3 py-1.5 text-right">{money(t.amount)}</td>
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
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
