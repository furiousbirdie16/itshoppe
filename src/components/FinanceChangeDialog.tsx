import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { changeLines, metricValue, snapshotForDaysAgo, type ChangeLine, type FinanceFigures, type FinanceMetric, type FinanceSnapshot } from "@/lib/finance-compare";
import { getChangeRecords, recordStamp } from "@/lib/finance-snapshots";
import { peso } from "@/lib/currency";
import { cn } from "@/lib/utils";

interface Props {
  metric: FinanceMetric | null;
  onClose: () => void;
  now: FinanceFigures;
  snapshots: FinanceSnapshot[];
  /** The record the card's own "since" line uses, so the two agree on opening. */
  defaultDate: string | null;
}

const TITLES: Record<FinanceMetric, string> = { free: "Free to spend", nav: "Net asset value" };
const PRESETS = [
  { days: 1, label: "Yesterday" },
  { days: 7, label: "7 days ago" },
  { days: 30, label: "30 days ago" },
];
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${peso(Math.abs(v))}`;

/** One line's records, loaded when it is opened. */
function LineRecords({ line, since }: { line: ChangeLine; since: string }) {
  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["finance-change-records", line.key, since],
    queryFn: () => getChangeRecords(line.key, since),
  });
  if (isLoading) return <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>;
  if (isError) return <p className="px-3 py-2 text-xs text-destructive">Could not load these records.</p>;
  if (data.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No records changed since then. A deleted entry leaves nothing to list here.</p>;
  }
  return (
    <div className="divide-y">
      {data.map((r) => (
        <div key={r.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{r.title}</div>
            <div className="truncate text-[11px] text-muted-foreground">{recordStamp(r.when)}{r.detail ? ` · ${r.detail}` : ""}</div>
          </div>
          <div className="shrink-0 text-xs tabular-nums">{r.amount}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * What moved Free to spend or Net Asset Value: the figures on a saved day
 * against now, each line with the effect it had, and the records behind it.
 */
export function FinanceChangeDialog({ metric, onClose, now, snapshots, defaultDate }: Props) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);

  useEffect(() => {
    if (!metric) return;
    setDate(defaultDate ?? snapshotForDaysAgo(snapshots, today, 7)?.date ?? null);
    setOpenLine(null);
    // Set on opening; the choice is then the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  const then = useMemo(() => snapshots.find((s) => s.date === date) ?? null, [snapshots, date]);
  const lines = useMemo(() => (metric && then ? changeLines(metric, then, now) : []), [metric, then, now]);
  const dates = useMemo(() => [...snapshots].reverse(), [snapshots]);

  if (!metric) return null;
  const current = metricValue(metric, now);
  const before = then ? metricValue(metric, then) : 0;
  const change = current - before;
  const whenLabel = then
    ? then.date === today ? `earlier today, ${format(new Date(then.capturedAt), "h:mm a")}` : `the end of ${format(parseISO(then.date), "MMM d, yyyy")}`
    : "";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{TITLES[metric]}: {peso(current)}</DialogTitle>
          <DialogDescription className={cn("text-sm", then && change < 0 && "text-destructive", then && change > 0 && "text-success")}>
            {then
              ? Math.abs(change) < 0.005
                ? `No change since ${whenLabel}`
                : `${change > 0 ? "Up" : "Down"} ${peso(Math.abs(change))} since ${whenLabel}`
              : "Nothing saved yet to compare with."}
          </DialogDescription>
        </DialogHeader>

        {snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">The figures are saved every night at 11:59 PM. The comparison starts from the first saved day.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Compare with</span>
              {PRESETS.map((p) => {
                const s = snapshotForDaysAgo(snapshots, today, p.days);
                return (
                  <Button
                    key={p.days}
                    type="button"
                    variant={s?.date === date ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => { setDate(s?.date ?? null); setOpenLine(null); }}
                  >
                    {p.label}
                  </Button>
                );
              })}
              <Select value={date ?? undefined} onValueChange={(v) => { setDate(v); setOpenLine(null); }}>
                <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Pick a date" /></SelectTrigger>
                <SelectContent>
                  {dates.map((s) => (
                    <SelectItem key={s.date} value={s.date}>{format(parseISO(s.date), "MMM d, yyyy")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {then?.approximate && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                Approximate. This day comes from the older snapshot, which worked some figures out differently: it may
                count rent that was not yet due, it treated the owner's balance differently, and it valued stock at one
                company cost. Part of the change shown can come from that rather than real movement.
              </p>
            )}

            {then && (
              <div className="overflow-hidden rounded-lg border">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground sm:gap-x-6">
                  <span>Line</span>
                  <span className="w-24 text-right">Then</span>
                  <span className="w-24 text-right">Now</span>
                  <span className="w-24 text-right">Effect</span>
                </div>
                {lines.map((l) => {
                  const moved = Math.abs(l.effect) >= 0.005;
                  const isOpen = openLine === l.key;
                  return (
                    <div key={l.key} className="border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setOpenLine(isOpen ? null : l.key)}
                        aria-expanded={isOpen}
                        className="grid w-full grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-3 px-3 py-2 text-left text-sm hover:bg-muted/40 sm:gap-x-6"
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                          <span className="truncate">{l.label}</span>
                        </span>
                        <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{peso(l.then)}</span>
                        <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{peso(l.now)}</span>
                        <span className={cn(
                          "w-24 text-right text-xs font-medium tabular-nums",
                          !moved && "font-normal text-muted-foreground",
                          moved && l.effect > 0 && "text-success",
                          moved && l.effect < 0 && "text-destructive",
                        )}>
                          {moved ? signed(l.effect) : "—"}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="border-t bg-muted/20">
                          <LineRecords line={l} since={then.capturedAt} />
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-3 bg-muted/40 px-3 py-2 text-sm font-semibold sm:gap-x-6">
                  <span>{TITLES[metric]}</span>
                  <span className="w-24 text-right text-xs tabular-nums">{peso(before)}</span>
                  <span className="w-24 text-right text-xs tabular-nums">{peso(current)}</span>
                  <span className="inline-flex w-24 items-center justify-end gap-0.5 text-xs tabular-nums">
                    {change > 0 ? <ArrowUp className="h-3 w-3" /> : change < 0 ? <ArrowDown className="h-3 w-3" /> : null}
                    {signed(change)}
                  </span>
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Open a line to see the records behind it. Whole business, whichever branch is selected.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
