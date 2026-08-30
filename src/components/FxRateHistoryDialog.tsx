import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { peso } from "@/lib/currency";
import { foreignAmount, replayFx } from "@/lib/fx";
import type { CashAccount, CashTransaction } from "@/types/database";

interface Props {
  account: CashAccount | null;
  transactions: CashTransaction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function RateTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <div className="font-medium mb-1">{p.date}</div>
      {p.rate != null && (
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Rate paid</span>
          <span className="font-mono">{p.rate.toFixed(2)}</span>
        </div>
      )}
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Average after</span>
        <span className="font-mono">{p.average.toFixed(2)}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Held</span>
        <span className="font-mono">{p.held}</span>
      </div>
    </div>
  );
}

/**
 * What this currency has cost over time: the rate paid on each purchase, and the
 * weighted average those purchases add up to.
 *
 * The average is the number the balance is actually carried at — a single "rate"
 * for a currency bought in batches does not exist, which is why both lines are
 * shown together. Outflows have no rate of their own: they are consumed at the
 * average in force, so they move the held quantity but not the average.
 */
export function FxRateHistoryDialog({ account, transactions, open, onOpenChange }: Props) {
  const steps = useMemo(() => {
    if (!account) return [];
    return replayFx(transactions.filter((t) => t.account_id === account.id));
  }, [account, transactions]);

  const series = useMemo(
    () =>
      steps.map((s) => ({
        date: s.transaction.txn_date,
        // Only inflows carry a rate; an outflow leaves the line flat rather than
        // dropping to zero and drawing a cliff that never happened.
        rate: s.transaction.direction === "in" ? Number(s.transaction.fx_rate || 0) || null : null,
        average: s.averageRate,
        held: foreignAmount(s.quantity, account?.currency || ""),
      })),
    [steps, account],
  );

  const purchases = useMemo(
    () => steps.filter((s) => s.transaction.direction === "in" && Number(s.transaction.fx_rate || 0) > 0),
    [steps],
  );
  const best = purchases.length ? Math.min(...purchases.map((s) => Number(s.transaction.fx_rate))) : null;
  const worst = purchases.length ? Math.max(...purchases.map((s) => Number(s.transaction.fx_rate))) : null;
  const current = steps.length ? steps[steps.length - 1].averageRate : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {account?.name} — rate history
            {account?.currency ? ` (${account.currency})` : ""}
          </DialogTitle>
        </DialogHeader>

        {steps.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No movements on this account yet.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-card px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Carrying average</p>
                <p className="text-lg font-semibold tabular-nums">{current.toFixed(2)}</p>
              </div>
              <div className="rounded-lg border bg-card px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Best rate paid</p>
                <p className="text-lg font-semibold tabular-nums">{best != null ? best.toFixed(2) : "—"}</p>
              </div>
              <div className="rounded-lg border bg-card px-3 py-2">
                <p className="text-[11px] text-muted-foreground">Worst rate paid</p>
                <p className="text-lg font-semibold tabular-nums">{worst != null ? worst.toFixed(2) : "—"}</p>
              </div>
            </div>

            <ChartContainer
              config={{
                average: { label: "Weighted average", color: "hsl(var(--primary))" },
                rate: { label: "Rate paid", color: "hsl(var(--muted-foreground))" },
              }}
              className="h-[220px] w-full"
            >
              <LineChart data={series} margin={{ left: 4, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.7} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  minTickGap={28}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  domain={["dataMin - 0.2", "dataMax + 0.2"]}
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => Number(v).toFixed(2)}
                />
                <ChartTooltip content={<RateTooltip />} />
                <Line
                  dataKey="rate"
                  type="monotone"
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={{ r: 2.5 }}
                  connectNulls
                />
                <Line
                  dataKey="average"
                  type="monotone"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ChartContainer>

            <div className="max-h-[280px] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Movement</TableHead>
                    <TableHead className="text-xs text-right">Rate</TableHead>
                    <TableHead className="text-xs text-right">PHP</TableHead>
                    <TableHead className="text-xs text-right">Held after</TableHead>
                    <TableHead className="text-xs text-right">Average after</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...steps].reverse().map((s) => {
                    const isIn = s.transaction.direction === "in";
                    const rate = Number(s.transaction.fx_rate || 0);
                    return (
                      <TableRow key={s.transaction.id}>
                        <TableCell className="text-sm text-muted-foreground">{s.transaction.txn_date}</TableCell>
                        <TableCell className={`text-sm tabular-nums ${isIn ? "text-emerald-600" : "text-destructive/80"}`}>
                          {isIn ? "+" : "−"}{foreignAmount(Number(s.transaction.amount), account?.currency || "")}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {isIn && rate > 0 ? rate.toFixed(2) : <span className="text-muted-foreground">at average</span>}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{peso(s.phpAmount)}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {foreignAmount(s.quantity, account?.currency || "")}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums font-medium">{s.averageRate.toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
