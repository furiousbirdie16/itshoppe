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

type Preset = "today" | "week" | "month" | "year" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "year", label: "This Year" },
  { id: "custom", label: "Custom" },
];

export function DashboardAnalytics() {
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
    queryFn: getAccountsReceivable,
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
    </div>
  );
}
