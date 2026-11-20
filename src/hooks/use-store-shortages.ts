import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";

/**
 * Products whose store count has gone below zero.
 *
 * A sale always takes from the store. When the store had fewer than were
 * sold, the rest physically came from the warehouse (or turned up in the
 * store), and until someone records which, the store reads negative. These
 * are the rows waiting for that: a transfer, or "found in store".
 *
 * One row per branch: a transfer is always within one branch.
 */
export interface StoreShortage {
  itemId: string;
  branchId: string;
  name: string;
  sku: string;
  baseUnit: string;
  store: number;
  warehouse: number;
}

export const STORE_SHORTAGES_KEY = ["item_branch_stock", "store-shortages"] as const;

export function useStoreShortages() {
  const { activeBranchId } = useBranch();
  return useQuery({
    // Under item_branch_stock, so anything that changes stock refreshes it.
    queryKey: [...STORE_SHORTAGES_KEY, activeBranchId ?? "all"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<StoreShortage[]> => {
      let q = (supabase as any)
        .from("item_branch_stock")
        .select("item_id, branch_id, store_quantity, warehouse_quantity, items!inner(name, sku, base_unit, status)")
        .lt("store_quantity", 0);
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      return ((data || []) as any[])
        // Filtered here: a filter on the joined status would drop items with none.
        .filter((r) => r.items?.status !== "archived")
        .map((r) => ({
          itemId: r.item_id,
          branchId: r.branch_id,
          name: r.items?.name ?? "",
          sku: r.items?.sku ?? "",
          baseUnit: r.items?.base_unit || "pcs",
          store: Number(r.store_quantity || 0),
          warehouse: Number(r.warehouse_quantity || 0),
        }))
        // Most short first, so the urgent ones lead whatever their name.
        .sort((a, b) => a.store - b.store || a.name.localeCompare(b.name));
    },
  });
}
