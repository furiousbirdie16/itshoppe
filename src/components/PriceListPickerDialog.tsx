import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PriceListSearch, type PricedRow } from "@/components/PriceListSearch";
import { quoteLineName } from "@/lib/price-list";
import { getLastPriceForModel, isMultiPrice } from "@/lib/price-list-api";
import { peso } from "@/lib/currency";
import { supabase } from "@/integrations/supabase/client";
import { getItems } from "@/lib/api";

export interface PriceListPick {
  name: string;
  /** Null leaves the price blank for you to fill in. */
  price: number | null;
  /** Set when the product is linked to an inventory item: the line is that item. */
  itemId?: string | null;
}

/**
 * A walk-in: no customer on the quotation, or one whose channel says
 * walk-in. Walk-ins pay SRP; everyone else starts at Bottom.
 */
async function getCustomerChannel(customerId: string): Promise<string> {
  const { data } = await supabase.from("customers").select("channel").eq("id", customerId).maybeSingle();
  return (data as { channel?: string } | null)?.channel ?? "";
}

/**
 * Picks a model from a price list for a quotation line.
 *
 * Lists with named prices (your office list, TP-Link) add the price chosen
 * under "Quote at": Bottom by default, SRP for walk-ins. A one-price SDP
 * list (Hikvision) has no selling price: the line gets this customer's last
 * price for the model, or stays blank. A product linked to an inventory
 * item is added as that item, so invoicing it takes it out of stock;
 * otherwise the line is typed-in and nothing in inventory changes.
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
  const { data: channel = "" } = useQuery({
    queryKey: ["customer-channel", customerId],
    queryFn: () => getCustomerChannel(customerId!),
    enabled: open && !!customerId,
  });
  const walkIn = !customerId || /walk/i.test(channel);
  const { data: items = [] } = useQuery({ queryKey: ["items"], queryFn: getItems, enabled: open, staleTime: 5 * 60_000 });

  const pick = async (r: PricedRow) => {
    if (r.tags?.includes("no_stock")) {
      toast.error(`${r.model} is marked No stock in the price list.`);
      return;
    }
    const item = r.itemId ? items.find((i) => i.id === r.itemId) : undefined;
    // A linked product goes in under its inventory name, so the line is the item.
    const name = item?.name ?? quoteLineName(r.model, r.description);
    const itemId = item?.id ?? null;
    if (isMultiPrice(r.list)) {
      if (r.price == null) {
        toast.error("This product has no price for that choice.");
        return;
      }
      onPick({ name, price: r.price, itemId });
      toast.success(`Added ${item ? item.name : r.model}${item ? " from inventory" : ""}`);
      return;
    }
    if (!customerId) {
      onPick({ name, price: null, itemId });
      toast.info(`Added ${r.model} with no price. Choose the customer first to fill in their last price.`);
      return;
    }
    try {
      const last = await getLastPriceForModel(customerId, r.model);
      onPick({ name, price: last?.price ?? null, itemId });
      if (last) {
        toast.success(`Added ${r.model} at ${peso(last.price)}, their last price (${last.from}, ${format(new Date(last.date), "MMM d, yyyy")})`);
      } else {
        toast.info(`Added ${r.model}. No earlier price for this customer, so enter one.`);
      }
    } catch {
      onPick({ name, price: null, itemId });
      toast.error(`Added ${r.model}, but couldn't look up their last price. Enter one.`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add from price list</DialogTitle>
          <DialogDescription>
            Click a product to add it at the price in bold ({walkIn ? "SRP for walk-ins" : "Bottom for this customer"}; change it under Quote at).
            Hikvision lines use the customer's last price. Products marked In inventory go in as the inventory item.
          </DialogDescription>
        </DialogHeader>
        {open && <PriceListSearch onPick={pick} autoFocus compact defaultQuoteAt={walkIn ? "srp" : "bottom"} />}
      </DialogContent>
    </Dialog>
  );
}
