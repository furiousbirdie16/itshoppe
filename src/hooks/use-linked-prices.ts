import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PriceSource } from "@/lib/price-source";
import { getLinkedListPrices, isWalkIn, linkedStartPrice, LINKED_PRICES_KEY, type LinkedListPrice } from "@/lib/price-list-api";

/**
 * Price list prices for inventory items linked to a price list product, for
 * invoice and quotation lines. `startPrice(itemId, customer)` is the price a
 * line for that item starts at: SRP for walk-ins, Bottom otherwise, or null
 * when the item isn't linked (the line keeps its usual price).
 */
export function useLinkedPrices() {
  const { data } = useQuery({ queryKey: LINKED_PRICES_KEY, queryFn: getLinkedListPrices, staleTime: 60_000 });
  const linkedOf = useCallback((itemId: string | null | undefined): LinkedListPrice | undefined => (itemId ? data?.get(itemId) : undefined), [data]);
  const startPrice = useCallback(
    (itemId: string | null | undefined, customer: { channel?: string | null } | null | undefined) => linkedStartPrice(linkedOf(itemId), isWalkIn(customer)),
    [linkedOf],
  );
  /** Which list price `startPrice` picked ("list:bottom" or "list:srp"), or undefined when unlinked. */
  const startPriceSource = useCallback(
    (itemId: string | null | undefined, customer: { channel?: string | null } | null | undefined): PriceSource | undefined => {
      const p = linkedOf(itemId);
      const walkIn = isWalkIn(customer);
      if (!p || linkedStartPrice(p, walkIn) == null) return undefined;
      // Mirrors linkedStartPrice: each side falls back to the other.
      const useSrp = walkIn ? p.srp != null : p.bottom == null;
      return useSrp ? "list:srp" : "list:bottom";
    },
    [linkedOf],
  );
  return { linkedOf, startPrice, startPriceSource };
}
