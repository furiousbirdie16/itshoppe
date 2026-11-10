import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { logActivity } from "@/lib/activity-log";
import type { MarkupType, ParsedPriceRow, PriceGroup, PriceGroupCategory, PriceKey, PriceTag } from "@/lib/price-list";
import { buildSearchText, parseSearchQuery, rankMatches, termToPattern } from "@/lib/price-list-search";

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
}

export const PRICE_LISTS_KEY = ["price-lists"] as const;
export const PRICE_GROUPS_KEY = ["price-groups"] as const;
export const PRICE_GROUP_CATEGORIES_KEY = ["price-group-categories"] as const;

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
        search_text: buildSearchText(r.model, r.category, r.description, r.keywords),
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

/** Every sheet name in a list, for the group editor and the category filter. */
export const getPriceListCategories = async (priceListId: string): Promise<string[]> => {
  const rows = await fetchAllRows<{ category: string; id: string }>(() =>
    db.from("price_list_items").select("category, id").eq("price_list_id", priceListId).order("sort_order").order("id"),
  );
  return [...new Set(rows.map((r) => r.category))];
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
  limit?: number;
  /**
   * Every match, not just the best few: needed to sort by price, or the
   * cheapest model could sit outside the ones fetched.
   */
  all?: boolean;
}): Promise<PriceListItem[]> {
  if (opts.priceListIds.length === 0) return [];
  const limit = opts.limit ?? 50;
  const terms = parseSearchQuery(opts.query);
  const build = () => {
    let q = db.from("price_list_items")
      .select("id, price_list_id, model, description, category, sdp, prices, warranty, tags")
      .in("price_list_id", opts.priceListIds);
    if (opts.category) q = q.eq("category", opts.category);
    for (const t of terms) q = q.filter("search_text", "imatch", termToPattern(t));
    return q.order("sort_order").order("id");
  };
  const tidy = (data: unknown[]) =>
    (data as PriceListItem[]).map((r) => ({ ...r, sdp: Number(r.sdp), prices: r.prices ?? {}, tags: r.tags ?? [] }));
  if (opts.all) return rankMatches(tidy(await fetchAllRows<PriceListItem>(build)), terms);
  // With words to rank by, fetch more than are shown so the best ones are in.
  const { data, error } = await build().limit(terms.length > 0 ? 300 : limit);
  if (error) throw error;
  return rankMatches(tidy(data || []), terms).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Price groups
// ---------------------------------------------------------------------------

export const getPriceGroups = async (): Promise<PriceGroup[]> => {
  const { data, error } = await db.from("price_groups").select("*").order("sort_order").order("name");
  if (error) throw error;
  return ((data || []) as PriceGroup[]).map((g) => ({ ...g, markup_value: Number(g.markup_value) }));
};

export const getPriceGroupCategories = async (): Promise<PriceGroupCategory[]> =>
  fetchAllRows<PriceGroupCategory>(() => db.from("price_group_categories").select("*").order("id"));

/** Makes sure a brand has its "Everything else" group, so every model has a price. */
export async function ensureDefaultGroup(brand: string): Promise<void> {
  const { data } = await db.from("price_groups").select("id").ilike("brand", brand.trim()).eq("is_default", true).limit(1);
  if (data && data.length > 0) return;
  const { error } = await db.from("price_groups").insert({
    brand: brand.trim(),
    name: "Everything else",
    markup_type: "percent",
    markup_value: 10,
    is_default: true,
    sort_order: 1000,
  });
  // Someone else made it a moment ago: fine.
  if (error && error.code !== "23505") throw error;
}

export async function savePriceGroup(g: {
  id?: string;
  brand: string;
  name: string;
  markup_type: MarkupType;
  markup_value: number;
  sort_order?: number;
}): Promise<PriceGroup> {
  const row = {
    brand: g.brand.trim(),
    name: g.name.trim(),
    markup_type: g.markup_type,
    markup_value: g.markup_value,
    updated_at: new Date().toISOString(),
    ...(g.sort_order != null ? { sort_order: g.sort_order } : {}),
  };
  if (!row.name) throw new Error("Enter a group name");
  const res = g.id
    ? await db.from("price_groups").update(row).eq("id", g.id).select().single()
    : await db.from("price_groups").insert(row).select().single();
  if (res.error) {
    if (res.error.code === "23505") throw new Error(`There is already a group called "${row.name}"`);
    throw res.error;
  }
  await logActivity(g.id ? "updated_price_group" : "created_price_group", "price_group", res.data.id, {
    brand: row.brand, name: row.name, markup_type: row.markup_type, markup_value: row.markup_value,
  });
  return res.data as PriceGroup;
}

/** Deleting a group sends its sheets back to "Everything else". */
export const deletePriceGroup = async (id: string) => {
  const { error } = await db.from("price_groups").delete().eq("id", id);
  if (error) throw error;
  await logActivity("deleted_price_group", "price_group", id);
};

/**
 * Puts sheets into a group, or back to "Everything else" when groupId is
 * null. A sheet in another group moves.
 */
export async function assignCategories(brand: string, categories: string[], groupId: string | null): Promise<void> {
  if (categories.length === 0) return;
  const b = brand.trim();
  const existing = await getPriceGroupCategories();
  const keys = new Set(categories.map((c) => c.trim().toLowerCase()));
  const toRemove = existing
    .filter((l) => l.brand.trim().toLowerCase() === b.toLowerCase() && keys.has(l.category.trim().toLowerCase()))
    .map((l) => l.id);
  if (toRemove.length > 0) {
    const { error } = await db.from("price_group_categories").delete().in("id", toRemove);
    if (error) throw error;
  }
  if (!groupId) return;
  const { error } = await db.from("price_group_categories").insert(
    categories.map((c) => ({ brand: b, category: c.trim(), group_id: groupId })),
  );
  if (error) throw error;
}
