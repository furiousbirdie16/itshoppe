import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface MovementInput {
  itemId: string;
  variationId?: string | null;
  branchId?: string | null;
  type:
    | "in_po"
    | "out_invoice"
    | "out_online_sale"
    | "transfer_w2s"
    | "transfer_s2w"
    | "adjust_missing"
    | "adjust_surplus"
    | "transfer_b2b_out"
    | "transfer_b2b_in";
  /** Quantity moved, always positive. */
  quantity: number;
  /** Display unit: "pcs", "rolls", "m", "box", etc. */
  unit?: string | null;
  /** Source location for sales/adjustments/transfers, e.g. "warehouse", "store". */
  location?: string | null;
  /** Destination location for transfers. */
  destLocation?: string | null;
  referenceId?: string | null;
  referenceType?: string | null;
  notes?: string | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  openBefore?: number | null;
  openAfter?: number | null;
  destBalanceBefore?: number | null;
  destBalanceAfter?: number | null;
}

/**
 * Insert a fully-audited inventory movement. Auto-attaches the current user's
 * id + email. All balance fields are optional — pass whichever apply.
 * `branchId` MUST match the transaction's branch (not the currently-viewed one).
 */
export async function recordMovement(m: MovementInput) {
  let user_id: string | null = null;
  let user_email: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user_id = data.user?.id ?? null;
    user_email = data.user?.email ?? null;
  } catch {
    /* anon */
  }

  await db.from("inventory_movements").insert({
    item_id: m.itemId,
    variation_id: m.variationId ?? null,
    branch_id: m.branchId ?? null,
    type: m.type,
    quantity: Math.abs(m.quantity),
    unit: m.unit ?? null,
    location: m.location ?? null,
    dest_location: m.destLocation ?? null,
    reference_id: m.referenceId ?? null,
    reference_type: m.referenceType ?? null,
    notes: m.notes ?? "",
    balance_before: m.balanceBefore ?? null,
    balance_after: m.balanceAfter ?? null,
    open_before: m.openBefore ?? null,
    open_after: m.openAfter ?? null,
    dest_balance_before: m.destBalanceBefore ?? null,
    dest_balance_after: m.destBalanceAfter ?? null,
    user_id,
    user_email,
  });
}
