import { cn } from "@/lib/utils";

interface Props {
  /** The one thing you scan the list for — payee, lender, customer. */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Primary figure, right-aligned opposite the title. */
  amount: React.ReactNode;
  /** A second figure under the amount: outstanding, PHP value, balance. */
  amountSub?: React.ReactNode;
  /** Tone for the amount. "in" is green, "out" red, default inherits. */
  tone?: "in" | "out";
  /** Small print on the footer row — dates, who recorded it. */
  meta?: React.ReactNode;
  /** Status badge, shown on the footer row before the meta text. */
  badge?: React.ReactNode;
  /** The same actions the desktop row renders, passed in so they cannot drift. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Shared mobile (<md) replacement for a row in any of the finance tables —
 * payables, receivables, loans, owner transactions, cash and bank.
 *
 * Those tables run to seven or more columns and force horizontal scrolling on a
 * phone, which hides the amount and the status. One component rather than one
 * per page keeps them from drifting apart as each page gets edited.
 */
export function FinanceMobileCard({
  title,
  subtitle,
  amount,
  amountSub,
  tone,
  meta,
  badge,
  actions,
  className,
}: Props) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        <div className="shrink-0 text-right">
          <div
            className={cn(
              "text-sm font-semibold tabular-nums",
              tone === "in" && "text-emerald-600",
              tone === "out" && "text-destructive/80",
            )}
          >
            {amount}
          </div>
          {amountSub && <div className="text-[11px] text-muted-foreground tabular-nums">{amountSub}</div>}
        </div>
      </div>

      {(badge || meta || actions) && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {badge}
            {meta}
          </div>
          {/* Actions sit at a full 32px tap target rather than the table's 28px. */}
          {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
        </div>
      )}
    </div>
  );
}
