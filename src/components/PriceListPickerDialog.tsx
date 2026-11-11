import { format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PriceListSearch, type PricedRow } from "@/components/PriceListSearch";
import { quoteLineName } from "@/lib/price-list";
import { getLastPriceForModel, isMultiPrice } from "@/lib/price-list-api";
import { peso } from "@/lib/currency";

export interface PriceListPick {
  name: string;
  /** Null leaves the price blank for you to fill in. */
  price: number | null;
}

/**
 * Picks a model from a supplier price list for a quotation line.
 *
 * A list with named prices (TP-Link) adds the price chosen under "Quote at".
 * A one-price SDP list (Hikvision) has no selling price, since every customer
 * pays something different: the line gets the price this customer was last
 * quoted or invoiced for that model, or stays blank when there is none.
 * The line is a typed-in one, so nothing is added to inventory.
 */
export function PriceListPickerDialog({
  open,
  onOpenChange,
  onPick,
  customerId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (pick: PriceListPick) => void;
  customerId?: string | null;
}) {
  const pick = async (r: PricedRow) => {
    const name = quoteLineName(r.model, r.description);
    if (isMultiPrice(r.list)) {
      if (r.price == null) {
        toast.error("This model has no price for that choice.");
        return;
      }
      onPick({ name, price: r.price });
      toast.success(`Added ${r.model}`);
      return;
    }
    if (!customerId) {
      onPick({ name, price: null });
      toast.info(`Added ${r.model} with no price. Choose the customer first to fill in their last price.`);
      return;
    }
    try {
      const last = await getLastPriceForModel(customerId, r.model);
      onPick({ name, price: last?.price ?? null });
      if (last) {
        toast.success(`Added ${r.model} at ${peso(last.price)}, their last price (${last.from}, ${format(new Date(last.date), "MMM d, yyyy")})`);
      } else {
        toast.info(`Added ${r.model}. No earlier price for this customer, so enter one.`);
      }
    } catch {
      onPick({ name, price: null });
      toast.error(`Added ${r.model}, but couldn't look up their last price. Enter one.`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add from price list</DialogTitle>
          <DialogDescription>
            Click a model to add it. Hikvision lines use this customer's last price for the model, or stay blank. TP-Link lines use the price in bold.
          </DialogDescription>
        </DialogHeader>
        {open && <PriceListSearch onPick={pick} autoFocus compact />}
      </DialogContent>
    </Dialog>
  );
}
