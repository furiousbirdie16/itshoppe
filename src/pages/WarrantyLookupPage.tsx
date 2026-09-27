import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { findUnitBySerial, getSerialHistory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Search, ShieldAlert, ShieldX } from "lucide-react";
import { format } from "date-fns";
import { warrantyStatus } from "@/lib/warranty";
import { cn } from "@/lib/utils";
import type { SoldUnit, SerialEvent } from "@/types/database";

/**
 * The counter screen: a customer is standing there with a unit, and the only
 * question is whether it is still covered — and, when they own several of the
 * same model, which one this actually is.
 */
export default function WarrantyLookupPage() {
  const [serial, setSerial] = useState("");
  const [result, setResult] = useState<{ unit: SoldUnit | null; history: SerialEvent[] } | null>(null);

  const lookup = useMutation({
    mutationFn: async (value: string) => {
      const unit = await findUnitBySerial(value);
      const history = unit ? await getSerialHistory(value) : [];
      return { unit, history };
    },
    onSuccess: (r) => setResult(r),
  });

  const run = () => {
    const v = serial.trim();
    if (!v) return;
    lookup.mutate(v);
  };

  const unit = result?.unit || null;
  const { state, startsAt, expiresAt, daysLeft } = warrantyStatus(unit || {});
  const covered = state === "covered";

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Warranty Lookup</h1>
        <p className="page-description">
          Find which sale a unit came from, and whether it is still covered.
        </p>
      </div>

      <div className="flex gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder="Serial number"
            className="pl-9 font-mono"
          />
        </div>
        <Button onClick={run} disabled={lookup.isPending} className="h-10 px-5">
          {lookup.isPending ? "Looking…" : "Look up"}
        </Button>
      </div>

      {result && !unit && (
        <div className="rounded-lg border bg-card p-6 max-w-xl">
          <div className="flex items-start gap-3">
            <ShieldX className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">No record of this serial</p>
              <p className="text-sm text-muted-foreground mt-1">
                Either it was sold before serials were recorded, or the unit did not come from here.
              </p>
            </div>
          </div>
        </div>
      )}

      {unit && (
        <div className="rounded-lg border bg-card p-4 max-w-xl space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-sm">{unit.serial}</p>
              <p className="text-lg font-semibold truncate">{unit.items?.name || "Unknown item"}</p>
            </div>
            {startsAt ? (
              <Badge
                variant="outline"
                className={cn(
                  "shrink-0 whitespace-nowrap font-medium",
                  covered
                    ? "bg-success/15 text-success border-success/30"
                    : "bg-destructive/15 text-destructive border-destructive/30",
                )}
              >
                {covered ? "In warranty" : "Out of warranty"}
              </Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 whitespace-nowrap bg-warning/15 text-warning border-warning/30">
                Not yet collected
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="text-muted-foreground">Customer</div>
            <div className="font-medium">{unit.invoices?.customers?.name || "—"}</div>
            <div className="text-muted-foreground">Invoice</div>
            <div className="font-medium">{unit.invoices?.invoice_number || "—"}</div>
            <div className="text-muted-foreground">Collected</div>
            <div className="font-medium">
              {startsAt ? format(startsAt, "MMMM d, yyyy") : "not yet marked shipped"}
            </div>
            <div className="text-muted-foreground">Warranty</div>
            <div className="font-medium">
              {unit.warranty_months ? `${unit.warranty_months} month${unit.warranty_months === 1 ? "" : "s"}` : "none"}
            </div>
            {expiresAt && (
              <>
                <div className="text-muted-foreground">Expires</div>
                <div className="font-medium">{format(expiresAt, "MMMM d, yyyy")}</div>
              </>
            )}
          </div>

          {daysLeft !== null && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 text-sm",
                covered
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {covered ? <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" /> : <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />}
              <span>
                {covered
                  ? `Covered for ${daysLeft} more day${daysLeft === 1 ? "" : "s"}.`
                  : `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago.`}
              </span>
            </div>
          )}

          {/* A serial that was returned and resold has more than one owner in
              its past, and the claim in front of you may be about either. */}
          {result && result.history.length > 1 && (
            <div className="space-y-1.5 border-t pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                History
              </p>
              {result.history.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground capitalize">{e.event}</span>
                  <span>{format(new Date(e.created_at), "MMM d, yyyy")}</span>
                  {e.actor_email && <span>· {e.actor_email}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
