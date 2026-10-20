import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";

export interface CustomerLastPrice {
  customer_id: string;
  item_id: string;
  variation_id: string | null;
  unit_price: number;
  sold_at: string;
  reference_number: string | null;
  source: string | null;
  times_bought: number;
}

/**
 * The latest price every customer paid for every product, one row per pair.
 *
 * Resolved in the database rather than by loading history into the browser: the
 * answer must not depend on how much history happened to be fetched.
 */
export async function getCustomerLastPrices(): Promise<CustomerLastPrice[]> {
  // Paged: the database returns at most 1000 rows per request, and the
  // function sorts by customer id, so past 1000 customer–product pairs every
  // customer whose id sorted late simply vanished from the pricing page.
  // The function's ORDER BY is unique per row, so the pages cannot overlap.
  return fetchAllRows<CustomerLastPrice>(() => (supabase as any).rpc("customer_last_prices"));
}

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
  const sb = supabase as any;
  // Fixed price lookup
  let fixedQuery = sb
    .from("customer_prices")
    .select("fixed_price, notes")
    .eq("customer_id", customerId)
    .eq("item_id", itemId);
  fixedQuery = variationId
    ? fixedQuery.eq("variation_id", variationId)
    : fixedQuery.is("variation_id", null);
  const { data: fixedRow } = await fixedQuery.maybeSingle();

  // Last sold lookup
  let lastQuery = sb
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

export interface PriceHistoryRow {
  item_id: string;
  variation_id: string | null;
  unit_price: number;
  sold_at: string;
  reference_number: string | null;
  created_at?: string | null;
}

export interface LatestPrice {
  item_id: string;
  variation_id: string | null;
  unit_price: number;
  sold_at: string;
  reference_number: string | null;
  times_bought: number;
}

/**
 * The newest price per product (and variation) from one customer's history,
 * newest first — the same rule `customer_last_prices` applies in the database:
 * latest sold_at, ties broken by the later created_at.
 */
export function latestPricesFrom(history: PriceHistoryRow[]): LatestPrice[] {
  const byKey = new Map<string, LatestPrice & { created_at: string }>();
  for (const h of history) {
    const key = `${h.item_id}|${h.variation_id ?? ""}`;
    const created = h.created_at ?? "";
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { ...h, variation_id: h.variation_id ?? null, unit_price: Number(h.unit_price), times_bought: 1, created_at: created });
      continue;
    }
    cur.times_bought++;
    if (h.sold_at > cur.sold_at || (h.sold_at === cur.sold_at && created > cur.created_at)) {
      Object.assign(cur, { unit_price: Number(h.unit_price), sold_at: h.sold_at, reference_number: h.reference_number, created_at: created });
    }
  }
  return Array.from(byKey.values())
    .map(({ created_at: _c, ...rest }) => rest)
    .sort((a, b) => (a.sold_at < b.sold_at ? 1 : a.sold_at > b.sold_at ? -1 : 0));
}

/** One customer's price history, every row (paged past the 1000-row cap). */
export async function getCustomerPriceHistory(customerId: string): Promise<PriceHistoryRow[]> {
  return fetchAllRows<PriceHistoryRow>(() =>
    (supabase as any)
      .from("customer_price_history")
      .select("item_id, variation_id, unit_price, sold_at, reference_number, created_at, id")
      .eq("customer_id", customerId)
      .order("sold_at", { ascending: false })
      .order("id"),
  );
}
