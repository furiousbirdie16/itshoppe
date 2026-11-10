import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PriceListSearch, type PricedRow } from "@/components/PriceListSearch";
import { quoteLineName } from "@/lib/price-list";

export interface PriceListPick {
  name: string;
  price: number;
}

/**
 * Picks a model from a supplier price list for a quotation line. The line is
 * a typed-in one (a name and a price), so nothing is added to inventory.
 */
export function PriceListPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (pick: PriceListPick) => void;
}) {
  const [use, setUse] = useState<"price" | "msrp">("price");

  const pick = (r: PricedRow) => {
    const price = use === "msrp" ? r.msrp : r.price;
    if (price == null) {
      toast.error(use === "msrp" ? "This model has no MSRP. Use your price instead." : "This model has no price group yet.");
      return;
    }
    onPick({ name: quoteLineName(r.model, r.description), price });
    toast.success(`Added ${r.model}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add from price list</DialogTitle>
          <DialogDescription>Click a model to add it as a line. You can add several, then close this.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={use} onValueChange={(v) => setUse(v as "price" | "msrp")} className="flex gap-5">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="price" id="pl-use-price" />
            <Label htmlFor="pl-use-price" className="text-sm font-normal">Use your price (SDP + markup)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="msrp" id="pl-use-msrp" />
            <Label htmlFor="pl-use-msrp" className="text-sm font-normal">Use MSRP</Label>
          </div>
        </RadioGroup>
        {open && <PriceListSearch onPick={pick} autoFocus compact />}
      </DialogContent>
    </Dialog>
  );
}
