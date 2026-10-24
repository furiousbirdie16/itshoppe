import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export interface TrendPoint {
  /** Axis label, e.g. "Oct 3" or "Oct 2026". */
  label: string;
  /** Tooltip heading — the full bucket span, e.g. "Week of Oct 3, 2026". */
  title: string;
  revenue: number;
  profit: number;
  units: number;
}

interface Props {
  data: TrendPoint[];
  /** "day" | "week" | "month" — named in the subtitle so a bar's span is never a guess. */
  bucket: "day" | "week" | "month";
  isAdmin: boolean;
  money: (n: number) => string;
}

const compact = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`;

/**
 * Revenue and gross profit per day / week / month for the selected range.
 * Staff without money access see units sold instead, since every peso figure
 * on the page is masked for them.
 */
export function InsightsTrendChart({ data, bucket, isAdmin, money }: Props) {
  const hasData = data.some((d) => d.revenue !== 0 || d.units !== 0);
  const series = isAdmin
    ? [
        { key: "revenue", label: "Revenue", color: "hsl(var(--primary))" },
        { key: "profit", label: "Gross profit", color: "hsl(142 71% 45%)" },
      ]
    : [{ key: "units", label: "Units sold", color: "hsl(var(--primary))" }];

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold">{isAdmin ? "Revenue & gross profit" : "Units sold"}</h2>
          <p className="text-xs text-muted-foreground">Per {bucket} · {isAdmin ? "paid orders only" : "all completed sales"}</p>
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
      {!hasData ? (
        <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">No sales in this range.</div>
      ) : (
        <ChartContainer
          config={Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]))}
          className="h-[220px] w-full"
        >
          <BarChart data={data} margin={{ left: 4, right: 4, top: 8, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={isAdmin ? 52 : 36}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={compact}
            />
            <ChartTooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
              content={({ active, payload }) => {
                const p = active && (payload?.[0]?.payload as TrendPoint | undefined);
                if (!p) return null;
                return (
                  <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md space-y-0.5">
                    <div className="font-medium mb-1">{p.title}</div>
                    {isAdmin && <Row label="Revenue" value={money(p.revenue)} />}
                    {isAdmin && <Row label="Gross profit" value={money(p.profit)} tone={p.profit < 0 ? "text-red-600" : "text-green-600"} />}
                    <Row label="Units sold" value={String(p.units)} />
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={28} />
            ))}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", tone)}>{value}</span>
    </div>
  );
}
