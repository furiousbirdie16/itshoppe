import { supabase } from "@/integrations/supabase/client";
import type { CargoBox } from "./landed-cost";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface PoCargo {
  po_id: string;
  cargo_amount: number;
  other_charges: number;
  line_cbm: Record<string, number>;
  boxes: CargoBox[];
  notes: string;
  applied_at: string | null;
  applied_by_email: string | null;
}

export async function getPoCargo(poId: string): Promise<PoCargo | null> {
  const { data, error } = await db.from("overseas_po_cargo").select("*").eq("po_id", poId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...data,
    cargo_amount: Number(data.cargo_amount || 0),
    other_charges: Number(data.other_charges || 0),
    line_cbm: data.line_cbm || {},
    boxes: Array.isArray(data.boxes) ? data.boxes : [],
  };
}

export async function savePoCargo(poId: string, cargo: Omit<PoCargo, "po_id" | "applied_at" | "applied_by_email">) {
  const { data: { session } } = await supabase.auth.getSession();
  const { error } = await db.from("overseas_po_cargo").upsert({
    po_id: poId,
    cargo_amount: cargo.cargo_amount,
    other_charges: cargo.other_charges,
    line_cbm: cargo.line_cbm,
    boxes: cargo.boxes,
    notes: cargo.notes,
    updated_at: new Date().toISOString(),
    updated_by_email: session?.user?.email ?? null,
  });
  if (error) throw error;
}

export interface LandedCostRow {
  item_id: string;
  new_cost: number;
  landed_cost: number;
  rmb_cost?: number | null;
  cbm_per_unit?: number | null;
}

/** Apply reviewed costs; admin only, all or nothing. Returns how many items changed. */
export async function applyLandedCosts(poId: string, rows: LandedCostRow[]): Promise<number> {
  const { data, error } = await db.rpc("apply_landed_costs", { _po_id: poId, _rows: rows });
  if (error) throw error;
  return Number(data || 0);
}

/** Every branch's stock of each item, added up. */
export async function getTotalStock(itemIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < itemIds.length; i += 150) {
    const { data, error } = await db
      .from("item_branch_stock")
      .select("item_id, quantity")
      .in("item_id", itemIds.slice(i, i + 150));
    if (error) throw error;
    for (const r of data || []) out[r.item_id] = (out[r.item_id] || 0) + Number(r.quantity || 0);
  }
  return out;
}

/** The margin below which admins are warned, as a percentage. 20 until set. */
export async function getMarginTarget(): Promise<number> {
  const { data } = await db.from("app_settings").select("value").eq("key", "margin_target").maybeSingle();
  const pct = Number(data?.value?.percent);
  return Number.isFinite(pct) && pct >= 0 ? pct : 20;
}

export async function setMarginTarget(percent: number) {
  const { error } = await db.from("app_settings").upsert({
    key: "margin_target",
    value: { percent },
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
