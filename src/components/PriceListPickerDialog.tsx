import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PriceListSearch, type PricedRow } from "@/components/PriceListSearch";
import { quoteLineName } from "@/lib/price-list";

export interface PriceListPick {
  name: string;
  price: number;
}

/**
 * Picks a model from a supplier price list for a quotation line, at your
 * price (SDP plus the group's markup). The line is a typed-in one (a name
 * and a price), so nothing is added to inventory.
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
  const pick = (r: PricedRow) => {
    if (r.price == null) {
      toast.error("This model has no price group yet.");
      return;
    }
    onPick({ name: quoteLineName(r.model, r.description), price: r.price });
    toast.success(`Added ${r.model}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add from price list</DialogTitle>
          <DialogDescription>Click a model to add it at your price (SDP + markup). You can add several, then close this.</DialogDescription>
        </DialogHeader>
        {open && <PriceListSearch onPick={pick} autoFocus compact />}
      </DialogContent>
    </Dialog>
  );
}
