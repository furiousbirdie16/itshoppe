import { supabase } from "@/integrations/supabase/client";

/**
 * Bundle SKUs: a marketplace SKU that stands for one or more inventory items.
 * See the migration 20261026000000_sku_bundles.sql for why.
 */

export interface SkuBundleLine {
  item_id: string;
  variation_id: string | null;
  /** Of this part, per one unit of the bundle. */
  quantity: number;
  /** The one line that carries the bundle's price; the others are ₱0. */
  gets_price: boolean;
  /** For display, filled when read. */
  item_name?: string;
  item_sku?: string | null;
  variation_name?: string | null;
  variation_sku?: string | null;
}

export interface SkuBundle {
  id?: string;
  sku: string;
  lines: SkuBundleLine[];
}

/** How SKUs are compared everywhere: case and spacing do not matter. */
export const skuKey = (s: string | null | undefined) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export interface ExpandedLine {
  item_id: string;
  variation_id: string | null;
  quantity: number;
  /** Per unit, so quantity × unitPrice is the line's share of the order. */
  unitPrice: number;
  /** What to call the line: the part's own SKU, else its name. */
  label: string;
}

/**
 * One order line for a bundle SKU, as the lines of its parts.
 *
 * The whole price goes on the gets_price part (the first, if none is marked);
 * every other part is ₱0. Quantities multiply by the order's: 2 bundles of
 * "1 cable + 2 connectors" are 2 cables and 4 connectors.
 */
export function expandBundle(bundle: SkuBundle, orderQty: number, unitPrice: number): ExpandedLine[] {
  const lines = bundle.lines.filter((l) => l.item_id && l.quantity > 0);
  if (lines.length === 0) return [];
  const priced = lines.findIndex((l) => l.gets_price);
  const pricedIndex = priced >= 0 ? priced : 0;
  const qty = Math.max(Number(orderQty) || 0, 0);
  const total = (Number(unitPrice) || 0) * qty;

  return lines.map((l, i) => {
    const partQty = l.quantity * qty;
    return {
      item_id: l.item_id,
      variation_id: l.variation_id ?? null,
      quantity: partQty,
      // The total spread over the priced part's own units, so the line still
      // comes to exactly what the customer paid.
      unitPrice: i === pricedIndex && partQty > 0 ? Math.round((total / partQty) * 10000) / 10000 : 0,
      label: l.variation_sku || l.item_sku || l.variation_name || l.item_name || bundle.sku,
    };
  });
}

/** Problems with a bundle as entered, or none. */
export function bundleProblems(bundle: SkuBundle): string[] {
  const out: string[] = [];
  if (!skuKey(bundle.sku)) out.push("Enter the SKU");
  const lines = bundle.lines.filter((l) => l.item_id);
  if (lines.length === 0) out.push("Add at least one item");
  if (lines.some((l) => !(Number(l.quantity) > 0))) out.push("Every item needs a quantity above 0");
  if (lines.filter((l) => l.gets_price).length > 1) out.push("Only one item can get the price");
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function getSkuBundles(): Promise<SkuBundle[]> {
  const { data, error } = await db
    .from("sku_bundles")
    .select("id, sku, sku_bundle_lines(item_id, variation_id, quantity, gets_price, sort_order, items(name, sku), item_variations(name, sku))")
    .order("sku");
  // Not there yet (the migration has not been run): no bundles, not a failure.
  if (error) return [];
  return ((data as any[]) || []).map((b) => ({
    id: b.id,
    sku: b.sku,
    lines: [...(b.sku_bundle_lines || [])]
      .sort((a: any, c: any) => a.sort_order - c.sort_order)
      .map((l: any) => ({
        item_id: l.item_id,
        variation_id: l.variation_id,
        quantity: Number(l.quantity),
        gets_price: !!l.gets_price,
        item_name: l.items?.name,
        item_sku: l.items?.sku,
        variation_name: l.item_variations?.name ?? null,
        variation_sku: l.item_variations?.sku ?? null,
      })),
  }));
}

export async function saveSkuBundle(bundle: SkuBundle): Promise<string> {
  const problems = bundleProblems(bundle);
  if (problems.length) throw new Error(problems[0]);
  const { data: { session } } = await supabase.auth.getSession();
  const row = { sku: bundle.sku.trim(), updated_at: new Date().toISOString(), updated_by_email: session?.user?.email ?? null };

  let id = bundle.id;
  if (id) {
    const { error } = await db.from("sku_bundles").update(row).eq("id", id);
    if (error) throw error;
    const { error: delErr } = await db.from("sku_bundle_lines").delete().eq("bundle_id", id);
    if (delErr) throw delErr;
  } else {
    const { data, error } = await db.from("sku_bundles").insert(row).select("id").single();
    if (error) {
      if (String(error.message).includes("sku_bundles_sku_key")) throw new Error(`"${bundle.sku.trim()}" is already set up`);
      throw error;
    }
    id = data.id as string;
  }

  const lines = bundle.lines.filter((l) => l.item_id);
  const priced = lines.findIndex((l) => l.gets_price);
  const { error: lineErr } = await db.from("sku_bundle_lines").insert(
    lines.map((l, i) => ({
      bundle_id: id,
      item_id: l.item_id,
      variation_id: l.variation_id || null,
      quantity: Number(l.quantity),
      gets_price: i === (priced >= 0 ? priced : 0),
      sort_order: i,
    })),
  );
  if (lineErr) throw lineErr;
  return id!;
}

export async function deleteSkuBundle(id: string) {
  const { error } = await db.from("sku_bundles").delete().eq("id", id);
  if (error) throw error;
}
