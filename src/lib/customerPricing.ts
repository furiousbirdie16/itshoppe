import { supabase } from "@/integrations/supabase/client";

export interface CustomerPriceInfo {
  fixed: number | null;
  fixedNotes: string | null;
  lastSold: { price: number; date: string; reference: string | null } | null;
  standard: number;
  /** The recommended price following hierarchy: fixed → lastSold → standard */
  suggested: number;
}

/**
 * Resolve customer-specific pricing for an item (and optional variation).
 * Hierarchy: customer fixed price → most recent sold price → standard selling price.
 */
export async function getCustomerPrice(
  customerId: string,
  itemId: string,
  variationId: string | null,
  standardPrice: number,
): Promise<CustomerPriceInfo> {
  // Fixed price lookup
  let fixedQuery = supabase
    .from("customer_prices")
    .select("fixed_price, notes")
    .eq("customer_id", customerId)
    .eq("item_id", itemId);
  fixedQuery = variationId
    ? fixedQuery.eq("variation_id", variationId)
    : fixedQuery.is("variation_id", null);
  const { data: fixedRow } = await fixedQuery.maybeSingle();

  // Last sold lookup
  let lastQuery = supabase
    .from("customer_price_history")
    .select("unit_price, sold_at, reference_number")
    .eq("customer_id", customerId)
    .eq("item_id", itemId);
  lastQuery = variationId
    ? lastQuery.eq("variation_id", variationId)
    : lastQuery.is("variation_id", null);
  const { data: lastRows } = await lastQuery
    .order("sold_at", { ascending: false })
    .limit(1);

  const fixed = fixedRow ? Number(fixedRow.fixed_price) : null;
  const lastSold = lastRows && lastRows[0]
    ? {
        price: Number(lastRows[0].unit_price),
        date: lastRows[0].sold_at as string,
        reference: (lastRows[0].reference_number as string | null) ?? null,
      }
    : null;

  const suggested =
    fixed != null ? fixed : lastSold ? lastSold.price : standardPrice;

  return {
    fixed,
    fixedNotes: fixedRow?.notes ?? null,
    lastSold,
    standard: standardPrice,
    suggested,
  };
}
