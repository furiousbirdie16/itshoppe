import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, startOfWeek, startOfMonth, startOfYear, subDays, subMonths, subYears } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, RefreshCw, Download } from "lucide-react";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import * as XLSX from "xlsx";

type Granularity = "daily" | "weekly" | "monthly" | "yearly";
type Range = "30d" | "90d" | "12m" | "all";

interface Snapshot {
  snapshot_date: string;
  inventory_value: number;
  incoming_stock_value: number;
  payable_assets_value?: number;
  incoming_assets_value?: number;
  accounts_payable_value?: number;
  receivables_value: number;
  total_asset_value: number;
  cash_value?: number;
  bills_payable_value?: number;
  owner_due_value?: number;
  loans_outstanding_value?: number;
  net_asset_value?: number;
}


const RANGES: { id: Range; label: string }[] = [
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "12m", label: "12M" },
  { id: "all", label: "All" },
];

const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

export default function AssetTrendChart() {
  const [range, setRange] = useState<Range>("30d");
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const qc = useQueryClient();

  const fromDate = useMemo(() => {
    const now = new Date();
    if (range === "30d") return subDays(now, 30);
    if (range === "90d") return subDays(now, 90);
    if (range === "12m") return subMonths(now, 12);
    return new Date(2020, 0, 1);
  }, [range]);

  const { data: snapshots = [], isLoading } = useQuery({
    queryKey: ["asset_snapshots", range],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("asset_snapshots")
        .select("snapshot_date, inventory_value, incoming_stock_value, payable_assets_value, incoming_assets_value, accounts_payable_value, receivables_value, total_asset_value, cash_value, bills_payable_value, owner_due_value, loans_outstanding_value, net_asset_value")
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
      qc.invalidateQueries({ queryKey: ["asset_snapshots"] });
      toast.success("Snapshot updated for today");
    },
    onError: (e: any) => toast.error(e.message || "Failed to generate snapshot"),
  });

  // Aggregate by granularity
  const series = useMemo(() => {
    if (snapshots.length === 0) return [];
    const buckets = new Map<string, Snapshot & { count: number }>();
    for (const s of snapshots) {
      const d = parseISO(s.snapshot_date);
      let key: string;
      if (granularity === "daily") key = s.snapshot_date;
      else if (granularity === "weekly") key = format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd");
      else if (granularity === "monthly") key = format(startOfMonth(d), "yyyy-MM");
      else key = format(startOfYear(d), "yyyy");
      // Use latest snapshot in bucket (so end-of-period value wins)
      const existing = buckets.get(key);
      if (!existing || s.snapshot_date > existing.snapshot_date) {
        buckets.set(key, { ...s, count: 1 });
      }
    }
    return Array.from(buckets.entries())
      .map(([key, s]) => ({
        key,
        label:
          granularity === "yearly" ? key
          : granularity === "monthly" ? format(parseISO(key + "-01"), "MMM yy")
          : format(parseISO(s.snapshot_date), "MMM d"),
        inventory: Number(s.inventory_value),
        incoming: Number(s.incoming_assets_value ?? s.incoming_stock_value),
        receivables: Number(s.receivables_value),
        cash: Number(s.cash_value ?? 0),
        bills: Number(s.bills_payable_value ?? 0),
        owner: Number(s.owner_due_value ?? 0),
        loans: Number(s.loans_outstanding_value ?? 0),
        // Snapshots taken before the finance module have no net figure; fall back to
        // the old asset total so the line does not drop to zero for history.
        total: Number(s.net_asset_value ?? s.total_asset_value),
        snapshot_date: s.snapshot_date,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [snapshots, granularity]);

  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const delta = last && prev ? last.total - prev.total : 0;
  const deltaPct = last && prev && prev.total > 0 ? (delta / prev.total) * 100 : 0;
  const up = delta >= 0;

  const high = series.reduce((m, p) => (p.total > m.total ? p : m), series[0] || { total: 0, label: "—" });
  const low = series.reduce((m, p) => (p.total < m.total ? p : m), series[0] || { total: 0, label: "—" });

  const handleExport = () => {
    if (snapshots.length === 0) {
      toast.error("No data to export");
      return;
    }
    const rows = snapshots.map((s) => ({
      Date: s.snapshot_date,
      "Net Asset Value": Number(s.net_asset_value ?? 0),
      "Cash": Number(s.cash_value ?? 0),
      "Bills Payable": Number(s.bills_payable_value ?? 0),
      "Due to Owner": Number(s.owner_due_value ?? 0),
      "Loans Outstanding": Number(s.loans_outstanding_value ?? 0),
      "Inventory Value": Number(s.inventory_value),
      "Incoming Assets Value": Number(s.incoming_assets_value ?? s.incoming_stock_value),
      "Payable Assets Value": Number(s.payable_assets_value ?? 0),
      "Accounts Payable Value": Number(s.accounts_payable_value ?? 0),
      "Receivables Value": Number(s.receivables_value),
      "Total Asset Value": Number(s.total_asset_value),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Asset History");
    XLSX.writeFile(wb, `asset_history_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast.success(`Exported ${rows.length} rows`);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-sm font-semibold">Net Asset Value Trend</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Historical total asset value over time
            </p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {GRANULARITIES.map((g) => (
              <Button
                key={g.id}
                variant={granularity === g.id ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setGranularity(g.id)}
              >
                {g.label}
              </Button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            {RANGES.map((r) => (
              <Button
                key={r.id}
                variant={range === r.id ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => regenMut.mutate()}
              disabled={regenMut.isPending}
            >
              <RefreshCw className={cn("h-3 w-3 mr-1", regenMut.isPending && "animate-spin")} />
              Today
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExport}>
              <Download className="h-3 w-3 mr-1" /> Export
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Stat label="Latest" value={last ? peso(last.total) : "—"} sub={last?.label} />
          <Stat
            label="Change"
            value={last && prev ? peso(Math.abs(delta)) : "—"}
            sub={last && prev ? `${up ? "+" : "-"}${deltaPct.toFixed(2)}%` : "—"}
            tone={last && prev ? (up ? "up" : "down") : undefined}
          />
          <Stat label="Highest" value={series.length ? peso(high.total) : "—"} sub={series.length ? high.label : "—"} tone="up" />
          <Stat label="Lowest" value={series.length ? peso(low.total) : "—"} sub={series.length ? low.label : "—"} tone="down" />
        </div>

        {isLoading ? (
          <div className="h-[240px] flex items-center justify-center">
            <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : series.length === 0 ? (
          <div className="h-[240px] flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
            <p>No snapshots yet.</p>
            <Button size="sm" variant="outline" onClick={() => regenMut.mutate()} disabled={regenMut.isPending}>
              Generate first snapshot
            </Button>
          </div>
        ) : (
          <ChartContainer
            config={{
              total: { label: "Net Asset Value", color: "hsl(var(--primary))" },
              inventory: { label: "Inventory", color: "hsl(var(--primary))" },
              incoming: { label: "Incoming", color: "hsl(var(--success, var(--primary)))" },
              receivables: { label: "Receivables", color: "hsl(var(--warning, var(--accent)))" },
            }}
            className="h-[260px] w-full"
          >
            <AreaChart data={series} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={60}
                tickFormatter={(v) =>
                  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
                }
              />
              <ChartTooltip
                cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.35, strokeWidth: 1 }}
                content={<NetAssetTooltip />}
              />
              <Area
                dataKey="total"
                type="monotone"
                stroke="hsl(var(--primary))"
                fill="url(#fillTotal)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/** Assets and liabilities behind the plotted net figure. */
function NetAssetTooltip({ active, payload }: any) {
  const p = active && payload?.[0]?.payload;
  if (!p) return null;
  const assets = [
    ["Inventory", p.inventory],
    ["Receivables", p.receivables],
    ["Incoming", p.incoming],
    ["Cash", p.cash],
  ] as const;
  const liabilities = [
    ["Bills & checks", p.bills],
    ["Due to owner", p.owner],
    ["Loans", p.loans],
  ] as const;
  const row = (label: string, value: number, tone: string) => (
    <div key={label} className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", tone)}>{peso(Number(value || 0))}</span>
    </div>
  );
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="font-medium mb-1.5">{p.snapshot_date}</div>
      <div className="space-y-0.5">{assets.map(([l, v]) => row(l, v as number, "text-emerald-600 dark:text-emerald-500"))}</div>
      <div className="my-1.5 border-t" />
      <div className="space-y-0.5">{liabilities.map(([l, v]) => row(l, v as number, "text-red-600 dark:text-red-500"))}</div>
      <div className="my-1.5 border-t" />
      <div className="flex items-center justify-between gap-6 font-medium">
        <span>Net Asset Value</span>
        <span className="tabular-nums">{peso(Number(p.total || 0))}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && (
        <div
          className={cn(
            "text-[11px] mt-0.5 inline-flex items-center gap-0.5",
            tone === "up" && "text-success",
            tone === "down" && "text-destructive",
            !tone && "text-muted-foreground"
          )}
        >
          {tone === "up" && <TrendingUp className="h-3 w-3" />}
          {tone === "down" && <TrendingDown className="h-3 w-3" />}
          {sub}
        </div>
      )}
    </div>
  );
}
