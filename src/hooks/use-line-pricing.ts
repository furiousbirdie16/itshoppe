import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getPreviousItemPrice } from "@/lib/customerPricing";
import { getLastPriceForModel, getLinkedListPrices, isWalkIn, LINKED_PRICES_KEY } from "@/lib/price-list-api";
import { resolveStartPrice, type ListPrices } from "@/lib/start-price";
import type { PriceSource } from "@/lib/price-source";

/** What a line needs to be priced: the inventory item, or a price list product. */
export interface PricedLineInput {
  item_id: string;
  variation_id: string | null;
  /** The price list product's name (model), for lines added from a price list. */
  model?: string;
  /** That product's prices, for lines added from a price list. */
  list?: ListPrices | null;
}

/**
 * Prices invoice and quotation lines by one rule (see resolveStartPrice):
 * the customer's previous price, else the price list, else the standard price.
 */
export function useLinePricing(
  items: { id: string; selling_price?: number | null }[],
  variations: { id: string; selling_price?: number | null }[],
) {
  const queryClient = useQueryClient();
  return useCallback(
    async (line: PricedLineInput, customer: { id: string; channel?: string | null } | null | undefined): Promise<{ price: number; source: PriceSource } | null> => {
      const walkIn = isWalkIn(customer);
      // A variation has its own price, so the item's list prices don't apply to it.
      const linked = line.item_id && !line.variation_id
        ? (await queryClient.fetchQuery({ queryKey: LINKED_PRICES_KEY, queryFn: getLinkedListPrices, staleTime: 60_000 })).get(line.item_id)
        : undefined;
      const list: ListPrices | null = line.list ?? (linked ? { brand: linked.brand, bottom: linked.bottom, srp: linked.srp, sdp: linked.sdp } : null);
      const model = line.model ?? linked?.product;

      let previous: number | null = null;
      if (!walkIn && customer?.id) {
        if (line.item_id) previous = await getPreviousItemPrice(customer.id, line.item_id, line.variation_id);
        // A price list line typed in by name (before it was linked, or never linked).
        if (previous == null && model) previous = (await getLastPriceForModel(customer.id, model))?.price ?? null;
      }

      const variation = line.variation_id ? variations.find((v) => v.id === line.variation_id) : undefined;
      const item = line.item_id ? items.find((i) => i.id === line.item_id) : undefined;
      const standard = Number((variation ?? item)?.selling_price) || null;
      return resolveStartPrice({ walkIn, previous, list, standard });
    },
    [queryClient, items, variations],
  );
}

/** A line whose price was filled in for you, so it may be filled in again (not typed, not saved). */
export const isAutoPriced = (l: { priceSource?: PriceSource; savedPrice?: boolean }) => !l.savedPrice && l.priceSource !== "manual";

type PricedLine = PricedLineInput & { item_name: string; priceSource?: PriceSource; savedPrice?: boolean };

/**
 * `reprice(idx, line)` looks up the line's start price and fills it in when it
 * arrives, unless by then the line holds another product, its price was
 * typed, or the document's customer changed.
 */
export function useRepriceLine<L extends PricedLine>(opts: {
  setLines: Dispatch<SetStateAction<L[]>>;
  customerId: string;
  customers: { id: string; channel?: string | null }[];
  items: { id: string; selling_price?: number | null }[];
  variations: { id: string; selling_price?: number | null }[];
  /** The line's price field as the page keeps it (a number or a string). */
  toField: (price: number | null) => L extends { unit_price: infer U } ? U : never;
}) {
  const priceLine = useLinePricing(opts.items, opts.variations);
  const customerRef = useRef(opts.customerId);
  customerRef.current = opts.customerId;
  const { setLines, customers, toField } = opts;
  return useCallback(
    (idx: number, line: L, customerId: string = customerRef.current) => {
      if (!line.item_id && !line.list) return;
      // A customer just chosen is the current one, even before the page re-renders.
      customerRef.current = customerId;
      const customer = customers.find((c) => c.id === customerId) ?? null;
      const same = (l: L) => l.item_id === line.item_id && l.variation_id === line.variation_id && l.item_name === line.item_name;
      priceLine(line, customer)
        .then((res) => {
          if (customerRef.current !== customerId) return;
          setLines((prev) =>
            prev.map((l, i) => (i === idx && same(l) && isAutoPriced(l) ? { ...l, unit_price: toField(res?.price ?? null), priceSource: res?.source } : l)),
          );
        })
        .catch(() => {
          /* The line keeps whatever price it had; you can type one. */
        });
    },
    [priceLine, customers, setLines, toField],
  );
}
