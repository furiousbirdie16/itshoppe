import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductAction, ProductMetric, SaleTxn } from "@/types/insights";

const ACTION_CLASS: Record<ProductAction, string> = {
  Buy: "bg-red-500/10 text-red-600 border-red-500/30",
  Maintain: "bg-green-500/10 text-green-600 border-green-500/30",
  Reduce: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  Overstock: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  Dead: "bg-muted text-muted-foreground border-border",
};

const fmtDays = (d: number) => (d === Infinity ? "∞" : d > 999 ? ">999" : Math.round(d).toString());

function Metric({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("truncate text-sm font-medium tabular-nums", className)}>{value}</div>
    </div>
  );
}

interface Props {
  product: ProductMetric;
  txns: SaleTxn[];
  isAdmin: boolean;
  money: (n: number) => string;
  isOpen: boolean;
  onToggle: () => void;
}

/**
 * Mobile (<768px) replacement for a Product Performance table row. The desktop
 * table needs horizontal scrolling to reach the money columns; this shows the
 * same figures stacked so a phone only ever scrolls vertically.
 */
export function InsightsProductCard({ product: p, txns, isAdmin, money, isOpen, onToggle }: Props) {
  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full p-3 text-left"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5">
              {p.kind === "variation" && <span className="shrink-0 text-muted-foreground/60">↳</span>}
              <span className="line-clamp-2 text-sm font-semibold leading-snug">{p.name}</span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{p.sku}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
                p.source === "import" ? "bg-blue-500/10 text-blue-600" : "bg-secondary text-secondary-foreground",
              )}
            >
              {p.source || "local"}
            </span>
            <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium", ACTION_CLASS[p.action])}>
              {p.action}
            </span>
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 border-t pt-2.5">
          <Metric label="Stock" value={p.stock} className={p.threshold > 0 && p.stock <= p.threshold ? "text-destructive" : ""} />
          <Metric label="Sold" value={p.qtySold} />
          <Metric label="Days left" value={fmtDays(p.daysRemaining)} />
          {isAdmin && <Metric label="Revenue" value={money(p.revenue)} />}
          {isAdmin && <Metric label="Gross profit" value={money(p.grossProfit)} className="text-green-600" />}
          {isAdmin && <Metric label="Margin" value={p.qtySold ? `${p.margin.toFixed(1)}%` : "—"} />}
        </div>

        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {txns.length} sale{txns.length === 1 ? "" : "s"} in range
        </div>
      </button>

      {isOpen && (
        <div className="space-y-2 border-t bg-muted/20 p-3">
          {txns.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">No sales in this range.</p>
          ) : (
            txns.map((t, i) => (
              <div key={i} className="space-y-1 rounded-lg border bg-background p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.date ? format(new Date(t.date), "MMM d, yyyy") : "—"}</span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                      t.source === "online" ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {t.source === "online" ? "Online" : "Invoice"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="truncate">
                    {t.customer}
                    {t.agent && t.agent !== "—" ? ` · ${t.agent}` : ""}
                  </span>
                  <span className="shrink-0 font-mono">{t.reference}</span>
                </div>

                {t.variationName && (
                  <div className="truncate text-muted-foreground">{t.variationName}</div>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-1.5">
                  <span className="text-muted-foreground">
                    Qty <span className="font-semibold text-foreground tabular-nums">{t.quantity}</span>
                  </span>
                  {isAdmin && (
                    <span className="text-muted-foreground">
                      Amount{" "}
                      <span className={cn("font-semibold tabular-nums", t.paymentStatus === "unpaid" ? "text-amber-600" : "text-foreground")}>
                        {money(t.amount)}
                        {t.paymentStatus === "unpaid" ? "*" : ""}
                      </span>
                    </span>
                  )}
                  {isAdmin && (
                    <span className="text-muted-foreground">
                      GP{" "}
                      {t.profit != null ? (
                        <span className={cn("font-semibold tabular-nums", t.profit >= 0 ? "text-green-600" : "text-red-600")}>{money(t.profit)}</span>
                      ) : t.paymentStatus === "unpaid" ? (
                        <span className="italic text-amber-600">Pending payment</span>
                      ) : (
                        "—"
                      )}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default InsightsProductCard;
