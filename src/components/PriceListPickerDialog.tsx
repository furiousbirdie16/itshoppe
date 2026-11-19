import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { PriceListSearch, type PricedRow } from "@/components/PriceListSearch";
import { quoteLineName } from "@/lib/price-list";
import { supabase } from "@/integrations/supabase/client";
import { getItems } from "@/lib/api";
import type { ListPrices } from "@/lib/start-price";

export interface PriceListPick {
  name: string;
  /** Set when the product is linked to an inventory item: the line is that item. */
  itemId?: string | null;
  /** The product's name on the list, to find the customer's previous price for it. */
  model: string;
  /** The product's prices; the line is priced from these when there's no previous price. */
  list: ListPrices;
}

/**
 * A walk-in: no customer on the quotation, or one whose channel says
 * walk-in. Walk-ins pay SRP on your own list.
 */
async function getCustomerChannel(customerId: string): Promise<string> {
  const { data } = await supabase.from("customers").select("channel").eq("id", customerId).maybeSingle();
  return (data as { channel?: string } | null)?.channel ?? "";
}

/**
 * Picks a model from a price list for a quotation line. The line is priced
 * the same way as one added by item search: this customer's previous price,
 * else Bottom on your own list (SRP for walk-ins), else a supplier's Bottom,
 * or its SDP when it has none. A product linked to an inventory item is
 * added as that item, so invoicing it takes it out of stock; otherwise the
 * line is typed-in and nothing in inventory changes.
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

  const pick = (r: PricedRow) => {
    if (r.tags?.includes("no_stock")) {
      toast.error(`${r.model} is marked No stock in the price list.`);
      return;
    }
    const item = r.itemId ? items.find((i) => i.id === r.itemId) : undefined;
    // A linked product goes in under its inventory name, so the line is the item.
    const name = item?.name ?? quoteLineName(r.model, r.description);
    onPick({
      name,
      itemId: item?.id ?? null,
      model: r.model,
      list: { brand: r.list?.brand ?? "", bottom: r.prices?.bottom ?? null, srp: r.prices?.srp ?? null, sdp: r.sdp ?? null },
    });
    toast.success(`Added ${item ? `${item.name} from inventory` : r.model}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Add from price list</DialogTitle>
          <DialogDescription>
            Click a product to add it. It gets {walkIn ? "SRP on your list (walk-in), or a supplier's Bottom, else SDP" : "this customer's previous price; if they have none, Bottom, or SDP for a supplier without one"}.
            Products marked In inventory go in as the inventory item.
          </DialogDescription>
        </DialogHeader>
        {open && <PriceListSearch onPick={pick} autoFocus compact defaultQuoteAt={walkIn ? "srp" : "bottom"} />}
      </DialogContent>
    </Dialog>
  );
}
