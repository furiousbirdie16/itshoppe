import { useMemo } from "react";
import { Link } from "react-router-dom";
import { format, parseISO, startOfDay } from "date-fns";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Clock, PackageOpen, ShoppingCart, Truck } from "lucide-react";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { StatCard, FormulaRow } from "@/components/StatCard";
import { SortableHeader } from "@/components/SortableHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSort } from "@/hooks/use-sort";
import { useInsightsPurchases, PO_STATUS_LABEL, type PoRow } from "@/hooks/use-insights-purchases";
import { makeBuckets } from "@/lib/insights";
import { cn } from "@/lib/utils";

interface Props {
  fromStr: string;
  toStr: string;
  dateFrom: Date;
  effectiveTo: Date;
  allTime: boolean;
  branchId: string | null;
  isAdmin: boolean;
  money: (n: number) => string;
  /** Supplier name from the page's Filters drawer, or "all". */
  supplierFilter: string;
}

const LOCAL_COLOR = "hsl(var(--primary))";
const OVERSEAS_COLOR = "hsl(32 95% 52%)";
const compact = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`;
const fmtDate = (d: string | null) => (d ? format(parseISO(d), "MMM d, yyyy") : "—");

export function InsightsPurchasesTab({ fromStr, toStr, dateFrom, effectiveTo, allTime, branchId, isAdmin, money, supplierFilter }: Props) {
  const { orders: allOrders, leadTimeBySupplier, isLoading } = useInsightsPurchases(branchId);
  const orders = useMemo(
    () => (supplierFilter === "all" ? allOrders : allOrders.filter((o) => o.supplier === supplierFilter)),
    [allOrders, supplierFilter],
  );

  // Orders placed in the selected range. Drafts are not commitments yet.
  const inRange = useMemo(
    () => orders.filter((o) => o.status !== "draft" && o.orderDate && o.orderDate >= fromStr && o.orderDate <= toStr),
    [orders, fromStr, toStr],
  );
  const open = useMemo(() => orders.filter((o) => o.remainingUnits > 0), [orders]);

  const totals = useMemo(() => {
    let local = 0, overseas = 0, charges = 0, units = 0;
    for (const o of inRange) {
      if (o.kind === "local") local += o.goodsPhp; else overseas += o.goodsPhp;
      charges += o.chargesPhp;
      for (const l of o.lines) units += l.qty;
    }
    return {
      local, overseas, charges, units,
      spend: local + overseas + charges,
      toArrive: open.reduce((s, o) => s + o.remainingPhp, 0),
      unitsToArrive: open.reduce((s, o) => s + o.remainingUnits, 0),
      owed: orders.reduce((s, o) => s + o.owedPhp, 0),
    };
  }, [inRange, open, orders]);

  const chart = useMemo(() => {
    let start = startOfDay(dateFrom);
    if (allTime) {
      const first = inRange.reduce<string | null>((m, o) => (m === null || o.orderDate! < m ? o.orderDate : m), null);
      start = first ? parseISO(first) : start;
    }
    const { bucket, keyOf, slots } = makeBuckets(start, effectiveTo);
    const pts = new Map(slots.map((s) => [s.key, { label: s.label, title: s.title, local: 0, overseas: 0, units: 0 }]));
    for (const o of inRange) {
      const pt = pts.get(keyOf(parseISO(o.orderDate!)));
      if (!pt) continue;
      // Charges count toward the side that incurred them.
      pt[o.kind] += o.goodsPhp + o.chargesPhp;
      for (const l of o.lines) pt.units += l.qty;
    }
    return { bucket, data: Array.from(pts.values()) };
  }, [inRange, dateFrom, effectiveTo, allTime]);

  const supplierRows = useMemo(() => {
    const m = new Map<string, { key: string; name: string; orders: number; spend: number; units: number; lead: number | null; onTime: number | null }>();
    for (const o of inRange) {
      const key = o.supplierId || "none";
      const lt = o.supplierId ? leadTimeBySupplier.get(o.supplierId) : undefined;
      const e = m.get(key) || { key, name: o.supplier, orders: 0, spend: 0, units: 0, lead: lt?.avgDays ?? null, onTime: lt?.onTimePct ?? null };
      e.orders += 1;
      e.spend += o.goodsPhp + o.chargesPhp;
      for (const l of o.lines) e.units += l.qty;
      m.set(key, e);
    }
    return Array.from(m.values()).map((r) => ({ ...r, share: totals.spend > 0 ? (r.spend / totals.spend) * 100 : 0 }));
  }, [inRange, leadTimeBySupplier, totals.spend]);
  const supplierSort = useSort(supplierRows, {
    name: (r) => r.name,
    orders: (r) => r.orders,
    spend: (r) => r.spend,
    units: (r) => r.units,
    lead: (r) => r.lead ?? Infinity,
    onTime: (r) => r.onTime ?? -1,
  }, { key: isAdmin ? "spend" : "units", dir: "desc" });

  const openSort = useSort<PoRow>(open, {
    number: (r) => r.number,
    supplier: (r) => r.supplier,
    expected: (r) => r.expected || "9999",
    remainingUnits: (r) => r.remainingUnits,
    remainingPhp: (r) => r.remainingPhp,
  }, { key: "expected", dir: "asc" });

  const today = format(new Date(), "yyyy-MM-dd");
  const lateCount = open.filter((o) => o.expected && o.expected < today).length;

  if (isLoading) {
    return <div className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">Loading purchase orders…</div>;
  }

  const series = isAdmin
    ? [{ key: "local", label: "Local", color: LOCAL_COLOR }, { key: "overseas", label: "Overseas", color: OVERSEAS_COLOR }]
    : [{ key: "units", label: "Units ordered", color: LOCAL_COLOR }];
  const hasChartData = chart.data.some((d) => d.local || d.overseas || d.units);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        {isAdmin ? (
          <StatCard
            title="Purchases"
            value={money(totals.spend)}
            icon={ShoppingCart}
            description={`${inRange.length} order${inRange.length === 1 ? "" : "s"} placed`}
            formula={
              <div className="space-y-0.5">
                <FormulaRow label="Local goods" value={money(totals.local)} />
                <FormulaRow label="Overseas goods" value={money(totals.overseas)} />
                <FormulaRow label="Shipping, customs & other charges" value={money(totals.charges)} />
                <p className="pt-1 text-muted-foreground">By order date. Overseas orders converted at each PO's exchange rate. Drafts excluded.</p>
              </div>
            }
          />
        ) : (
          <StatCard title="Orders Placed" value={inRange.length} icon={ShoppingCart} description="In this range" />
        )}
        <StatCard title="Units Ordered" value={totals.units.toLocaleString()} icon={PackageOpen} description="In this range" />
        <StatCard
          title="Still to Arrive"
          value={isAdmin ? money(totals.toArrive) : totals.unitsToArrive.toLocaleString()}
          icon={Truck}
          description={isAdmin ? `${totals.unitsToArrive.toLocaleString()} units on ${open.length} open order${open.length === 1 ? "" : "s"}` : `Units on ${open.length} open order${open.length === 1 ? "" : "s"}`}
        />
        {isAdmin ? (
          <StatCard
            title="Payables"
            value={money(totals.owed)}
            icon={Clock}
            variant="warning"
            description="Owed to suppliers"
            formula={<p>Local POs are paid on receipt, so their unreceived goods count as owed. Overseas POs count while unpaid, less deposits already sent. Same rule as the Financial Dashboard.</p>}
          />
        ) : (
          <StatCard title="Late Orders" value={lateCount} icon={Clock} variant={lateCount ? "warning" : "default"} description="Past expected delivery" />
        )}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold">{isAdmin ? "Purchase spend" : "Units ordered"}</h2>
            <p className="text-xs text-muted-foreground">Per {chart.bucket} · by order date</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        </div>
        {!hasChartData ? (
          <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">No purchase orders in this range.</div>
        ) : (
          <ChartContainer config={Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]))} className="h-[200px] w-full">
            <BarChart data={chart.data} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tickLine={false} axisLine={false} width={isAdmin ? 52 : 36} allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={compact} />
              <ChartTooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                content={({ active, payload }) => {
                  const p = active && (payload?.[0]?.payload as (typeof chart.data)[number] | undefined);
                  if (!p) return null;
                  return (
                    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md space-y-0.5 min-w-[160px]">
                      <div className="font-medium mb-1">{p.title}</div>
                      {isAdmin && <FormulaRow label="Local" value={money(p.local)} />}
                      {isAdmin && <FormulaRow label="Overseas" value={money(p.overseas)} />}
                      <FormulaRow label="Units" value={String(p.units)} />
                    </div>
                  );
                }}
              />
              {series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={i === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} maxBarSize={28} />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="p-4 pb-3">
          <h2 className="text-sm font-semibold">Suppliers</h2>
          <p className="text-xs text-muted-foreground">Orders placed in this range. Lead time and on-time rate are over every delivery received.</p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader sortKey="name" label="Supplier" sort={supplierSort.sort} onToggle={supplierSort.toggle} />
                <SortableHeader sortKey="orders" label="Orders" sort={supplierSort.sort} onToggle={supplierSort.toggle} align="right" />
                <SortableHeader sortKey="units" label="Units" sort={supplierSort.sort} onToggle={supplierSort.toggle} align="right" />
                {isAdmin && <SortableHeader sortKey="spend" label="Spend" sort={supplierSort.sort} onToggle={supplierSort.toggle} align="right" />}
                <SortableHeader sortKey="lead" label="Avg lead time" sort={supplierSort.sort} onToggle={supplierSort.toggle} align="right" />
                <SortableHeader sortKey="onTime" label="On time" sort={supplierSort.sort} onToggle={supplierSort.toggle} align="right" className="hidden sm:table-cell" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplierSort.sorted.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">No purchase orders in this range.</TableCell></TableRow>
              ) : supplierSort.sorted.map((r) => (
                <TableRow key={r.key} className="border-t">
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.units.toLocaleString()}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right tabular-nums">
                      <div className="font-semibold">{money(r.spend)}</div>
                      <div className="text-[10px] text-muted-foreground">{r.share.toFixed(0)}% of spend</div>
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">{r.lead == null ? <span className="text-muted-foreground">—</span> : `${Math.round(r.lead)} days`}</TableCell>
                  <TableCell className="text-right tabular-nums hidden sm:table-cell">
                    {r.onTime == null ? <span className="text-muted-foreground">—</span> : (
                      <span className={cn(r.onTime >= 90 ? "text-green-600" : r.onTime >= 70 ? "text-amber-600" : "text-red-600")}>{r.onTime.toFixed(0)}%</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="p-4 pb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Incoming orders</h2>
            <p className="text-xs text-muted-foreground">
              Every open order with goods still to arrive, whatever its order date.
              {lateCount > 0 && <span className="text-red-600"> {lateCount} past expected delivery.</span>}
            </p>
          </div>
          <div className="flex gap-3 text-xs">
            <Link to="/purchase-orders" className="text-primary hover:underline">Local POs</Link>
            <Link to="/overseas-purchase-orders" className="text-primary hover:underline">Overseas POs</Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader sortKey="number" label="PO" sort={openSort.sort} onToggle={openSort.toggle} />
                <SortableHeader sortKey="supplier" label="Supplier" sort={openSort.sort} onToggle={openSort.toggle} className="hidden sm:table-cell" />
                <TableHead className="text-xs hidden md:table-cell">Status</TableHead>
                <SortableHeader sortKey="expected" label="Expected" sort={openSort.sort} onToggle={openSort.toggle} />
                <SortableHeader sortKey="remainingUnits" label="Units left" sort={openSort.sort} onToggle={openSort.toggle} align="right" />
                {isAdmin && <SortableHeader sortKey="remainingPhp" label="Value left" sort={openSort.sort} onToggle={openSort.toggle} align="right" className="hidden sm:table-cell" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {openSort.sorted.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">Nothing on order.</TableCell></TableRow>
              ) : openSort.sorted.map((o) => {
                const late = !!o.expected && o.expected < today;
                return (
                  <TableRow key={`${o.kind}:${o.id}`} className="border-t">
                    <TableCell>
                      <div className="font-medium tabular-nums whitespace-nowrap">{o.number}</div>
                      <div className="text-[10px] text-muted-foreground capitalize whitespace-nowrap">{o.kind} · {fmtDate(o.orderDate)}</div>
                      <div className="text-[10px] text-muted-foreground sm:hidden">{o.supplier}</div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{o.supplier}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">{PO_STATUS_LABEL[o.status] || o.status}</TableCell>
                    <TableCell className={cn("whitespace-nowrap", late && "text-red-600 font-medium")}>
                      {o.expected ? format(parseISO(o.expected), "MMM d") : "—"}{late && <div className="text-[10px] font-normal">Late</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{o.remainingUnits.toLocaleString()}</TableCell>
                    {isAdmin && <TableCell className="text-right tabular-nums hidden sm:table-cell">{money(o.remainingPhp)}</TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
