import { Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { docNo } from "@/lib/doc-number";

interface Props {
  quotation: any;
  locked: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** The same actions the desktop table renders, passed in so they cannot drift. */
  actions: React.ReactNode;
}

/**
 * Mobile (<md) replacement for a quotation table row, laid out like the
 * invoice card: number and total on the first line, customer under it, then
 * status, date and agent, with the actions on a row of their own.
 */
export function QuotationMobileCard({ quotation: q, locked, selected, onToggleSelect, actions }: Props) {
  return (
    <div className={cn("rounded-lg border bg-card p-3", selected && "bg-muted/40 ring-1 ring-primary/30")}>
      <div className="flex items-start gap-2.5">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="mt-0.5 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1 tabular-nums text-xs font-semibold">
              <span className="truncate">{docNo(q.quotation_number)}</span>
              {locked && <Lock className="h-3 w-3 shrink-0 text-amber-500" aria-label="Locked" />}
            </span>
            <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{peso(Number(q.total_amount))}</span>
          </div>

          <div className="mt-1 truncate text-sm">{q.customers?.name || "—"}</div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <StatusBadge status={q.status} />
            <span>{q.quotation_date}</span>
            {q.sales_agent && <span className="truncate">· {q.sales_agent}</span>}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-end gap-1 border-t pt-2">
        {actions}
      </div>
    </div>
  );
}
