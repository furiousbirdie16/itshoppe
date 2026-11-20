import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ArrowLeftRight, ClipboardEdit, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import type { Item } from "@/types/database";
import { useBranch } from "@/contexts/BranchContext";
import { TransferStockDialog } from "@/components/TransferStockDialog";

type Location = "warehouse" | "store";

interface Props {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose stock, when opened for one branch's row (the shortage card). */
  branchId?: string;
  /**
   * "found": stock turned up in the store that was never counted, so the
   * question is how many were found, not what the count now is.
   */
  mode?: "count" | "found";
}

export function AdjustStockDialog({ item, open, onOpenChange, branchId: fixedBranchId, mode: initialMode = "count" }: Props) {
  const qc = useQueryClient();
  const { activeBranchId, branches } = useBranch();
  const [location, setLocation] = useState<Location>("store");
  const [actualQty, setActualQty] = useState("");
  const [foundQty, setFoundQty] = useState("");
  const [mode, setMode] = useState<"count" | "found">(initialMode);
  const [transferOpen, setTransferOpen] = useState(false);
  const [notes, setNotes] = useState("");
  // Asked for here when the toolbar says "All branches": the branch switcher is
  // behind this dialog and cannot be reached without closing it.
  const [pickedBranchId, setPickedBranchId] = useState("");
  const branchId = fixedBranchId || activeBranchId || pickedBranchId;
  /** The branch whose own figures must be read, when `item` holds a total. */
  const lookupBranchId = activeBranchId && (!fixedBranchId || fixedBranchId === activeBranchId) ? "" : (fixedBranchId || pickedBranchId);

  useEffect(() => {
    if (open) {
      setLocation("store");
      setActualQty("");
      setFoundQty("");
      setMode(initialMode);
      setNotes("");
      setPickedBranchId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  // On "All branches" the quantities on `item` are every branch added together,
  // which is not what is being adjusted. Once a branch is picked, read that
  // branch's own figures so the difference is measured against the right stock.
  const { data: branchStock } = useQuery({
    queryKey: ["item_branch_stock", item?.id, lookupBranchId],
    enabled: !!item && !!lookupBranchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("item_branch_stock")
        .select("warehouse_quantity, store_quantity")
        .eq("item_id", item!.id)
        .eq("branch_id", lookupBranchId)
        .maybeSingle();
      if (error) throw error;
      return data as { warehouse_quantity: number; store_quantity: number } | null;
    },
  });

  const wh = Number((branchStock?.warehouse_quantity ?? item?.warehouse_quantity) ?? 0);
  const st = Number((branchStock?.store_quantity ?? item?.store_quantity) ?? 0);
  const found = mode === "found";
  const where: Location = found ? "store" : location;
  const currentQty = where === "warehouse" ? wh : st;
  const foundNum = foundQty === "" ? null : parseInt(foundQty);
  // Found: the count becomes what the system had plus what turned up.
  const actualNum = found
    ? (foundNum === null || Number.isNaN(foundNum) ? null : currentQty + foundNum)
    : (actualQty === "" ? null : parseInt(actualQty));
  const diff = actualNum === null || Number.isNaN(actualNum) ? 0 : actualNum - currentQty;
  const kind = diff < 0 ? "missing" : diff > 0 ? "surplus" : null;
  /**
   * Raising a short store while the warehouse has stock is nearly always a
   * transfer nobody recorded: setting the store to 0 then invents stock. Ask
   * which it was before allowing it.
   */
  const askWhich = !found && where === "store" && st < 0 && wh > 0 && diff > 0;

  const adjustMut = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item selected");
      if (!branchId) throw new Error("Pick which branch's stock you are adjusting");
      if (found) {
        if (foundNum === null || Number.isNaN(foundNum) || foundNum <= 0) throw new Error("Enter how many were found");
      } else if (actualNum === null || Number.isNaN(actualNum) || actualNum < 0) {
        throw new Error("Enter a valid actual quantity");
      }
      if (askWhich) throw new Error("Choose whether it was a transfer or found in the store");
      if (diff === 0) throw new Error("Actual quantity matches current — no adjustment needed");

      const { data: rpcData, error: rpcErr } = await (supabase as any).rpc("apply_branch_stock_change", {
        _item_id: item.id,
        _branch_id: branchId,
        _location: where,
        _delta_stock: diff,
        _delta_open: 0,
        _units_per_stock: null,
      });
      if (rpcErr) throw rpcErr;
      const row: any = Array.isArray(rpcData) ? rpcData[0] : rpcData;

      const { recordMovement } = await import("@/lib/inventoryLog");
      const movementId = await recordMovement({
        itemId: item.id,
        branchId,
        type: diff < 0 ? "adjust_missing" : "adjust_surplus",
        quantity: Math.abs(diff),
        unit: item.base_unit || "pcs",
        location: where,
        notes: found
          ? `Found in store: ${diff} (${currentQty} → ${actualNum})${notes ? ` — ${notes}` : ""}`
          : `${where === "warehouse" ? "Warehouse" : "Store"}: ${currentQty} → ${actualNum}${notes ? ` — ${notes}` : ""}`,
        balanceBefore: where === "warehouse" ? row.wh_before : row.st_before,
        balanceAfter: where === "warehouse" ? row.warehouse_quantity : row.store_quantity,
      });

      // A count that disagrees with the system is the movement worth seeing as
      // it happens: nothing else explains stock changing.
      const { notifyInventoryAdjustments } = await import("@/lib/api");
      notifyInventoryAdjustments(movementId ? [movementId] : []);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["item_branch_stock"] });
      qc.invalidateQueries({ queryKey: ["adjust-history", item?.id] });
      toast.success(found ? "Found stock added to the store" : "Stock adjusted");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: history = [] } = useQuery({
    queryKey: ["adjust-history", item?.id],
    enabled: !!item && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id, type, quantity, notes, created_at")
        .eq("item_id", item!.id)
        .in("type", ["adjust_missing", "adjust_surplus"])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            {found ? <><PackageSearch className="h-4 w-4" /> Found in store</> : <><ClipboardEdit className="h-4 w-4" /> Adjust Stock</>}
          </DialogTitle>
          <DialogDescription className="text-xs">{item.name}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 pt-2">
          {!activeBranchId && !fixedBranchId && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Branch</Label>
              <Select value={pickedBranchId} onValueChange={setPickedBranchId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Whose stock are you adjusting?" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name} ({b.branch_code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!pickedBranchId && (
                <p className="text-[11px] text-muted-foreground">
                  The quantities below are every branch added together until you choose one.
                </p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Warehouse</div>
              <div className="text-2xl font-semibold">{wh}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Store</div>
              <div className={`text-2xl font-semibold ${st < 0 ? "text-destructive" : ""}`}>{st}</div>
            </div>
          </div>

          {found ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">How many were found in the store?</Label>
              <Input
                type="number"
                min={1}
                value={foundQty}
                onChange={(e) => setFoundQty(e.target.value)}
                placeholder="Pieces found"
                className="h-9"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Stock that was in the store but never counted. The warehouse is not touched.
                {diff > 0 && <> The store goes from {currentQty} to {actualNum}.</>}
              </p>
            </div>
          ) : (<>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Location</Label>
            <Select value={location} onValueChange={(v) => setLocation(v as Location)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="store">Store</SelectItem>
                <SelectItem value="warehouse">Warehouse</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Actual Quantity (system shows {currentQty})</Label>
            <Input
              type="number"
              min={0}
              value={actualQty}
              onChange={(e) => setActualQty(e.target.value)}
              placeholder="Enter the real counted quantity"
              className="h-9"
            />
            {kind && (
              <div className="flex items-center gap-2 pt-1">
                <Badge variant={kind === "missing" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                  {kind}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {kind === "missing" ? `${Math.abs(diff)} pcs will be deducted` : `${diff} pcs will be added`}
                </span>
              </div>
            )}
          </div>
          </>)}

          {askWhich && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
              <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  The store is short {-st} and the warehouse has {wh}. If stock was carried over from the
                  warehouse, record a transfer: raising the store here would add stock that does not exist.
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="h-8 text-xs" onClick={() => setTransferOpen(true)}>
                  <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" /> Record a transfer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => { setMode("found"); setFoundQty(String(diff)); }}
                >
                  <PackageSearch className="mr-1.5 h-3.5 w-3.5" /> It was found in the store
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Reason / Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="resize-none" placeholder="e.g. damaged, recount, found extra..." />
          </div>

          <Button
            onClick={() => adjustMut.mutate()}
            disabled={adjustMut.isPending || !kind || askWhich}
            className="rounded-lg h-9"
          >
            {found ? "Add found stock" : "Save Adjustment"}
          </Button>

          <div className="space-y-1.5 pt-2 border-t">
            <Label className="text-xs font-medium">Adjustment History</Label>
            {history.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">No adjustments yet.</div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {history.map((h: any) => {
                  const isMissing = h.type === "adjust_missing";
                  const dt = new Date(h.created_at);
                  return (
                    <div key={h.id} className="px-2.5 py-1.5 text-xs flex flex-col gap-0.5">
                      <div className="flex justify-between gap-2">
                        <Badge variant={isMissing ? "destructive" : "secondary"} className="text-[10px] uppercase w-fit">
                          {isMissing ? "Missing" : "Surplus"}
                        </Badge>
                        <span className="text-muted-foreground">{isMissing ? "-" : "+"}{h.quantity}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{dt.toLocaleString()}</div>
                      {h.notes && <div className="text-[11px] text-muted-foreground italic truncate">{h.notes}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
      <TransferStockDialog
        item={item}
        open={transferOpen}
        onOpenChange={(o) => { setTransferOpen(o); if (!o) onOpenChange(false); }}
        branchId={branchId || undefined}
        initialQty={Math.min(-st, wh)}
      />
    </Dialog>
  );
}

export default AdjustStockDialog;
