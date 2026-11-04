import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOnlineOrderLines, getSoldUnitsForOnlineSales, findActiveUnitBySerial, recordSoldUnit, releaseSoldUnit,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, X, Plus, Camera, CheckCircle2 } from "lucide-react";
import { SerialScanner } from "@/components/SerialScanner";
import { canScan } from "@/lib/scanning";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { OnlineSale, SoldUnit } from "@/types/database";
import { describeHolder } from "@/lib/serial-holder";
import { nextLineNeedingSerial, onlineOrderLabel, serialProgress, serialsNeeded } from "@/lib/online-serials";

interface Props {
  orderNumber: string;
  /**
   * The packing-table mode: one box at the top, and each serial goes to the
   * next line in the order that still needs one, so a stack of units can be
   * scanned without picking a line for each.
   */
  quickEntry?: boolean;
  /** Called once when the order has every serial it needs. */
  onComplete?: () => void;
}

const lineName = (l: OnlineSale) => {
  const base = l.items?.name || l.product_name || "Item";
  const variation = l.item_variations?.name;
  return variation ? `${base} — ${variation}` : base;
};

/**
 * Serials for one online order (every line sharing its order number). Like the
 * invoice panel it never blocks the sale: it records, and the Online Sales page
 * shows which orders are still short.
 */
export function OnlineOrderSerialsPanel({ orderNumber, quickEntry = false, onComplete }: Props) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [quick, setQuick] = useState("");
  const quickRef = useRef<HTMLInputElement | null>(null);
  // Which line the camera fills; "next" means whichever line is next in quick mode.
  const [scanning, setScanning] = useState<OnlineSale | "next" | null>(null);
  const [conflict, setConflict] = useState<{ held: SoldUnit; serial: string; line: OnlineSale } | null>(null);

  const { data: lines = [], isPending: linesPending } = useQuery({
    queryKey: ["online-order-lines", orderNumber],
    queryFn: () => getOnlineOrderLines(orderNumber),
    enabled: !!orderNumber,
  });
  const tracked = useMemo(() => lines.filter((l) => serialsNeeded(l) > 0), [lines]);
  const ids = useMemo(() => lines.map((l) => l.id), [lines]);

  const { data: units = [], isSuccess: unitsLoaded } = useQuery({
    queryKey: ["sold-units", "online", ids],
    queryFn: () => getSoldUnitsForOnlineSales(ids),
    enabled: ids.length > 0,
  });

  const unitsByLine = useMemo(() => {
    const out: Record<string, SoldUnit[]> = {};
    for (const u of units) if (u.online_sale_id) (out[u.online_sale_id] ||= []).push(u);
    return out;
  }, [units]);
  const counts = useMemo(
    () => Object.fromEntries(Object.entries(unitsByLine).map(([k, v]) => [k, v.length])),
    [unitsByLine],
  );
  const progress = serialProgress(tracked, counts);
  const complete = progress.needed > 0 && progress.recorded >= progress.needed;
  const nextLine = nextLineNeedingSerial(tracked, counts);

  // Fires once, when the last serial lands here. An order opened already
  // complete does not fire, so it stays on screen to be looked at.
  const sawIncomplete = useRef(false);
  const fired = useRef(false);
  useEffect(() => {
    if (!unitsLoaded || progress.needed === 0) return;
    if (!complete) { sawIncomplete.current = true; return; }
    if (sawIncomplete.current && !fired.current) {
      fired.current = true;
      onComplete?.();
    }
  }, [unitsLoaded, complete, progress.needed, onComplete]);

  useEffect(() => {
    if (quickEntry && !linesPending) quickRef.current?.focus();
  }, [quickEntry, linesPending, orderNumber]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["sold-units"] });
    queryClient.invalidateQueries({ queryKey: ["online_sales", "serial-counts"] });
    // A reassign can take a serial off an invoice.
    queryClient.invalidateQueries({ queryKey: ["invoices-missing-serials"] });
  };

  const record = (serial: string, line: OnlineSale) =>
    recordSoldUnit({
      serial,
      item_id: line.item_id,
      online_sale_id: line.id,
      warranty_months: Number(line.items?.warranty_months || 0),
      // Cover runs from the order date, which for a Shopee upload is the ship time.
      warranty_starts_at: line.order_date || null,
    });

  const afterAdd = (line: OnlineSale) => {
    setDrafts((p) => ({ ...p, [line.id]: "" }));
    setQuick("");
    refresh();
    // A line's own scanner has nothing left to do once that line is full.
    if (scanning !== "next" && (counts[line.id] || 0) + 1 >= serialsNeeded(line)) setScanning(null);
  };

  const addMut = useMutation({
    mutationFn: (args: { serial: string; line: OnlineSale }) => record(args.serial, args.line),
    onSuccess: (_d, args) => { afterAdd(args.line); toast.success("Serial recorded"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const releaseMut = useMutation({
    mutationFn: (unitId: string) => releaseSoldUnit(unitId),
    onSuccess: () => { refresh(); toast.success("Serial removed"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reassignMut = useMutation({
    mutationFn: async () => {
      if (!conflict) return;
      await releaseSoldUnit(conflict.held.id, "Returned — reassigned to another sale");
      await record(conflict.serial, conflict.line);
    },
    onSuccess: () => {
      if (conflict) afterAdd(conflict.line);
      setConflict(null);
      toast.success("Serial reassigned");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = async (line: OnlineSale | null, value: string) => {
    const serial = value.trim();
    if (!serial) return;
    if (!line) { toast.error("This order already has all its serials."); return; }
    if (units.some((u) => u.serial === serial)) { toast.error("Already scanned on this order"); return; }
    if ((counts[line.id] || 0) >= serialsNeeded(line)) {
      toast.error("This line already has all its serials. Remove one to change it.");
      return;
    }
    // A duplicate stops and asks: two warranties pointing at one unit is a real error.
    const held = await findActiveUnitBySerial(serial);
    if (held) { setConflict({ held, serial, line }); return; }
    addMut.mutate({ serial, line });
  };

  const chip = (u: SoldUnit) => (
    <span key={u.id} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px]">
      {u.serial}
      <button
        type="button"
        onClick={() => releaseMut.mutate(u.id)}
        className="text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${u.serial}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );

  if (linesPending) return <p className="text-xs text-muted-foreground">Loading order…</p>;
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No online order with ID <span className="font-mono">{orderNumber}</span>.</p>;

  const first = lines[0];
  // Lines whose status took their serials back, still holding some only if
  // something went wrong; shown so they can be freed.
  const stranded = lines.filter((l) => serialsNeeded(l) === 0 && (unitsByLine[l.id] || []).length > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{onlineOrderLabel(first)}</p>
          <p className="text-xs text-muted-foreground">{first.order_date}</p>
        </div>
        {progress.needed > 0 && (
          <Badge
            variant="outline"
            className={cn("shrink-0 text-xs", complete ? "bg-success/15 text-success border-success/30" : "text-muted-foreground")}
          >
            {complete && <CheckCircle2 className="h-3 w-3 mr-1" />}
            {progress.recorded} of {progress.needed} serials
          </Badge>
        )}
      </div>

      {tracked.length === 0 && stranded.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing in this order needs a serial.</p>
      )}

      {quickEntry && nextLine && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Next: <span className="font-medium text-foreground">{lineName(nextLine)}</span>
            {" "}({(counts[nextLine.id] || 0) + 1} of {serialsNeeded(nextLine)})
          </p>
          <div className="flex gap-2">
            <Input
              ref={quickRef}
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(nextLine, quick); } }}
              placeholder="Scan or type the serial"
              className="h-9 font-mono text-sm"
            />
            {canScan() && (
              <Button size="sm" className="h-9 shrink-0" onClick={() => setScanning("next")}>
                <Camera className="h-3.5 w-3.5 mr-1" /> Camera
              </Button>
            )}
          </div>
        </div>
      )}

      {tracked.map((line) => {
        const mine = unitsByLine[line.id] || [];
        const need = serialsNeeded(line);
        const full = mine.length >= need;
        return (
          <div key={line.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{lineName(line)}</span>
              <Badge
                variant="outline"
                className={cn("text-[10px] font-medium shrink-0", full ? "bg-success/15 text-success border-success/30" : "text-muted-foreground")}
              >
                {mine.length} of {need}
              </Badge>
            </div>
            {mine.length > 0 && <div className="flex flex-wrap gap-1.5">{mine.map(chip)}</div>}
            {!full && !quickEntry && (
              <div className="flex gap-2">
                <Input
                  value={drafts[line.id] || ""}
                  onChange={(e) => setDrafts((p) => ({ ...p, [line.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(line, drafts[line.id] || ""); } }}
                  placeholder="Type or paste the serial"
                  className="h-8 font-mono text-xs"
                />
                <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => void submit(line, drafts[line.id] || "")} disabled={addMut.isPending}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
                {canScan() && (
                  <Button size="sm" className="h-8 shrink-0" onClick={() => setScanning(line)}>
                    <Camera className="h-3.5 w-3.5 mr-1" /> Scan
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {stranded.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">On lines that no longer need serials. Remove these to free them.</p>
          <div className="flex flex-wrap gap-1.5">{stranded.flatMap((l) => (unitsByLine[l.id] || []).map(chip))}</div>
        </div>
      )}

      {complete && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-success">
          <ShieldCheck className="h-4 w-4" /> All serials recorded for this order.
        </p>
      )}

      <SerialScanner
        open={!!scanning}
        onOpenChange={(o) => !o && setScanning(null)}
        title={
          scanning === "next"
            ? nextLine ? `Scan — ${lineName(nextLine)}` : "Order complete"
            : scanning ? `Scan — ${lineName(scanning)}` : "Scan a serial"
        }
        onScan={(value) => {
          if (scanning === "next") void submit(nextLine, value);
          else if (scanning) void submit(scanning, value);
        }}
      />

      <Dialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">Already sold</DialogTitle></DialogHeader>
          {conflict && (
            <div className="space-y-2 text-sm">
              <p className="font-mono text-xs">{conflict.serial}</p>
              <p className="text-muted-foreground">
                This serial is already on <span className="font-medium text-foreground">{describeHolder(conflict.held)}</span>.
              </p>
              <p className="text-[11px] text-muted-foreground">
                Reassign only if the unit came back and is being sold again. Your name is recorded either way.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)}>Cancel</Button>
            <Button onClick={() => reassignMut.mutate()} disabled={reassignMut.isPending}>
              This unit was returned — reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
