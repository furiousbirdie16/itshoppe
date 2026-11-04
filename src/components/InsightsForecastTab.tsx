import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay, startOfWeek, subDays } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { FileText, PackagePlus, TrendingUp, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard, FormulaRow } from "@/components/StatCard";
import { SortableHeader } from "@/components/SortableHeader";
import { useSort } from "@/hooks/use-sort";
import { useInsightsPurchases } from "@/hooks/use-insights-purchases";
import { makeBuckets } from "@/lib/insights";
import { HISTORY_DAYS, SAFETY_DAYS, itemDemand, planReorder, resolveLeadTime, stockUnitsSold, weightedDailyRate, type DemandSale } from "@/lib/restock";
import { useRestockInputs } from "@/hooks/use-restock-inputs";
import { useStockSplit } from "@/hooks/use-stock-split";
import { useBranch } from "@/contexts/BranchContext";
import { BranchStockSplit } from "@/components/BranchStockSplit";
import { cn } from "@/lib/utils";

interface Props {
  branchId: string | null;
  isAdmin: boolean;
  money: (n: number) => string;
  /** Items after the page's category / brand / supplier filters, with live stock in `quantity`. */
  items: any[];
  /** Variations (with `factor`) of those items. */
  variations: any[];
  /** Null when no item filter is on. */
  allowedItemIds: Set<string> | null;
}

type Horizon = 30 | 60 | 90;

const ACTUAL_COLOR = "hsl(var(--primary))";
const FORECAST_COLOR = "hsl(var(--primary) / 0.35)";
const compact = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`;
const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function InsightsForecastTab({ branchId, isAdmin, money, items, variations, allowedItemIds }: Props) {
  const [horizon, setHorizon] = useState<Horizon>(30);
  // Fixed for the life of the tab so the memos below do not recompute every render.
  const today = useMemo(() => startOfDay(new Date()), []);
  const todayStr = iso(today);
  const historyFrom = iso(subDays(today, HISTORY_DAYS));

  const { orders, onOrderByItem, leadTimeBySupplier } = useInsightsPurchases(branchId);
  // Same inputs as the Reorder List, so a big order left out there is left out here too.
  const { adjustmentsByItem, receiptsByItem, includeIds } = useRestockInputs(orders, today, branchId);
  const { branches } = useBranch();
  const combinedBranches = !branchId && branches.length > 1;
  const stockSplit = useStockSplit();

  // Every booked sale (paid or not) over the last 90 days — demand, not cash.
  const { data: sales, isLoading } = useQuery({
    queryKey: ["bi_fc_sales", branchId, historyFrom],
    queryFn: async () => {
      const online = await fetchAllRows<any>(() => {
        let q = supabase
          .from("online_sales")
          .select("id, order_number, order_date, quantity, posted_price, item_id, variation_id")
          .eq("status", "completed")
          .gte("order_date", historyFrom)
          .order("id", { ascending: true });
        if (branchId) q = q.eq("branch_id", branchId);
        return q;
      });
      const invs = await fetchAllRows<any>(() => {
        let q = supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date")
          .in("status", ["confirmed", "paid", "unpaid", "shipped", "completed"] as any)
          .gte("invoice_date", historyFrom)
          .order("id", { ascending: true });
        if (branchId) q = q.eq("branch_id", branchId);
        return q;
      });
      const invById = new Map<string, any>(invs.map((i: any) => [i.id, i]));
      const ids = invs.map((i: any) => i.id);
      const lines: any[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const rows = await fetchAllRows<any>(() =>
          supabase.from("invoice_items").select("id, invoice_id, quantity, unit_price, item_id, variation_id").in("invoice_id", chunk).order("id", { ascending: true })
        );
        lines.push(...rows);
      }
      return [
        ...online.map((r: any) => ({ id: `onl:${r.id}`, ref: r.order_number || "Online order", date: r.order_date, qty: Number(r.quantity || 0), amount: Number(r.posted_price || 0) * Number(r.quantity || 0), itemId: r.item_id, variationId: r.variation_id })),
        ...lines.map((r: any) => ({ id: `inv:${r.id}`, ref: invById.get(r.invoice_id)?.invoice_number || "Invoice", date: invById.get(r.invoice_id)?.invoice_date, qty: Number(r.quantity || 0), amount: Number(r.unit_price || 0) * Number(r.quantity || 0), itemId: r.item_id, variationId: r.variation_id })),
      ].filter((r) => r.date) as { id: string; ref: string; date: string; qty: number; amount: number; itemId: string | null; variationId: string | null }[];
    },
  });

  const { data: supplierLinks = [] } = useQuery({
    queryKey: ["bi_fc_item_suppliers"],
    queryFn: async () =>
      fetchAllRows<any>(() =>
        supabase.from("item_suppliers").select("id, item_id, supplier_id, overseas_supplier_id, is_primary, lead_time_days, moq").order("id", { ascending: true })
      ),
  });

  // Money in / out — admin only (payables and balances are finance data).
  const { data: cash } = useQuery({
    queryKey: ["bi_fc_cash", branchId],
    enabled: isAdmin,
    queryFn: async () => {
      const [invoices, onlineUnpaid, payables] = await Promise.all([
        fetchAllRows<any>(() => {
          let q = supabase
            .from("invoices")
            .select("id, due_date, invoice_date, total_amount, amount_received")
            .in("status", ["confirmed", "unpaid", "shipped"] as any)
            .order("id", { ascending: true });
          if (branchId) q = q.eq("branch_id", branchId);
          return q;
        }),
        fetchAllRows<any>(() => {
          let q = supabase
            .from("online_sales")
            .select("id, quantity, posted_price")
            .eq("status", "completed")
            .eq("payment_status", "unpaid")
            .order("id", { ascending: true });
          if (branchId) q = q.eq("branch_id", branchId);
          return q;
        }),
        // Bills are company-wide (no branch), so they are only counted on the all-branches view.
        branchId
          ? Promise.resolve([] as any[])
          : fetchAllRows<any>(() =>
              supabase.from("payables").select("id, amount, amount_paid, due_date, status").not("status", "in", "(paid,cleared,cancelled)").order("id", { ascending: true })
            ).catch(() => [] as any[]),
      ]);
      return { invoices, onlineUnpaid, payables };
    },
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["bi_fc_quotes", branchId],
    queryFn: async () =>
      fetchAllRows<any>(() => {
        let q = supabase
          .from("quotations")
          .select("id, status, total_amount, valid_until, quotation_date")
          .gte("quotation_date", iso(subDays(today, 365)))
          .order("id", { ascending: true });
        if (branchId) q = q.eq("branch_id", branchId);
        return q;
      }),
  });

  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const variationById = useMemo(() => new Map<string, any>(variations.map((v) => [v.id, v])), [variations]);
  const itemById = useMemo(() => new Map<string, any>(items.map((i) => [i.id, i])), [items]);

  // ---- Demand -------------------------------------------------------------
  const demand = useMemo(() => {
    const revenueByAgo = new Map<number, number>();
    const linesByItem = new Map<string, DemandSale[]>();
    let itemRevenue = 0;
    let itemCost = 0;
    const costById = new Map<string, number>(items.map((i) => [i.id, Number(i.cost_price || 0)]));
    for (const r of sales || []) {
      if (allowedItemIds && (!r.itemId || !allowedItemIds.has(r.itemId))) continue;
      const ago = differenceInCalendarDays(today, parseISO(r.date));
      if (ago < 0 || ago > HISTORY_DAYS) continue;
      if (!r.itemId && ago >= 1) revenueByAgo.set(ago, (revenueByAgo.get(ago) || 0) + r.amount);
      if (!r.itemId) continue;
      // Stock units used: packs take `factor` units, cuts a share of a roll.
      const base = stockUnitsSold(r.qty, r.variationId ? variationById.get(r.variationId) : null, itemById.get(r.itemId)?.units_per_stock);
      // Today's sales only help rebuild stock; rates use whole days.
      const arr = linesByItem.get(r.itemId) || [];
      arr.push({ id: r.id, ref: r.ref, daysAgo: ago, units: base });
      linesByItem.set(r.itemId, arr);
      if (ago < 1) continue;
      revenueByAgo.set(ago, (revenueByAgo.get(ago) || 0) + r.amount);
      if (costById.has(r.itemId)) {
        itemRevenue += r.amount;
        itemCost += base * (costById.get(r.itemId) || 0);
      }
    }
    const dailyRevenue = weightedDailyRate(revenueByAgo);
    const last = Array.from(revenueByAgo.entries()).filter(([ago]) => ago <= horizon).reduce((s, [, v]) => s + v, 0);

    const rateByItem = new Map<string, number>();
    for (const it of items) {
      const lines = linesByItem.get(it.id);
      if (!lines) continue;
      const d = itemDemand({
        sales: lines,
        stockNow: Number(it.quantity || 0),
        receipts: receiptsByItem.get(it.id) || [],
        adjustments: adjustmentsByItem.get(it.id) || [],
        createdAt: it.created_at,
        today,
        includeIds,
      });
      rateByItem.set(it.id, d.rate);
    }
    const margin = itemRevenue > 0 ? (itemRevenue - itemCost) / itemRevenue : 0;
    const units = Array.from(rateByItem.values()).reduce((s, v) => s + v, 0) * horizon;
    return { dailyRevenue, revenue: dailyRevenue * horizon, lastPeriodRevenue: last, margin, units, rateByItem, revenueByAgo };
  }, [sales, items, allowedItemIds, variationById, itemById, receiptsByItem, adjustmentsByItem, includeIds, horizon, today]);

  // Weekly chart: last 12 weeks actual, then the forecast horizon.
  const chart = useMemo(() => {
    const start = startOfWeek(subDays(today, 7 * 12));
    const end = addDays(today, horizon);
    const { keyOf, slots } = makeBuckets(start, end, "week");
    const thisWeek = keyOf(today);
    const pts = new Map(slots.map((s) => [s.key, { label: s.label, title: s.title, actual: 0, forecast: 0, future: s.key > thisWeek }]));
    for (const [ago, v] of demand.revenueByAgo) {
      const pt = pts.get(keyOf(subDays(today, ago)));
      if (pt) pt.actual += v;
    }
    for (let i = 0; i < horizon; i++) {
      const pt = pts.get(keyOf(addDays(today, i)));
      if (pt) pt.forecast += demand.dailyRevenue;
    }
    // The current week shows what has actually sold so far; forecast starts next week.
    for (const pt of pts.values()) if (!pt.future) pt.forecast = 0;
    const out = Array.from(pts.values()).map((p) => ({ ...p, actual: p.future ? 0 : p.actual }));
    // A horizon ending mid-week leaves a stub that reads as a sales drop — leave it off.
    const last = out[out.length - 1];
    if (last?.future && last.forecast < demand.dailyRevenue * 7 - 0.01) out.pop();
    return out;
  }, [demand, horizon, today]);

  // ---- Cash in / out ------------------------------------------------------
  const cashRows = useMemo(() => {
    const slots = [
      { key: "overdue", label: "Overdue", in: 0, out: 0 },
      { key: "week", label: "Due in the next 7 days", in: 0, out: 0 },
      { key: "rest", label: `Due in 8–${horizon} days`, in: 0, out: 0 },
      { key: "later", label: `Later or no due date`, in: 0, out: 0 },
    ];
    const slotFor = (due: string | null) => {
      if (!due) return slots[3];
      const d = differenceInCalendarDays(parseISO(due), today);
      return d < 0 ? slots[0] : d < 7 ? slots[1] : d <= horizon ? slots[2] : slots[3];
    };
    let marketplace = 0;
    if (cash) {
      for (const inv of cash.invoices) {
        const bal = Number(inv.total_amount || 0) - Number(inv.amount_received || 0);
        if (bal > 0) slotFor(inv.due_date).in += bal;
      }
      for (const o of cash.onlineUnpaid) marketplace += Number(o.posted_price || 0) * Number(o.quantity || 0);
      for (const p of cash.payables) {
        const bal = Number(p.amount || 0) - Number(p.amount_paid || 0);
        if (bal > 0) slotFor(p.due_date).out += bal;
      }
    }
    for (const po of orders) if (po.owedPhp > 0) slotFor(po.dueDate || po.expected).out += po.owedPhp;
    const within = slots.slice(0, 3);
    return {
      slots,
      marketplace,
      dueIn: within.reduce((s, r) => s + r.in, 0),
      dueOut: within.reduce((s, r) => s + r.out, 0),
    };
  }, [cash, orders, horizon, today]);

  // ---- Quotations ---------------------------------------------------------
  const pipeline = useMemo(() => {
    const open = quotes.filter((q) => q.status === "sent" && (!q.valid_until || q.valid_until >= todayStr));
    const decidedFrom = iso(subDays(today, 180));
    const decided = quotes.filter((q) => (q.status === "accepted" || q.status === "rejected") && q.quotation_date >= decidedFrom);
    const won = decided.filter((q) => q.status === "accepted").length;
    const winRate = decided.length >= 3 ? won / decided.length : null;
    const value = open.reduce((s, q) => s + Number(q.total_amount || 0), 0);
    return { count: open.length, value, winRate, expected: winRate == null ? null : value * winRate };
  }, [quotes, today, todayStr]);

  // ---- Reorder planner ----------------------------------------------------
  const reorder = useMemo(() => {
    const linksByItem = new Map<string, any[]>();
    for (const l of supplierLinks) {
      const arr = linksByItem.get(l.item_id) || [];
      arr.push(l);
      linksByItem.set(l.item_id, arr);
    }
    const rows = [];
    for (const it of items) {
      const rate = demand.rateByItem.get(it.id) || 0;
      const links = linksByItem.get(it.id) || [];
      const link = links.find((l) => l.is_primary) || links[0];
      const supplierId = link ? link.supplier_id || link.overseas_supplier_id : null;
      const lead = resolveLeadTime(link?.lead_time_days, supplierId ? leadTimeBySupplier.get(supplierId) : null);
      const stock = Math.max(0, Number(it.quantity || 0));
      const onOrder = onOrderByItem.get(it.id) || 0;
      // Same plan as the Reorder List, covering the chosen horizon after delivery.
      const plan = planReorder({ stock, onOrder, rate, leadDays: lead.days, coverDays: horizon, minStock: it.low_stock_threshold, moq: link?.moq });
      if (plan.suggested <= 0) continue;
      const orderByDays = Number.isFinite(plan.orderByDays) ? plan.orderByDays : 0;
      rows.push({
        id: it.id,
        name: it.name as string,
        sku: (it.sku as string) || "—",
        stock,
        onOrder,
        rate,
        runOut: addDays(today, Math.floor(Number.isFinite(plan.daysLeft) ? plan.daysLeft : 0)),
        daysLeft: plan.daysLeft,
        lead: lead.days,
        leadSource: lead.source,
        orderBy: addDays(today, orderByDays),
        orderByDays,
        now: plan.group === "now",
        suggested: plan.suggested,
        cost: plan.suggested * Number(it.cost_price || 0),
      });
    }
    return rows;
  }, [items, supplierLinks, demand.rateByItem, leadTimeBySupplier, onOrderByItem, horizon, today]);

  const reorderSort = useSort(reorder, {
    name: (r) => r.name,
    stock: (r) => r.stock,
    onOrder: (r) => r.onOrder,
    rate: (r) => r.rate,
    daysLeft: (r) => r.daysLeft,
    lead: (r) => r.lead,
    orderBy: (r) => r.orderByDays,
    suggested: (r) => r.suggested,
    cost: (r) => r.cost,
  }, { key: "orderBy", dir: "asc" });
  const orderNow = reorder.filter((r) => r.now).length;
  const reorderCost = reorder.reduce((s, r) => s + r.cost, 0);

  if (isLoading) {
    return <div className="rounded-lg border bg-card py-16 text-center text-sm text-muted-foreground">Building forecast…</div>;
  }

  const revenueChange = demand.lastPeriodRevenue > 0 ? (demand.revenue - demand.lastPeriodRevenue) / demand.lastPeriodRevenue : null;
  const net = cashRows.dueIn - cashRows.dueOut;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Based on the last {HISTORY_DAYS} days of sales, with recent weeks counting most. The date range, source and payment filters do not apply here; branch, category, brand and supplier do.
        </p>
        <Select value={String(horizon)} onValueChange={(v) => setHorizon(Number(v) as Horizon)}>
          <SelectTrigger className="h-9 w-[150px] text-xs" aria-label="Forecast horizon">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Next 30 days</SelectItem>
            <SelectItem value="60">Next 60 days</SelectItem>
            <SelectItem value="90">Next 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className={cn("grid gap-3 sm:gap-4 grid-cols-2", isAdmin ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {isAdmin ? (
          <>
            <StatCard
              title="Est. Revenue"
              value={money(demand.revenue)}
              icon={TrendingUp}
              variant="success"
              description={`≈ ${money(demand.dailyRevenue)} a day`}
              delta={revenueChange}
              formula={
                <div className="space-y-0.5">
                  <FormulaRow label={`Last ${horizon} days (actual)`} value={money(demand.lastPeriodRevenue)} />
                  <FormulaRow label={`Next ${horizon} days (projected)`} value={money(demand.revenue)} />
                  <p className="pt-1 text-muted-foreground">Includes unpaid orders — this is demand, not cash. The chip compares with the last {horizon} days.</p>
                </div>
              }
            />
            <StatCard
              title="Est. Gross Profit"
              value={money(demand.revenue * demand.margin)}
              icon={TrendingUp}
              description={`At ${(demand.margin * 100).toFixed(1)}% margin`}
              formula={<p>Projected revenue × the margin of the last {HISTORY_DAYS} days, using each item's current cost. An estimate.</p>}
            />
            <StatCard
              title="Open Quotes"
              value={money(pipeline.value)}
              icon={FileText}
              description={pipeline.winRate == null ? `${pipeline.count} open` : `${pipeline.count} open · ${(pipeline.winRate * 100).toFixed(0)}% win rate`}
              formula={
                <div className="space-y-0.5">
                  <p>Sent quotations still within their validity date.</p>
                  {pipeline.expected != null && <FormulaRow label="Likely to convert" value={money(pipeline.expected)} />}
                  <p className="pt-1 text-muted-foreground">Win rate: accepted ÷ (accepted + rejected) over the last 180 days.</p>
                </div>
              }
            />
            <StatCard
              title="Net Cash Due"
              value={money(net)}
              icon={Wallet}
              tone={net < 0 ? "negative" : "asset"}
              description={`${money(cashRows.dueIn)} in · ${money(cashRows.dueOut)} out`}
              formula={<p>Unpaid invoices due (including overdue) minus supplier balances and bills due in the same window. Marketplace payouts are not dated, so they are listed separately below.</p>}
            />
          </>
        ) : (
          <>
            <StatCard title="Est. Units" value={Math.round(demand.units).toLocaleString()} icon={TrendingUp} description={`Next ${horizon} days`} />
            <StatCard title="Items to Reorder" value={reorder.length} icon={PackagePlus} description={`${orderNow} to order now`} variant={orderNow ? "warning" : "default"} />
            <StatCard title="Open Quotes" value={pipeline.count} icon={FileText} description={pipeline.winRate == null ? "Sent, still valid" : `${(pipeline.winRate * 100).toFixed(0)}% win rate`} />
          </>
        )}
      </div>

      {isAdmin && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="min-w-0 rounded-lg border bg-card p-4 lg:col-span-3">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-semibold">Revenue: actual and projected</h2>
                <p className="text-xs text-muted-foreground">Per week · all booked sales</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: ACTUAL_COLOR }} />Actual</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: FORECAST_COLOR }} />Projected</span>
              </div>
            </div>
            <ChartContainer config={{ actual: { label: "Actual", color: ACTUAL_COLOR }, forecast: { label: "Projected", color: FORECAST_COLOR } }} className="h-[220px] w-full">
              <BarChart data={chart} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={compact} />
                <ChartTooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                  content={({ active, payload }) => {
                    const p = active && (payload?.[0]?.payload as (typeof chart)[number] | undefined);
                    if (!p) return null;
                    return (
                      <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md min-w-[160px]">
                        <div className="font-medium mb-1">{p.title}</div>
                        <FormulaRow label={p.future ? "Projected" : "Actual"} value={money(p.future ? p.forecast : p.actual)} />
                      </div>
                    );
                  }}
                />
                <Bar dataKey="actual" stackId="a" fill={ACTUAL_COLOR} maxBarSize={28} />
                <Bar dataKey="forecast" stackId="a" fill={FORECAST_COLOR} radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ChartContainer>
          </div>

          <div className="min-w-0 rounded-lg border bg-card p-4 lg:col-span-2">
            <h2 className="text-sm font-semibold">Money in vs money out</h2>
            <p className="text-xs text-muted-foreground mb-3">Customer balances against what is owed to suppliers and bills.</p>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">When</TableHead>
                    <TableHead className="text-xs text-right">In</TableHead>
                    <TableHead className="text-xs text-right">Out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashRows.slots.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className={cn("text-xs", r.key === "overdue" && (r.in || r.out) && "text-red-600 font-medium")}>{r.label}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-green-600">{r.in ? money(r.in) : "—"}</TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-red-600">{r.out ? money(r.out) : "—"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="text-xs text-muted-foreground">Awaiting marketplace payout</TableCell>
                    <TableCell className="text-xs text-right tabular-nums text-green-600">{cashRows.marketplace ? money(cashRows.marketplace) : "—"}</TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">—</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {branchId && <p className="mt-2 text-[11px] text-muted-foreground">Bills are company-wide, so they only appear with All branches selected.</p>}
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="p-4 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Reorder planner</h2>
            <Link to="/low-stock-alerts" className="text-xs text-primary hover:underline">Create POs in the Reorder List →</Link>
          </div>
          <p className="text-xs text-muted-foreground">
            {reorder.length === 0
              ? `Stock on hand and on order covers the next ${horizon} days for every selling item.`
              : `${reorder.length} item${reorder.length === 1 ? "" : "s"} to order${orderNow ? ` · ${orderNow} now` : ""}${isAdmin ? ` · about ${money(reorderCost)} at current cost` : ""}. Suggested quantity covers the supplier's lead time, ${SAFETY_DAYS} days of safety stock and the next ${horizon} days, less stock on hand and on order.`}
          </p>
        </div>
        {reorder.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader sortKey="name" label="Item" sort={reorderSort.sort} onToggle={reorderSort.toggle} />
                <SortableHeader sortKey="stock" label="Stock" sort={reorderSort.sort} onToggle={reorderSort.toggle} align="right" />
                <SortableHeader sortKey="onOrder" label="On order" sort={reorderSort.sort} onToggle={reorderSort.toggle} align="right" className="hidden sm:table-cell" />
                <SortableHeader sortKey="rate" label="Sells / day" sort={reorderSort.sort} onToggle={reorderSort.toggle} align="right" className="hidden md:table-cell" />
                <SortableHeader sortKey="daysLeft" label="Runs out" sort={reorderSort.sort} onToggle={reorderSort.toggle} className="hidden md:table-cell" />
                <SortableHeader sortKey="lead" label="Lead time" sort={reorderSort.sort} onToggle={reorderSort.toggle} align="right" className="hidden lg:table-cell" />
                <SortableHeader sortKey="orderBy" label="Order by" sort={reorderSort.sort} onToggle={reorderSort.toggle} />
                <SortableHeader sortKey="suggested" label="Order qty" sort={reorderSort.sort} onToggle={reorderSort.toggle} align="right" />
                {isAdmin && <SortableHeader sortKey="cost" label="Est. cost" sort={reorderSort.sort} onToggle={reorderSort.toggle} align="right" className="hidden sm:table-cell" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {reorderSort.sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">{r.sku}</div>
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {r.stock.toLocaleString()}
                    {combinedBranches && <BranchStockSplit split={stockSplit.get(r.id)} />}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums hidden sm:table-cell">{r.onOrder ? r.onOrder.toLocaleString() : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums hidden md:table-cell">{r.rate === 0 ? "—" : r.rate < 1 ? r.rate.toFixed(2) : r.rate.toFixed(1)}</TableCell>
                  <TableCell className="text-sm hidden md:table-cell whitespace-nowrap">
                    {r.stock === 0 ? <span className="text-red-600">Out of stock</span> : r.rate === 0 ? "—" : format(r.runOut, "MMM d")}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums hidden lg:table-cell">
                    {r.lead} days
                    {r.leadSource !== "set" && (
                      <div className="text-[10px] text-muted-foreground">{r.leadSource === "history" ? "from past deliveries" : "default — set on supplier link"}</div>
                    )}
                  </TableCell>
                  <TableCell className={cn("text-sm whitespace-nowrap", r.now ? "text-red-600 font-medium" : r.orderByDays <= 7 && "text-amber-600")}>
                    {r.now ? "Now" : format(r.orderBy, "MMM d")}
                    {r.now && r.orderByDays < 0 && <div className="text-[10px] font-normal">{-r.orderByDays} day{r.orderByDays === -1 ? "" : "s"} late</div>}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">{r.suggested.toLocaleString()}</TableCell>
                  {isAdmin && <TableCell className="text-right text-sm tabular-nums hidden sm:table-cell">{money(r.cost)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
