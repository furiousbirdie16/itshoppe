import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { useBranch } from "@/contexts/BranchContext";

export interface BranchQty {
  code: string;
  qty: number;
}

/**
 * Each item's stock per branch, for showing where a combined figure comes
 * from ("MNL 10 · GSN 10"). Only fetched when there is more than one branch
 * to split across.
 */
export function useStockSplit() {
  const { branches } = useBranch();
  const enabled = branches.length > 1;
  const { data: rows = [] } = useQuery({
    queryKey: ["stock_split", branches.map((b) => b.id).join(",")],
    enabled,
    queryFn: async () =>
      fetchAllRows<any>(() =>
        (supabase as any).from("item_branch_stock").select("id, item_id, branch_id, quantity").order("id"),
      ),
  });
  return useMemo(() => {
    const code = new Map(branches.map((b) => [b.id, b.branch_code]));
    const m = new Map<string, BranchQty[]>();
    for (const r of rows) {
      const c = code.get(r.branch_id);
      if (!c) continue;
      const arr = m.get(r.item_id) || [];
      arr.push({ code: c, qty: Number(r.quantity || 0) });
      m.set(r.item_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.code.localeCompare(b.code));
    return m;
  }, [rows, branches]);
}
