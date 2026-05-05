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
import { ClipboardEdit } from "lucide-react";
import { toast } from "sonner";
import type { Item } from "@/types/database";

type Location = "warehouse" | "store";

interface Props {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AdjustStockDialog({ item, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [location, setLocation] = useState<Location>("store");
  const [actualQty, setActualQty] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setLocation("store");
      setActualQty("");
      setNotes("");
    }
  }, [open, item?.id]);

  const wh = Number(item?.warehouse_quantity ?? 0);
  const st = Number(item?.store_quantity ?? 0);
  const currentQty = location === "warehouse" ? wh : st;
  const actualNum = actualQty === "" ? null : parseInt(actualQty);
  const diff = actualNum === null || Number.isNaN(actualNum) ? 0 : actualNum - currentQty;
  const kind = diff < 0 ? "missing" : diff > 0 ? "surplus" : null;

  const adjustMut = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item selected");
      if (actualNum === null || Number.isNaN(actualNum) || actualNum < 0) {
        throw new Error("Enter a valid actual quantity");
      }
      if (diff === 0) throw new Error("Actual quantity matches current — no adjustment needed");

      const newWh = location === "warehouse" ? actualNum : wh;
      const newSt = location === "store" ? actualNum : st;

      const { error: upErr } = await supabase
        .from("items")
        .update({ warehouse_quantity: newWh, store_quantity: newSt })
        .eq("id", item.id);
      if (upErr) throw upErr;

      const { error: mvErr } = await supabase.from("inventory_movements").insert({
        item_id: item.id,
        type: diff < 0 ? "adjust_missing" : "adjust_surplus",
        quantity: Math.abs(diff),
        notes: `${location === "warehouse" ? "Warehouse" : "Store"}: ${currentQty} → ${actualNum}${notes ? ` — ${notes}` : ""}`,
      });
      if (mvErr) throw mvErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["adjust-history", item?.id] });
      toast.success("Stock adjusted");
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
            <ClipboardEdit className="h-4 w-4" /> Adjust Stock
          </DialogTitle>
          <DialogDescription className="text-xs">{item.name}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Warehouse</div>
              <div className="text-2xl font-semibold">{wh}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Store</div>
              <div className="text-2xl font-semibold">{st}</div>
            </div>
          </div>

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

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Reason / Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="resize-none" placeholder="e.g. damaged, recount, found extra..." />
          </div>

          <Button
            onClick={() => adjustMut.mutate()}
            disabled={adjustMut.isPending || !kind}
            className="rounded-lg h-9"
          >
            Save Adjustment
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
    </Dialog>
  );
}

export default AdjustStockDialog;
