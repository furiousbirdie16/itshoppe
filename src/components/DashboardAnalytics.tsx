import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, eachDayOfInterval } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { peso } from "@/lib/currency";
import { getSalesTrend, getAccountsReceivable, getDashboardStats, getCustomers } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Pie, PieChart, Cell, Legend, Bar, BarChart } from "recharts";
import { Badge } from "@/components/ui/badge";
import { getFollowUpInfo, classificationMeta } from "@/lib/followUps";
import { Link } from "react-router-dom";
import { BellRing } from "lucide-react";
import AssetTrendChart from "@/components/AssetTrendChart";
import { usePermissions } from "@/lib/permissions";
import { useBranch } from "@/contexts/BranchContext";

type Preset = "today" | "week" | "month" | "year" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "year", label: "This Year" },
  { id: "custom", label: "Custom" },
];

export function DashboardAnalytics() {
  const { isAdmin } = usePermissions();
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (preset === "today") return { from: startOfDay(now), to: endOfDay(now) };
    if (preset === "week") return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    if (preset === "month") return { from: startOfMonth(now), to: endOfMonth(now) };
    if (preset === "year") return { from: startOfYear(now), to: endOfYear(now) };
    return {
      from: customFrom ? startOfDay(customFrom) : startOfDay(subDays(now, 30)),
      to: customTo ? endOfDay(customTo) : endOfDay(now),
    };
  }, [preset, customFrom, customTo]);

  const fromIso = format(from, "yyyy-MM-dd");
  const toIso = format(to, "yyyy-MM-dd");

  const { data: trend = [], isLoading: trendLoading } = useQuery({
    queryKey: ["sales_trend", fromIso, toIso],
    queryFn: () => getSalesTrend(fromIso, toIso),
  });

  // Fill in missing days with zeros so the line is continuous
  const filled = useMemo(() => {
    const days = eachDayOfInterval({ start: from, end: to });
    const map = new Map(trend.map((d) => [d.date, d]));
    return days.map((d) => {
      const k = format(d, "yyyy-MM-dd");
      const found = map.get(k);
      return {
        date: k,
        label: format(d, days.length > 31 ? "MMM" : "MMM d"),
        online: found?.online || 0,
        invoice: found?.invoice || 0,
        total: found?.total || 0,
      };
    });
  }, [trend, from, to]);

  const totalForRange = filled.reduce((s, d) => s + d.total, 0);
  const halfIdx = Math.floor(filled.length / 2);
  const firstHalf = filled.slice(0, halfIdx).reduce((s, d) => s + d.total, 0);
  const secondHalf = filled.slice(halfIdx).reduce((s, d) => s + d.total, 0);
  const trendUp = secondHalf >= firstHalf;
  const trendPct = firstHalf > 0 ? Math.abs(((secondHalf - firstHalf) / firstHalf) * 100) : 0;

  // Asset value: inventory + incoming + receivables
  const { data: stats } = useQuery({ queryKey: ["dashboard"], queryFn: getDashboardStats });
  const { data: receivables = 0 } = useQuery({
    queryKey: ["accounts_receivable"],
    queryFn: () => getAccountsReceivable(),
  });

  const assetBreakdown = [
    { name: "Inventory", value: Math.max(0, Number(stats?.totalValue || 0)), fill: "hsl(var(--primary))" },
    { name: "Incoming Stock", value: Math.max(0, Number(stats?.incomingStockValue || 0)), fill: "hsl(var(--success, var(--primary)))" },
    { name: "Receivables", value: Math.max(0, Number(receivables || 0)), fill: "hsl(var(--warning, var(--accent)))" },
  ];
  const totalAssets = assetBreakdown.reduce((s, a) => s + a.value, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold">Analytics</h2>
        <div className="flex items-center gap-1 flex-wrap">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant={preset === p.id ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </Button>
          ))}
          {preset === "custom" && (
            <div className="flex items-center gap-1">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("h-7 text-xs w-[115px] justify-start", !customFrom && "text-muted-foreground")}>
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
                  <Button variant="outline" size="sm" className={cn("h-7 text-xs w-[115px] justify-start", !customTo && "text-muted-foreground")}>
                    <CalendarIcon className="h-3 w-3 mr-1" />
                    {customTo ? format(customTo, "MM/dd/yyyy") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Sales Trend (spans 2) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-sm font-semibold">Sales Trend</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(from, "MMM d, yyyy")} — {format(to, "MMM d, yyyy")}
                </p>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold">{peso(totalForRange)}</div>
                <div className={cn("inline-flex items-center gap-1 text-xs", trendUp ? "text-success" : "text-destructive")}>
                  {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {trendPct.toFixed(1)}% vs prior half
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {trendLoading ? (
              <div className="h-[240px] flex items-center justify-center">
                <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <ChartContainer
                config={{
                  invoice: { label: "Invoice", color: "hsl(var(--primary))" },
                  online: { label: "Online", color: "hsl(var(--accent))" },
                }}
                className="h-[240px] w-full"
              >
                <AreaChart data={filled} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillInvoice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="fillOnline" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} width={60} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, p) => p?.[0]?.payload?.date}
                        formatter={(v, name) => [peso(Number(v)), String(name)]}
                      />
                    }
                  />
                  <Area dataKey="invoice" stackId="a" type="monotone" stroke="hsl(var(--primary))" fill="url(#fillInvoice)" strokeWidth={2} />
                  <Area dataKey="online" stackId="a" type="monotone" stroke="hsl(var(--accent))" fill="url(#fillOnline)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Asset Value */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Wallet className="h-4 w-4" /> Total Asset Value
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Current snapshot</p>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold mb-2">{peso(totalAssets)}</div>
            {totalAssets > 0 ? (
              <ChartContainer
                config={Object.fromEntries(assetBreakdown.map((a) => [a.name, { label: a.name, color: a.fill }]))}
                className="h-[180px] w-full"
              >
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent formatter={(v, name) => [peso(Number(v)), String(name)]} />} />
                  <Pie data={assetBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} strokeWidth={2}>
                    {assetBreakdown.map((a) => (
                      <Cell key={a.name} fill={a.fill} />
                    ))}
                  </Pie>
                  <Legend verticalAlign="bottom" height={24} iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ChartContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-xs text-muted-foreground">No asset data</div>
            )}
            <div className="mt-2 space-y-1 text-xs">
              {assetBreakdown.map((a) => (
                <div key={a.name} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: a.fill }} />
                    {a.name}
                  </span>
                  <span className="font-medium tabular-nums">{peso(a.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {isAdmin && <AssetTrendChart />}

      <FollowUpOverview />
      <GeographicAnalytics fromIso={fromIso} toIso={toIso} />
    </div>
  );
}

function GeographicAnalytics({ fromIso, toIso }: { fromIso: string; toIso: string }) {
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });

  const { data: invoiceSales = [] } = useQuery({
    queryKey: ["geo_sales", fromIso, toIso],
    queryFn: async () => {
      const { data } = await supabase
        .from("invoices")
        .select("customer_id, total_amount")
        .in("status", ["confirmed", "paid"])
        .gte("invoice_date", fromIso)
        .lte("invoice_date", toIso);
      return (data || []) as { customer_id: string | null; total_amount: number }[];
    },
  });

  const { byProvince, byCity, salesByCity } = useMemo(() => {
    const prov: Record<string, number> = {};
    const city: Record<string, number> = {};
    const custToCity: Record<string, string> = {};
    for (const c of customers as any[]) {
      if (c.province_state) prov[c.province_state] = (prov[c.province_state] || 0) + 1;
      if (c.city_municipality) {
        city[c.city_municipality] = (city[c.city_municipality] || 0) + 1;
        custToCity[c.id] = c.city_municipality;
      }
    }
    const sales: Record<string, number> = {};
    for (const inv of invoiceSales) {
      if (!inv.customer_id) continue;
      const k = custToCity[inv.customer_id];
      if (!k) continue;
      sales[k] = (sales[k] || 0) + Number(inv.total_amount || 0);
    }
    const top = (m: Record<string, number>, n: number) =>
      Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, value]) => ({ name, value }));
    return {
      byProvince: top(prov, 10),
      byCity: top(city, 10),
      salesByCity: top(sales, 10),
    };
  }, [customers, invoiceSales]);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Customers per Province</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Top 10</p>
        </CardHeader>
        <CardContent>
          {byProvince.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">No location data</div>
          ) : (
            <ChartContainer config={{ value: { label: "Customers", color: "hsl(var(--primary))" } }} className="h-[200px] w-full">
              <BarChart data={byProvince} layout="vertical" margin={{ left: 4, right: 8 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={100} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Customers per City</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Top 10</p>
        </CardHeader>
        <CardContent>
          {byCity.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">No location data</div>
          ) : (
            <ChartContainer config={{ value: { label: "Customers", color: "hsl(var(--accent))" } }} className="h-[200px] w-full">
              <BarChart data={byCity} layout="vertical" margin={{ left: 4, right: 8 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={100} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Top Sales by City</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{fromIso} → {toIso}</p>
        </CardHeader>
        <CardContent>
          {salesByCity.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">No sales in range</div>
          ) : (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
              {salesByCity.map((row, i) => (
                <div key={row.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 truncate">
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-muted text-[10px] font-medium shrink-0">{i + 1}</span>
                    <span className="truncate">{row.name}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{peso(row.value)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FollowUpOverview() {
  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: getCustomers });

  const stats = useMemo(() => {
    let active = 0, needs = 0, never = 0;
    const byClass: Record<string, number> = { retail: 0, wholesale: 0, recurring: 0 };
    for (const c of customers) {
      const s = getFollowUpInfo(c.last_follow_up_at).status;
      if (s === "active") active++; else if (s === "needs") needs++; else never++;
      const cls = (c.classification || "retail") as keyof typeof byClass;
      if (byClass[cls] !== undefined) byClass[cls]++;
    }
    const overdue = [...customers]
      .map((c) => ({ c, info: getFollowUpInfo(c.last_follow_up_at) }))
      .filter((r) => r.info.status !== "active")
      .sort((a, b) => (b.info.days ?? 9999) - (a.info.days ?? 9999))
      .slice(0, 8);
    return { active, needs, never, byClass, overdue };
  }, [customers]);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Customer Follow-ups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border bg-success/5 p-2">
              <div className="text-xl font-semibold text-success">{stats.active}</div>
              <div className="text-[10px] text-muted-foreground">Active</div>
            </div>
            <div className="rounded-md border bg-warning/5 p-2">
              <div className="text-xl font-semibold text-warning">{stats.needs}</div>
              <div className="text-[10px] text-muted-foreground">Needs FU</div>
            </div>
            <div className="rounded-md border bg-destructive/5 p-2">
              <div className="text-xl font-semibold text-destructive">{stats.never}</div>
              <div className="text-[10px] text-muted-foreground">Never</div>
            </div>
          </div>
          <div className="space-y-1.5 pt-1">
            {(["retail", "wholesale", "recurring"] as const).map((k) => {
              const meta = classificationMeta(k);
              return (
                <div key={k} className="flex items-center justify-between text-xs">
                  <Badge variant="outline" className={cn("text-[10px] font-medium", meta.className)}>{meta.label}</Badge>
                  <span className="font-medium tabular-nums">{stats.byClass[k]}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">Customers needing follow-up</CardTitle>
          <Link to="/customers" className="text-xs text-primary hover:underline">View all</Link>
        </CardHeader>
        <CardContent>
          {stats.overdue.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">All customers are up to date.</p>
          ) : (
            <div className="space-y-1.5">
              {stats.overdue.map(({ c, info }) => (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", info.dotClass)} />
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <Badge variant="outline" className={cn("text-[10px] font-medium", classificationMeta(c.classification).className)}>
                      {classificationMeta(c.classification).label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={cn("text-[10px] font-medium", info.className)}>{info.label}</Badge>
                    <Link to="/customers">
                      <Button variant="ghost" size="icon" className="h-6 w-6"><BellRing className="h-3.5 w-3.5 text-primary" /></Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
