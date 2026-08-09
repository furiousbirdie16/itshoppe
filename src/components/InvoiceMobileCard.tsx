import { Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";

interface Props {
  invoice: any;
  locked: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** The same actions the desktop table renders, passed in so they cannot drift. */
  actions: React.ReactNode;
}

/**
 * Mobile (<md) replacement for an invoice table row.
 *
 * The table has eight columns and forces horizontal scrolling on a phone, which
 * hides the two things that matter most — status and total. Here they sit on the
 * first line, and the actions wrap onto their own row at a comfortable tap size.
 */
export function InvoiceMobileCard({ invoice: inv, locked, selected, onToggleSelect, actions }: Props) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", selected && "bg-muted/40 ring-1 ring-primary/30")}>
      <div className="flex items-start gap-2.5">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="mt-0.5 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1 font-mono text-xs font-semibold">
              <span className="truncate">{inv.invoice_number}</span>
              {locked && <Lock className="h-3 w-3 shrink-0 text-amber-500" aria-label="Locked" />}
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {peso(Number(inv.total_amount))}
            </span>
          </div>

          <div className="mt-1 truncate text-sm">{inv.customers?.name || "—"}</div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <StatusBadge status={inv.status} context="invoice" />
            <span>{inv.invoice_date}</span>
            {inv.sales_agent && <span className="truncate">· {inv.sales_agent}</span>}
          </div>
        </div>
      </div>

      {/* Actions get their own row: on a phone they would otherwise be cramped
          against the amount and easy to mis-tap. */}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1 border-t pt-2">
        {actions}
      </div>
    </div>
  );
}
