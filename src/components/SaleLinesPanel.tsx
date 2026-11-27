import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";

export interface SaleLine {
  id: string;
  sku?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  /**
   * What the whole line cost. null when it has no cost (a typed-in line, or a
   * product with no cost on file); such lines are left out of profit.
   */
  lineCost?: number | null;
}

interface Props {
  lines: SaleLine[];
  loading?: boolean;
  /** Admin only: adds cost, profit and margin per line and for the whole order. */
  showProfit?: boolean;
  /** Says where the cost figures come from, under the totals. */
  costNote?: string | null;
}

const pct = (profit: number, sales: number) => (sales > 0 ? `${((profit / sales) * 100).toFixed(1)}%` : "—");
const tone = (n: number) => (n < 0 ? "text-destructive" : "text-success");

/**
 * The items of an invoice or quotation, opened under its row in the list.
 * Profit is only ever passed in for admins; nothing about cost renders otherwise.
 */
export function SaleLinesPanel({ lines, loading, showProfit, costNote }: Props) {
  if (loading) return <p className="px-3 py-3 text-xs text-muted-foreground">Loading items…</p>;
  if (lines.length === 0) return <p className="px-3 py-3 text-xs text-muted-foreground">No items on this one.</p>;

  let sales = 0, costedSales = 0, cost = 0, uncosted = 0;
  for (const l of lines) {
    const t = l.quantity * l.unitPrice;
    sales += t;
    if (l.lineCost == null) { uncosted++; continue; }
    costedSales += t;
    cost += l.lineCost;
  }
  const profit = costedSales - cost;

  return (
    <div className="space-y-2 px-1 py-2">
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Item</th>
              <th className="px-2 py-1.5 text-right font-medium">Qty</th>
              <th className="px-2 py-1.5 text-right font-medium">Price</th>
              <th className="px-2 py-1.5 text-right font-medium">Total</th>
              {showProfit && <th className="px-2 py-1.5 text-right font-medium">Cost</th>}
              {showProfit && <th className="px-2 py-1.5 text-right font-medium">Profit</th>}
              {showProfit && <th className="px-2 py-1.5 text-right font-medium">Margin</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l) => {
              const total = l.quantity * l.unitPrice;
              const lp = l.lineCost == null ? null : total - l.lineCost;
              return (
                <tr key={l.id}>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{l.name}</div>
                    {l.sku && <div className="text-[11px] text-primary tabular-nums">{l.sku}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{peso(l.unitPrice)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap font-medium">{peso(total)}</td>
                  {showProfit && (
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                      {l.lineCost == null ? <span className="text-[11px] text-amber-600">No cost</span> : peso(l.lineCost)}
                    </td>
                  )}
                  {showProfit && (
                    <td className={cn("px-2 py-1.5 text-right tabular-nums whitespace-nowrap font-medium", lp != null && tone(lp))}>
                      {lp == null ? "—" : peso(lp)}
                    </td>
                  )}
                  {showProfit && (
                    <td className={cn("px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-xs", lp != null && tone(lp))}>
                      {lp == null ? "—" : pct(lp, total)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showProfit && (
        <div className="flex flex-wrap items-baseline justify-end gap-x-5 gap-y-1 rounded-md bg-primary/5 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Sales <span className="font-medium text-foreground tabular-nums">{peso(sales)}</span></span>
          <span className="text-muted-foreground">Cost <span className="font-medium text-foreground tabular-nums">{peso(cost)}</span></span>
          <span className="text-muted-foreground">
            Total profit <span className={cn("text-sm font-semibold tabular-nums", tone(profit))}>{peso(profit)}</span>
          </span>
          <span className="text-muted-foreground">Margin <span className={cn("font-semibold tabular-nums", tone(profit))}>{pct(profit, costedSales)}</span></span>
        </div>
      )}
      {showProfit && (uncosted > 0 || costNote) && (
        <p className="px-1 text-right text-[11px] text-muted-foreground">
          {costNote}
          {uncosted > 0 && `${costNote ? " " : ""}${uncosted} line${uncosted === 1 ? " has" : "s have"} no cost and ${uncosted === 1 ? "is" : "are"} left out of profit.`}
        </p>
      )}
    </div>
  );
}
