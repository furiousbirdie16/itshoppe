import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, eachDayOfInterval } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarIcon, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { peso } from "@/lib/currency";
import { getSalesTrend } from "@/lib/api";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import NetAssetValueChart from "@/components/NetAssetValueChart";
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
  const { activeBranchId } = useBranch();
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
    queryKey: ["sales_trend", fromIso, toIso, activeBranchId],
    queryFn: () => getSalesTrend(fromIso, toIso, activeBranchId),
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
  const invoiceForRange = filled.reduce((s, d) => s + d.invoice, 0);
  const onlineForRange = filled.reduce((s, d) => s + d.online, 0);
  const bestDay = filled.reduce((best, d) => (d.total > (best?.total ?? -1) ? d : best), filled[0]);
  const halfIdx = Math.floor(filled.length / 2);
  const firstHalf = filled.slice(0, halfIdx).reduce((s, d) => s + d.total, 0);
  const secondHalf = filled.slice(halfIdx).reduce((s, d) => s + d.total, 0);
  const trendUp = secondHalf >= firstHalf;
  const trendPct = firstHalf > 0 ? Math.abs(((secondHalf - firstHalf) / firstHalf) * 100) : 0;

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

      <div className="grid gap-4">
        {/* Sales Trend */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-sm font-semibold">Sales Trend</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(from, "MMM d, yyyy")} — {format(to, "MMM d, yyyy")}
                </p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold tracking-tight tabular-nums">{peso(totalForRange)}</div>
                <div className={cn("inline-flex items-center gap-1 text-xs", trendUp ? "text-success" : "text-destructive")}>
                  {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {trendPct.toFixed(1)}% vs prior half
                </div>
              </div>
            </div>
            {/* Legend doubles as the per-series totals, so identity is never colour alone. */}
            <div className="flex items-center gap-4 flex-wrap pt-1">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: "hsl(var(--primary))" }} />
                <span className="text-xs text-muted-foreground">Invoice</span>
                <span className="text-xs font-medium tabular-nums">{peso(invoiceForRange)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: "hsl(var(--success))" }} />
                <span className="text-xs text-muted-foreground">Online</span>
                <span className="text-xs font-medium tabular-nums">{peso(onlineForRange)}</span>
              </div>
              {bestDay && bestDay.total > 0 && (
                <span className="text-xs text-muted-foreground">
                  Best day {format(new Date(bestDay.date), "MMM d")} · {peso(bestDay.total)}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {trendLoading ? (
              <div className="h-[260px] flex items-center justify-center">
                <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : totalForRange === 0 ? (
              <div className="h-[260px] flex flex-col items-center justify-center gap-1 text-muted-foreground">
                <TrendingUp className="h-6 w-6 opacity-40" />
                <p className="text-sm">No sales in this period</p>
              </div>
            ) : (
              <ChartContainer
                config={{
                  invoice: { label: "Invoice", color: "hsl(var(--primary))" },
                  online: { label: "Online", color: "hsl(var(--success))" },
                }}
                className="h-[260px] w-full"
              >
                <AreaChart data={filled} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillInvoice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.04} />
                    </linearGradient>
                    <linearGradient id="fillOnline" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--success))" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="hsl(var(--success))" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={10}
                    minTickGap={28}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
                  />
                  <ChartTooltip
                    cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.35, strokeWidth: 1 }}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, p) =>
                          p?.[0]?.payload?.date ? format(new Date(p[0].payload.date), "EEE, MMM d yyyy") : ""
                        }
                        formatter={(v, name) => [peso(Number(v)), String(name)]}
                      />
                    }
                  />
                  {/* 2px strokes, and a surface-coloured seam between the stacked fills. */}
                  <Area
                    dataKey="invoice"
                    stackId="a"
                    type="monotone"
                    stroke="hsl(var(--primary))"
                    fill="url(#fillInvoice)"
                    strokeWidth={2}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                  />
                  <Area
                    dataKey="online"
                    stackId="a"
                    type="monotone"
                    stroke="hsl(var(--success))"
                    fill="url(#fillOnline)"
                    strokeWidth={2}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {isAdmin && <NetAssetValueChart />}
    </div>
  );
}
