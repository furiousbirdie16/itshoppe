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
  /** Non-item PO lines not to spread over the items. */
  excluded_lines: string[];
  /** Non-item lines that apply to some items only: fee line id → item line ids. */
  fee_targets: Record<string, string[]>;
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
    excluded_lines: Array.isArray(data.excluded_lines) ? data.excluded_lines : [],
    fee_targets: data.fee_targets && typeof data.fee_targets === "object" ? data.fee_targets : {},
  };
}

export async function savePoCargo(
  poId: string,
  cargo: Omit<PoCargo, "po_id" | "applied_at" | "applied_by_email">,
  /** True when the saved row had exclusions, so an empty list must be written to clear them. */
  hadExclusions = false,
  /** The same, for fee targets. */
  hadTargets = false,
) {
  const { data: { session } } = await supabase.auth.getSession();
  const { error } = await db.from("overseas_po_cargo").upsert({
    po_id: poId,
    cargo_amount: cargo.cargo_amount,
    other_charges: cargo.other_charges,
    line_cbm: cargo.line_cbm,
    boxes: cargo.boxes,
    // Only sent when there is something to say, so saving still works on a
    // database without the column.
    ...(cargo.excluded_lines.length || hadExclusions ? { excluded_lines: cargo.excluded_lines } : {}),
    ...(Object.keys(cargo.fee_targets).length || hadTargets ? { fee_targets: cargo.fee_targets } : {}),
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

/**
 * Stock and cost of each item: at one branch (the one a shipment is for), or
 * every branch added up with the company cost when no branch is given.
 */
export async function getStockAndCost(itemIds: string[], branchId: string | null): Promise<Record<string, { qty: number; cost: number | null }>> {
  const out: Record<string, { qty: number; cost: number | null }> = {};
  for (let i = 0; i < itemIds.length; i += 150) {
    let q = db
      .from("item_branch_stock")
      .select("item_id, quantity, cost_price")
      .in("item_id", itemIds.slice(i, i + 150));
    if (branchId) q = q.eq("branch_id", branchId);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data || []) {
      const cur = out[r.item_id] || { qty: 0, cost: null };
      cur.qty += Number(r.quantity || 0);
      // One branch: its own cost. All: left to the company figure.
      if (branchId && r.cost_price != null) cur.cost = Number(r.cost_price);
      out[r.item_id] = cur;
    }
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

/** Payable categories counted only when due (see lib/payable-timing). "Rent" until set. */
export async function getDeferredPayableCategories(): Promise<string[]> {
  const { data } = await db.from("app_settings").select("value").eq("key", "deferred_payable_categories").maybeSingle();
  const list = data?.value?.categories;
  return Array.isArray(list) ? list.map(String) : ["Rent"];
}

export async function setDeferredPayableCategories(categories: string[]) {
  const { error } = await db.from("app_settings").upsert({
    key: "deferred_payable_categories",
    value: { categories },
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
