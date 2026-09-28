import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSoldUnitsForInvoice, findActiveUnitBySerial, recordSoldUnit, releaseSoldUnit, getInvoiceItems } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ShieldCheck, X, Plus, Camera } from "lucide-react";
import { SerialScanner } from "@/components/SerialScanner";
import { canScan } from "@/lib/scanning";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { InvoiceItem, SoldUnit } from "@/types/database";

interface Props {
  invoiceId: string;
}

/**
 * Serial capture for an invoice, phase 1: typed entry, no camera yet.
 *
 * Deliberately never blocks anything. Serials may be added from the moment the
 * invoice exists, and an invoice can be paid and shipped without them — a
 * customer waiting at the counter beats data hygiene. The check that warns on
 * a short line comes later, at paid-or-shipped.
 */
export function InvoiceSerialsPanel({ invoiceId }: Props) {
  const queryClient = useQueryClient();

  // Fetched here rather than handed down, so the panel is never at the mercy of
  // a parent's stale copy. Same cache key as the parent's, so this costs no
  // extra request — it just cannot be given lines that no longer exist.
  const { data: lines = [], isPending: linesPending } = useQuery({
    queryKey: ["invoice_items", invoiceId],
    queryFn: () => getInvoiceItems(invoiceId),
    enabled: !!invoiceId,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Which line the camera is filling. The scanner stays open between units.
  const [scanningLine, setScanningLine] = useState<InvoiceItem | null>(null);
  // The serial being added that turned out to belong to someone else.
  const [conflict, setConflict] = useState<{
    held: SoldUnit; serial: string; line: InvoiceItem;
  } | null>(null);

  const { data: units = [] } = useQuery({
    queryKey: ["sold-units", invoiceId],
    queryFn: () => getSoldUnitsForInvoice(invoiceId),
  });

  // Only lines whose product asks for serials. A custom line with no item_id
  // has no product to ask, so it is left alone.
  const tracked = useMemo(
    () => lines.filter((l) => !!l.item_id && !!(l.items as { track_serials?: boolean } | undefined)?.track_serials),
    [lines],
  );

  const unitsByLine = useMemo(() => {
    const out: Record<string, SoldUnit[]> = {};
    for (const u of units) {
      const key = u.invoice_item_id || "";
      (out[key] ||= []).push(u);
    }
    return out;
  }, [units]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sold-units", invoiceId] });

  const addMut = useMutation({
    mutationFn: (args: { serial: string; line: InvoiceItem }) =>
      recordSoldUnit({
        serial: args.serial,
        item_id: args.line.item_id,
        invoice_id: invoiceId,
        invoice_item_id: args.line.id,
        warranty_months: Number((args.line.items as { warranty_months?: number } | undefined)?.warranty_months || 0),
      }),
    onSuccess: (_d, args) => {
      setDrafts((p) => ({ ...p, [args.line.id]: "" }));
      refresh();
      toast.success("Serial recorded");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const releaseMut = useMutation({
    mutationFn: (unitId: string) => releaseSoldUnit(unitId),
    onSuccess: () => { refresh(); toast.success("Serial released"); },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Release the previous holder, then assign here. */
  const reassignMut = useMutation({
    mutationFn: async () => {
      if (!conflict) return;
      await releaseSoldUnit(conflict.held.id, "Returned — reassigned to another sale");
      await recordSoldUnit({
        serial: conflict.serial,
        item_id: conflict.line.item_id,
        invoice_id: invoiceId,
        invoice_item_id: conflict.line.id,
        warranty_months: Number((conflict.line.items as { warranty_months?: number } | undefined)?.warranty_months || 0),
      });
    },
    onSuccess: () => {
      if (conflict) setDrafts((p) => ({ ...p, [conflict.line.id]: "" }));
      setConflict(null);
      refresh();
      toast.success("Serial reassigned");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = async (line: InvoiceItem, value?: string) => {
    const serial = (value ?? drafts[line.id] ?? "").trim();
    if (!serial) return;
    const here = (unitsByLine[line.id] || []).some((u) => u.serial === serial);
    if (here) { toast.error("Already scanned on this line"); return; }
    // A duplicate is a real error, not incomplete data, so this one stops and
    // asks rather than warning: letting it through would point two customers'
    // warranties at one unit.
    const held = await findActiveUnitBySerial(serial);
    if (held) { setConflict({ held, serial, line }); return; }
    addMut.mutate({ serial, line });
  };

  // Vanishing while the lines are still on their way is what made this look
  // broken on a freshly created invoice: no panel, no scan button, no reason
  // given, and only a refresh brought it back.
  if (linesPending) {
    return (
      <div className="mt-3 rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Loading serial numbers…</p>
      </div>
    );
  }

  if (tracked.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Serial numbers
        </p>
      </div>

      {/* Said once, not per line. iOS has no barcode reader in any browser —
          every one of them is Safari underneath — so the scan button being
          absent looks like a fault unless it is explained. */}
      {!canScan() && (
        <p className="text-[11px] text-muted-foreground">
          Camera scanning is not available in this browser. Type or paste serials below.
        </p>
      )}

      {tracked.map((line) => {
        const mine = unitsByLine[line.id] || [];
        const need = Number(line.quantity) || 0;
        const complete = mine.length >= need;
        const name = line.items?.name || line.item_name || "Item";
        return (
          <div key={line.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{name}</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-medium shrink-0",
                  complete
                    ? "bg-success/15 text-success border-success/30"
                    : "text-muted-foreground",
                )}
              >
                {mine.length} of {need}
              </Badge>
            </div>

            {mine.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {mine.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px]"
                  >
                    {u.serial}
                    <button
                      type="button"
                      onClick={() => releaseMut.mutate(u.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Release ${u.serial}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {!complete && (
              <div className="flex gap-2">
                <Input
                  value={drafts[line.id] || ""}
                  onChange={(e) => setDrafts((p) => ({ ...p, [line.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(line); } }}
                  placeholder="Type or paste the serial"
                  className="h-8 font-mono text-xs"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0"
                  onClick={() => submit(line)}
                  disabled={addMut.isPending}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
                {canScan() && (
                  <Button
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={() => setScanningLine(line)}
                  >
                    <Camera className="h-3.5 w-3.5 mr-1" /> Scan
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <SerialScanner
        open={!!scanningLine}
        onOpenChange={(o) => !o && setScanningLine(null)}
        title={scanningLine ? `Scan — ${scanningLine.items?.name || "item"}` : "Scan a serial"}
        onScan={(value) => { if (scanningLine) void submit(scanningLine, value); }}
      />

      <Dialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-lg">Already sold</DialogTitle></DialogHeader>
          {conflict && (
            <div className="space-y-2 text-sm">
              <p className="font-mono text-xs">{conflict.serial}</p>
              <p className="text-muted-foreground">
                This serial is already on invoice{" "}
                <span className="font-medium text-foreground">
                  {conflict.held.invoices?.invoice_number || "another sale"}
                </span>
                {conflict.held.invoices?.customers?.name
                  ? <> for <span className="font-medium text-foreground">{conflict.held.invoices.customers.name}</span></>
                  : null}
                {conflict.held.invoices?.invoice_date
                  ? <> on {conflict.held.invoices.invoice_date}</>
                  : null}.
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
