import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, subDays, subMonths } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Range = "30d" | "90d" | "12m" | "all";

const RANGES: { id: Range; label: string }[] = [
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "12m", label: "12M" },
  { id: "all", label: "All" },
];

interface Snapshot {
  snapshot_date: string;
  net_asset_value: number;
  inventory_value: number;
  receivables_value: number;
  incoming_assets_value: number | null;
  cash_value: number | null;
  bills_payable_value: number | null;
  owner_due_value: number | null;
  loans_outstanding_value: number | null;
}

/** Assets in green, liabilities in red, net at the foot — a single line cannot show why it moved. */
function Tooltip({ active, payload }: any) {
  const p = active && payload?.[0]?.payload;
  if (!p) return null;
  const row = (label: string, value: number, tone?: string) => (
    <div key={label} className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", tone)}>{peso(Number(value || 0))}</span>
    </div>
  );
  const asset = "text-emerald-600 dark:text-emerald-500";
  const liability = "text-red-600 dark:text-red-500";
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="font-medium mb-1.5">{format(parseISO(p.date), "EEE, MMM d yyyy")}</div>
      <div className="space-y-0.5">
        {row("Inventory", p.inventory, asset)}
        {row("Receivables", p.receivables, asset)}
        {row("Incoming", p.incoming, asset)}
        {row("Cash & bank", p.cash, asset)}
      </div>
      <div className="my-1.5 border-t" />
      <div className="space-y-0.5">
        {row("Bills & checks", p.bills, liability)}
        {row("Due to owner", p.owner, liability)}
        {row("Loans", p.loans, liability)}
      </div>
      <div className="my-1.5 border-t" />
      <div className="flex items-center justify-between gap-6 font-medium">
        <span>Net Asset Value</span>
        <span className="tabular-nums">{peso(Number(p.value || 0))}</span>
      </div>
    </div>
  );
}

export default function NetAssetValueChart() {
  const [range, setRange] = useState<Range>("30d");
  const qc = useQueryClient();

  const fromDate = useMemo(() => {
    const now = new Date();
    if (range === "30d") return subDays(now, 30);
    if (range === "90d") return subDays(now, 90);
    if (range === "12m") return subMonths(now, 12);
    return new Date(2020, 0, 1);
  }, [range]);

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["net_asset_snapshots", range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_snapshots")
        .select("snapshot_date, net_asset_value, inventory_value, receivables_value, incoming_assets_value, cash_value, bills_payable_value, owner_due_value, loans_outstanding_value")
        .gte("snapshot_date", format(fromDate, "yyyy-MM-dd"))
        .order("snapshot_date", { ascending: true });
      if (error) throw error;
      return (data || []) as Snapshot[];
    },
  });

  const regenMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("generate_asset_snapshot");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["net_asset_snapshots"] });
      toast.success("Snapshot updated for today");
    },
    onError: (e: any) => toast.error(e.message || "Failed to generate snapshot"),
  });

  // Snapshots taken before the net figure existed carry a zero default. Plotting
  // them would draw a long flat run at zero, so the series starts at the first
  // day that actually recorded one.
  const series = useMemo(() => {
    const firstReal = snapshots.findIndex((s) => Number(s.net_asset_value) !== 0);
    if (firstReal === -1) return [];
    return snapshots.slice(firstReal).map((s) => ({
      date: s.snapshot_date,
      label: format(parseISO(s.snapshot_date), "MMM d"),
      value: Number(s.net_asset_value),
      inventory: Number(s.inventory_value),
      receivables: Number(s.receivables_value),
      incoming: Number(s.incoming_assets_value ?? 0),
      cash: Number(s.cash_value ?? 0),
      bills: Number(s.bills_payable_value ?? 0),
      owner: Number(s.owner_due_value ?? 0),
      loans: Number(s.loans_outstanding_value ?? 0),
    }));
  }, [snapshots]);

  const last = series[series.length - 1];
  const first = series[0];
  const delta = last && first ? last.value - first.value : 0;
  const deltaPct = last && first && first.value !== 0 ? (delta / Math.abs(first.value)) * 100 : 0;
  const up = delta >= 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-sm font-semibold">Net Asset Value</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">End-of-day snapshot</p>
          </div>
          <div className="flex items-center gap-1.5">
            {RANGES.map((r) => (
              <Button
                key={r.id}
                size="sm"
                variant={range === r.id ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => regenMut.mutate()}
              disabled={regenMut.isPending}
              title="Recalculate today's snapshot"
            >
              <RefreshCw className={cn("h-3 w-3", regenMut.isPending && "animate-spin")} />
            </Button>
          </div>
        </div>
        {last && (
          <div className="flex items-baseline gap-3 pt-1">
            <span className="text-2xl font-semibold tracking-tight tabular-nums">{peso(last.value)}</span>
            {series.length > 1 && (
              <span className={cn("inline-flex items-center gap-1 text-xs", up ? "text-success" : "text-destructive")}>
                {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {peso(Math.abs(delta))} ({deltaPct.toFixed(1)}%) since {first.label}
              </span>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-[260px] flex items-center justify-center">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : series.length === 0 ? (
          <div className="h-[260px] flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <TrendingUp className="h-6 w-6 opacity-40" />
            <p className="text-sm">No snapshots recorded yet</p>
            <Button size="sm" variant="outline" onClick={() => regenMut.mutate()} disabled={regenMut.isPending}>
              Take today's snapshot
            </Button>
          </div>
        ) : (
          <ChartContainer
            config={{ value: { label: "Net Asset Value", color: "hsl(var(--primary))" } }}
            className="h-[260px] w-full"
          >
            <AreaChart data={series} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="fillNav" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.04} />
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
                width={62}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) =>
                  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
                }
              />
              <ChartTooltip
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.35, strokeWidth: 1 }}
                content={<Tooltip />}
              />
              <Area
                dataKey="value"
                type="monotone"
                stroke="hsl(var(--primary))"
                fill="url(#fillNav)"
                strokeWidth={2}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
