import { supabase } from "@/integrations/supabase/client";
import { recordMovement } from "@/lib/inventoryLog";

/**
 * Move stock between the warehouse and the store of one branch, and record
 * it in the item's history. Used by the single-item transfer and the batch
 * transfer, so both check and record the same way.
 */
export async function transferWithinBranch(p: {
  itemId: string;
  branchId: string;
  direction: "w2s" | "s2w";
  qty: number;
  unit?: string | null;
  notes?: string;
}) {
  const { itemId, branchId, direction, qty } = p;
  if (!branchId) throw new Error("Pick which branch's stock you are moving");
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("Enter a quantity greater than 0");

  const src: "warehouse" | "store" = direction === "w2s" ? "warehouse" : "store";
  const dst: "warehouse" | "store" = direction === "w2s" ? "store" : "warehouse";

  // Checked against the database's figure, not the one on screen, which can
  // be a minute old.
  const { data: cur, error: curErr } = await supabase
    .from("item_branch_stock")
    .select("warehouse_quantity, store_quantity")
    .eq("item_id", itemId)
    .eq("branch_id", branchId)
    .maybeSingle();
  if (curErr) throw curErr;
  const have = Number((src === "warehouse" ? cur?.warehouse_quantity : cur?.store_quantity) ?? 0);
  if (qty > have) throw new Error(`${src === "warehouse" ? "Warehouse" : "Store"} only has ${have}`);

  const rpc = (location: string, delta: number) =>
    (supabase as any).rpc("apply_branch_stock_change", {
      _item_id: itemId, _branch_id: branchId, _location: location,
      _delta_stock: delta, _delta_open: 0, _units_per_stock: null,
    });

  const { data: srcData, error: srcErr } = await rpc(src, -qty);
  if (srcErr) throw srcErr;
  const srcRow: any = Array.isArray(srcData) ? srcData[0] : srcData;

  const { data: dstData, error: dstErr } = await rpc(dst, qty);
  if (dstErr) throw dstErr;
  const dstRow: any = Array.isArray(dstData) ? dstData[0] : dstData;

  await recordMovement({
    itemId,
    branchId,
    type: direction === "w2s" ? "transfer_w2s" : "transfer_s2w",
    quantity: qty,
    unit: p.unit || "pcs",
    location: src,
    destLocation: dst,
    notes: p.notes || (direction === "w2s" ? "Warehouse → Store" : "Store → Warehouse"),
    balanceBefore: src === "warehouse" ? srcRow.wh_before : srcRow.st_before,
    balanceAfter: src === "warehouse" ? srcRow.warehouse_quantity : srcRow.store_quantity,
    destBalanceBefore: dst === "warehouse" ? dstRow.wh_before : dstRow.st_before,
    destBalanceAfter: dst === "warehouse" ? dstRow.warehouse_quantity : dstRow.store_quantity,
  });
}
