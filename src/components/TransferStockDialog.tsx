import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import type { Item } from "@/types/database";

type Direction = "w2s" | "s2w";

interface Props {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TransferStockDialog({ item, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [direction, setDirection] = useState<Direction>("w2s");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setDirection("w2s");
      setQty("1");
      setNotes("");
    }
  }, [open, item?.id]);

  const transferMut = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error("No item selected");
      const n = parseInt(qty);
      if (Number.isNaN(n) || n <= 0) throw new Error("Enter a quantity greater than 0");

      const wh = Number(item.warehouse_quantity ?? 0);
      const st = Number(item.store_quantity ?? 0);

      let newWh = wh;
      let newSt = st;

      if (direction === "w2s") {
        if (n > wh) throw new Error(`Warehouse only has ${wh} in stock`);
        newWh = wh - n;
        newSt = st + n;
      } else {
        if (n > st) throw new Error(`Store only has ${st} in stock`);
        newSt = st - n;
        newWh = wh + n;
      }

      const { error: upErr } = await supabase
        .from("items")
        .update({ warehouse_quantity: newWh, store_quantity: newSt })
        .eq("id", item.id);
      if (upErr) throw upErr;

      const { error: mvErr } = await supabase.from("inventory_movements").insert({
        item_id: item.id,
        type: direction === "w2s" ? "transfer_w2s" : "transfer_s2w",
        quantity: n,
        notes: notes || (direction === "w2s" ? "Warehouse → Store" : "Store → Warehouse"),
      });
      if (mvErr) throw mvErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      toast.success("Stock transferred");
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: history = [] } = useQuery({
    queryKey: ["transfer-history", item?.id],
    enabled: !!item && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id, type, quantity, notes, created_at")
        .eq("item_id", item!.id)
        .in("type", ["transfer_w2s", "transfer_s2w"])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  if (!item) return null;
  const wh = Number(item.warehouse_quantity ?? 0);
  const st = Number(item.store_quantity ?? 0);
  const sourceQty = direction === "w2s" ? wh : st;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" /> Transfer Stock
          </DialogTitle>
          <DialogDescription className="text-xs">
            {item.name}
          </DialogDescription>
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
            <Label className="text-xs font-medium">Direction</Label>
            <Select value={direction} onValueChange={(v) => setDirection(v as Direction)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="w2s">Warehouse → Store</SelectItem>
                <SelectItem value="s2w">Store → Warehouse</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Quantity (max {sourceQty})</Label>
            <Input
              type="number"
              min={1}
              max={sourceQty}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="resize-none" />
          </div>

          <Button
            onClick={() => transferMut.mutate()}
            disabled={transferMut.isPending || sourceQty === 0}
            className="rounded-lg h-9"
          >
            Transfer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TransferStockDialog;
