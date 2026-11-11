import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { logActivity } from "@/lib/activity-log";
import type { ParsedPriceRow, PriceKey, PriceTag } from "@/lib/price-list";
import type { Specs } from "@/lib/price-specs";
import { buildSearchText, keepRightKind, parseSearchQuery, rankMatches, termToPattern } from "@/lib/price-list-search";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PriceList {
  id: string;
  brand: string;
  name: string;
  file_name: string | null;
  row_count: number;
  is_active: boolean;
  created_at: string;
  /** Named prices the list carries (TP-Link: vip, dealer, bottom, srp). Empty for an SDP list. */
  price_columns: PriceKey[] | null;
  /** Sheets this upload kept, and the ones that were unticked. */
  sheets: string[] | null;
  skipped_sheets: string[] | null;
}

/** A list with named prices shows those instead of SDP plus markup. */
export const isMultiPrice = (l: PriceList | undefined | null) => (l?.price_columns?.length ?? 0) > 0;

export interface PriceListItem {
  id: string;
  price_list_id: string;
  model: string;
  description: string;
  category: string;
  sdp: number;
  prices: Partial<Record<PriceKey, number>>;
  warranty: string | null;
  tags: PriceTag[];
  specs: Specs;
}

export const PRICE_LISTS_KEY = ["price-lists"] as const;
export const CATEGORY_TYPES_KEY = ["price-category-types"] as const;

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export const getPriceLists = async (): Promise<PriceList[]> => {
  const { data, error } = await db.from("price_lists").select("*").order("created_at", { ascending: false }).order("id");
  if (error) throw error;
  return data || [];
};

/**
 * Saves a list and its rows. Rows go in batches of 500, and if any batch
 * fails the half-saved list is removed so it never shows with models missing.
 */
export async function savePriceList(
  input: {
    brand: string;
    name: string;
    fileName: string;
    rows: ParsedPriceRow[];
    priceColumns: PriceKey[];
    sheets: string[];
    skippedSheets: string[];
  },
  onProgress?: (saved: number, total: number) => void,
): Promise<PriceList> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: list, error } = await db.from("price_lists").insert({
    brand: input.brand.trim(),
    name: input.name.trim(),
    file_name: input.fileName,
    row_count: input.rows.length,
    price_columns: input.priceColumns,
    sheets: input.sheets,
    skipped_sheets: input.skippedSheets,
    created_by: user?.id ?? null,
  }).select().single();
  if (error) throw error;

  const batch = 500;
  try {
    for (let i = 0; i < input.rows.length; i += batch) {
      const chunk = input.rows.slice(i, i + batch).map((r, j) => ({
        price_list_id: list.id,
        model: r.model,
        description: r.description,
        category: r.category,
        sdp: r.sdp,
        prices: r.prices ?? {},
        warranty: r.warranty || null,
        tags: r.tags ?? [],
        specs: r.specs ?? {},
        search_text: buildSearchText(r.model, r.category, r.description, r.keywords, { ...r.specs }),
        sort_order: i + j,
      }));
      const { error: e } = await db.from("price_list_items").insert(chunk);
      if (e) throw e;
      onProgress?.(Math.min(i + batch, input.rows.length), input.rows.length);
    }
  } catch (e) {
    await db.from("price_lists").delete().eq("id", list.id);
    throw e;
  }
  await logActivity("uploaded_price_list", "price_list", list.id, { name: list.name, brand: list.brand, models: input.rows.length });
  return list as PriceList;
}

export const setPriceListActive = async (id: string, isActive: boolean) => {
  const { error } = await db.from("price_lists").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
};

export const deletePriceList = async (list: PriceList) => {
  const { error } = await db.from("price_lists").delete().eq("id", list.id);
  if (error) throw error;
  await logActivity("deleted_price_list", "price_list", list.id, { name: list.name, brand: list.brand });
};

export interface PriceListFacets {
  categories: string[];
  /** The values each spec filter can offer, from this list's models. */
  mp: string[];
  shape: string[];
  place: string[];
}

/** Every category in a list, and the MP / shape / indoor-outdoor values its models have. */
export const getPriceListFacets = async (priceListId: string): Promise<PriceListFacets> => {
  const rows = await fetchAllRows<{ category: string; specs: Specs | null; id: string }>(() =>
    db.from("price_list_items").select("category, specs, id").eq("price_list_id", priceListId).order("sort_order").order("id"),
  );
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    categories: uniq(rows.map((r) => r.category)),
    mp: uniq(rows.map((r) => r.specs?.mp)).sort((a, b) => parseFloat(a) - parseFloat(b)),
    shape: uniq(rows.map((r) => r.specs?.shape)).sort(),
    place: uniq(rows.map((r) => r.specs?.place)).sort(),
  };
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Finds models in the database, never in the browser: a list can be bigger
 * than the 1,000 rows one request returns. Each word of the search must match
 * the model's search text (see price-list-search.ts for how "8ch DVR" or
 * "2mp indoor analog" are read). The best few hundred matches come back and
 * are put in order here, the obvious answer first.
 */
export async function searchPriceList(opts: {
  priceListIds: string[];
  query: string;
  category?: string | null;
  /** Only these categories (a type's categories); an empty list finds nothing. */
  categories?: string[] | null;
  /** Spec filters: { mp: "2MP", shape: "Dome", place: "Indoor" }. */
  specs?: Partial<Record<"mp" | "shape" | "place", string>>;
  limit?: number;
  /**
   * Every match, not just the best few: needed to sort by price, or the
   * cheapest model could sit outside the ones fetched.
   */
  all?: boolean;
}): Promise<PriceListItem[]> {
  if (opts.priceListIds.length === 0) return [];
  if (opts.categories && opts.categories.length === 0) return [];
  const limit = opts.limit ?? 50;
  const terms = parseSearchQuery(opts.query);
  const build = () => {
    let q = db.from("price_list_items")
      .select("id, price_list_id, model, description, category, sdp, prices, warranty, tags, specs")
      .in("price_list_id", opts.priceListIds);
    if (opts.category) q = q.eq("category", opts.category);
    if (opts.categories) q = q.in("category", opts.categories);
    for (const [k, v] of Object.entries(opts.specs ?? {})) if (v) q = q.eq(`specs->>${k}`, v);
    for (const t of terms) q = q.filter("search_text", "imatch", termToPattern(t));
    return q.order("sort_order").order("id");
  };
  const tidy = (data: unknown[]) =>
    (data as PriceListItem[]).map((r) => ({ ...r, sdp: Number(r.sdp), prices: r.prices ?? {}, tags: r.tags ?? [], specs: r.specs ?? {} }));
  if (opts.all) return rankMatches(keepRightKind(tidy(await fetchAllRows<PriceListItem>(build)), terms), terms);
  // With words to rank by, fetch more than are shown so the best ones are in.
  const { data, error } = await build().limit(terms.length > 0 ? 300 : limit);
  if (error) throw error;
  return rankMatches(keepRightKind(tidy(data || []), terms), terms).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Category types ("Analog camera", "IP camera", "DVR"…)
// ---------------------------------------------------------------------------

export interface CategoryType {
  id: string;
  brand: string;
  category: string;
  type: string;
}

/** The types offered before any are made; your own are added to these. */
export const STARTER_TYPES = ["Analog camera", "IP camera", "DVR", "NVR", "Kit", "Network switch", "Cable", "Accessory"];

export const getCategoryTypes = async (): Promise<CategoryType[]> =>
  fetchAllRows<CategoryType>(() => db.from("price_category_types").select("*").order("id"));

/** Gives categories a type, or clears it when type is null. A category in another type moves. */
export async function setCategoryTypes(brand: string, categories: string[], type: string | null): Promise<void> {
  if (categories.length === 0) return;
  const b = brand.trim();
  const keys = new Set(categories.map((c) => c.trim().toLowerCase()));
  const existing = await getCategoryTypes();
  const toRemove = existing
    .filter((t) => t.brand.trim().toLowerCase() === b.toLowerCase() && keys.has(t.category.trim().toLowerCase()))
    .map((t) => t.id);
  if (toRemove.length > 0) {
    const { error } = await db.from("price_category_types").delete().in("id", toRemove);
    if (error) throw error;
  }
  const clean = type?.trim();
  if (!clean) return;
  const { error } = await db.from("price_category_types").insert(categories.map((c) => ({ brand: b, category: c.trim(), type: clean })));
  if (error) throw error;
  await logActivity("set_price_category_type", "price_list", undefined, { brand: b, type: clean, categories });
}

// ---------------------------------------------------------------------------
// A customer's last price for a model
// ---------------------------------------------------------------------------

/**
 * The last price a customer paid or was quoted for a model, or null.
 *
 * Looked for in two places. Inventory sales of the same model: items named
 * like "HIK Colorvu 2mp outdoor no audio DS-2CE10DF3T-PF", matched on the
 * model as a whole word so "…-PF" is not "…-PFS", through the customer's
 * price history. And price-list lines on their quotations and invoices,
 * found by name: the model alone, or "model - description" as the picker
 * writes it. Cancelled invoices don't count. The most recent wins.
 */
export async function getLastPriceForModel(customerId: string, model: string): Promise<{ price: number; date: string; from: "invoice" | "quotation" | "sale" } | null> {
  const prefix = model.replace(/[%_\\]/g, (c) => `\\${c}`);
  const matches = (name: string | null) => {
    const n = (name ?? "").trim().toLowerCase();
    const m = model.trim().toLowerCase();
    return n === m || n.startsWith(`${m} - `);
  };
  const wholeWord = (text: string | null) =>
    (text ?? "").toLowerCase().split(/\s+/).includes(model.trim().toLowerCase());
  const [inv, quo, items] = await Promise.all([
    db.from("invoice_items")
      .select("unit_price, item_name, invoices!inner(customer_id, invoice_date, status, created_at)")
      .eq("invoices.customer_id", customerId)
      .neq("invoices.status", "cancelled")
      .ilike("item_name", `${prefix}%`)
      .limit(200),
    db.from("quotation_items")
      .select("unit_price, item_name, quotations!inner(customer_id, quotation_date, created_at)")
      .eq("quotations.customer_id", customerId)
      .ilike("item_name", `${prefix}%`)
      .limit(200),
    db.from("items").select("id, name, sku").or(`name.ilike.%${prefix}%,sku.ilike.%${prefix}%`).limit(50),
  ]);
  if (inv.error) throw inv.error;
  if (quo.error) throw quo.error;
  if (items.error) throw items.error;
  const itemIds = ((items.data ?? []) as { id: string; name: string | null; sku: string | null }[])
    .filter((i) => wholeWord(i.name) || wholeWord(i.sku))
    .map((i) => i.id);
  let sales: { unit_price: number; sold_at: string; created_at: string | null }[] = [];
  if (itemIds.length > 0) {
    const { data, error } = await db.from("customer_price_history")
      .select("unit_price, sold_at, created_at")
      .eq("customer_id", customerId)
      .in("item_id", itemIds)
      .order("sold_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    sales = data ?? [];
  }
  type Line = { unit_price: number; item_name: string | null };
  type InvLine = Line & { invoices: { invoice_date: string | null; created_at: string | null } | null };
  type QuoLine = Line & { quotations: { quotation_date: string | null; created_at: string | null } | null };
  type Hit = { price: number; date: string; created: string; from: "invoice" | "quotation" | "sale" };
  const hits: Hit[] = [
    ...((inv.data ?? []) as InvLine[]).filter((r) => matches(r.item_name)).map((r) => ({
      price: Number(r.unit_price), date: r.invoices?.invoice_date ?? "", created: r.invoices?.created_at ?? "", from: "invoice" as const,
    })),
    ...((quo.data ?? []) as QuoLine[]).filter((r) => matches(r.item_name)).map((r) => ({
      price: Number(r.unit_price), date: r.quotations?.quotation_date ?? "", created: r.quotations?.created_at ?? "", from: "quotation" as const,
    })),
    ...sales.map((r) => ({ price: Number(r.unit_price), date: (r.sold_at ?? "").slice(0, 10), created: r.created_at ?? "", from: "sale" as const })),
  ].filter((h) => h.price > 0);
  if (hits.length === 0) return null;
  hits.sort((a, b) => (a.date === b.date ? (a.created < b.created ? 1 : -1) : a.date < b.date ? 1 : -1));
  const { price, date, from } = hits[0];
  return { price, date, from };
}
