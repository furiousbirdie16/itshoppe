import { supabase } from "@/integrations/supabase/client";

export interface ItemSupplierRow {
  id: string;
  item_id: string;
  supplier_id: string | null;
  overseas_supplier_id: string | null;
  supplier_sku: string;
  currency: string; // 'PHP' | 'USD' | 'RMB'
  latest_cost: number;
  moq: number;
  lead_time_days: number | null;
  last_purchased_at: string | null;
  is_primary: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
  supplier_name?: string | null;
  is_overseas?: boolean;
}

async function enrich(rows: any[]): Promise<ItemSupplierRow[]> {
  if (!rows.length) return [];
  const localIds = Array.from(new Set(rows.map(r => r.supplier_id).filter(Boolean)));
  const overseasIds = Array.from(new Set(rows.map(r => r.overseas_supplier_id).filter(Boolean)));
  const [locals, overseas] = await Promise.all([
    localIds.length ? supabase.from("suppliers").select("id,name").in("id", localIds) : Promise.resolve({ data: [] as any[] }),
    overseasIds.length ? supabase.from("overseas_suppliers").select("id,name,currency").in("id", overseasIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const ln = new Map((locals.data || []).map((s: any) => [s.id, s.name]));
  const on = new Map((overseas.data || []).map((s: any) => [s.id, s]));
  return rows.map(r => ({
    ...r,
    supplier_name: r.supplier_id ? ln.get(r.supplier_id) ?? null : on.get(r.overseas_supplier_id)?.name ?? null,
    is_overseas: !!r.overseas_supplier_id,
  }));
}

export async function listItemSuppliers(itemId: string): Promise<ItemSupplierRow[]> {
  const { data, error } = await supabase
    .from("item_suppliers")
    .select("*")
    .eq("item_id", itemId)
    .order("is_primary", { ascending: false })
    .order("last_purchased_at", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return enrich(data || []);
}

export async function listItemSuppliersForItems(itemIds: string[]): Promise<Map<string, ItemSupplierRow>> {
  const result = new Map<string, ItemSupplierRow>();
  if (!itemIds.length) return result;
  const { data, error } = await supabase
    .from("item_suppliers")
    .select("*")
    .in("item_id", itemIds);
  if (error) throw error;
  const enriched = await enrich(data || []);
  // Pick preferred per item: primary > most recent last_purchased > most recent created
  const grouped = new Map<string, ItemSupplierRow[]>();
  for (const r of enriched) {
    const arr = grouped.get(r.item_id) || [];
    arr.push(r);
    grouped.set(r.item_id, arr);
  }
  for (const [itemId, arr] of grouped) {
    arr.sort((a, b) => {
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      const ad = a.last_purchased_at ? Date.parse(a.last_purchased_at) : 0;
      const bd = b.last_purchased_at ? Date.parse(b.last_purchased_at) : 0;
      if (ad !== bd) return bd - ad;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
    result.set(itemId, arr[0]);
  }
  return result;
}

export interface UpsertItemSupplierInput {
  id?: string;
  item_id: string;
  supplier_id?: string | null;
  overseas_supplier_id?: string | null;
  supplier_sku?: string;
  currency?: string;
  latest_cost?: number;
  moq?: number;
  lead_time_days?: number | null;
  is_primary?: boolean;
  notes?: string;
}

export async function upsertItemSupplier(input: UpsertItemSupplierInput) {
  const { data: { user } } = await supabase.auth.getUser();
  const payload: any = {
    item_id: input.item_id,
    supplier_id: input.supplier_id ?? null,
    overseas_supplier_id: input.overseas_supplier_id ?? null,
    supplier_sku: input.supplier_sku ?? "",
    currency: input.currency ?? "PHP",
    latest_cost: input.latest_cost ?? 0,
    moq: input.moq ?? 1,
    lead_time_days: input.lead_time_days ?? null,
    is_primary: input.is_primary ?? false,
    notes: input.notes ?? "",
    created_by_email: user?.email ?? null,
  };
  if (input.id) {
    const { error } = await supabase.from("item_suppliers").update(payload).eq("id", input.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("item_suppliers").insert(payload);
    if (error) throw error;
  }
}

export async function setPrimarySupplier(rowId: string) {
  const { error } = await supabase.from("item_suppliers").update({ is_primary: true }).eq("id", rowId);
  if (error) throw error;
}

export async function deleteItemSupplier(rowId: string) {
  const { error } = await supabase.from("item_suppliers").delete().eq("id", rowId);
  if (error) throw error;
}
