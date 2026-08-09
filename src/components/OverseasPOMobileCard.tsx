import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/StatusBadge";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";

interface Props {
  po: any;
  branchName: string;
  /** Resolved arrival: confirmed shows a tick, an estimate is labelled as one. */
  arrival: { date: string; confirmed: boolean } | null;
  itemsSummary: React.ReactNode;
  isAdmin: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** The same actions the desktop table renders, passed in so they cannot drift. */
  actions: React.ReactNode;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Mobile (<md) replacement for an overseas PO table row.
 *
 * That table carries eleven columns; on a phone the amount and ETA sit far off
 * the right edge. Here the PO number and PHP value lead, with supplier, status
 * and arrival stacked beneath, so nothing needs horizontal scrolling.
 */
export function OverseasPOMobileCard({
  po, branchName, arrival, itemsSummary, isAdmin, selected, onToggleSelect, actions,
}: Props) {
  return (
    <div className={cn("rounded-xl border bg-card p-3", selected && "bg-muted/40 ring-1 ring-primary/30")}>
      <div className="flex items-start gap-2.5">
        {isAdmin && <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="mt-0.5 shrink-0" />}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span className="truncate font-mono text-xs font-semibold">{po.po_number}</span>
            {isAdmin && (
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {peso(Number(po.total_amount) * Number(po.exchange_rate || 1))}
              </span>
            )}
          </div>

          <div className="mt-1 truncate text-sm">{po.overseas_suppliers?.name || "—"}</div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <StatusBadge status={po.status} context="overseas_po" />
            {arrival ? (
              arrival.confirmed ? (
                <span className="font-medium text-success">✓ {fmtDate(arrival.date)}</span>
              ) : (
                <span title="Estimated — not yet confirmed as arrived">est. {fmtDate(arrival.date)}</span>
              )
            ) : null}
            {branchName && <span className="truncate">· {branchName}</span>}
            {isAdmin && (
              <span className="tabular-nums">
                · {po.currency} {Number(po.total_amount).toLocaleString()}
              </span>
            )}
          </div>

          <div className="mt-1.5 text-[11px] text-muted-foreground">{itemsSummary}</div>
        </div>
      </div>

      {/* Actions get their own row so they are not cramped against the amount. */}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1 border-t pt-2">
        {actions}
      </div>
    </div>
  );
}
