import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
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
  return { linkedOf, startPrice };
}
