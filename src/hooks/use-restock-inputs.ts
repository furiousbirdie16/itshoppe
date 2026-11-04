import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format, parseISO, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { HISTORY_DAYS } from "@/lib/restock";
import type { PoRow } from "@/hooks/use-insights-purchases";

const INCLUDE_KEY = "restock_included_orders";

function loadIncluded(): Set<string> {
  try {
    const raw = localStorage.getItem(INCLUDE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Storage blocked or corrupt — every big order is left out, the default.
  }
  return new Set();
}

type Event = { daysAgo: number; units: number };

/**
 * What itemDemand needs besides sales, shared by the Reorder List and the
 * Forecast tab: PO receipts and manual stock corrections per item over the
 * history window (to rebuild each day's stock), and which one-off big orders
 * the user chose to count anyway.
 *
 * The include choices live in this browser only — they tune a suggestion,
 * nothing else reads them.
 */
export function useRestockInputs(orders: PoRow[], today: Date, branchId: string | null = null) {
  const since = format(subDays(today, HISTORY_DAYS + 1), "yyyy-MM-dd");

  // Manual corrections, and for one branch its transfers too: across the
  // whole business transfers between branches cancel out, but a branch's
  // stock rises and falls with them. Sales and receipts come from their own
  // records.
  const { data: adjustmentRows = [] } = useQuery({
    queryKey: ["restock_adjustments", since, branchId],
    queryFn: async () =>
      fetchAllRows<any>(() => {
        let q = supabase
          .from("inventory_movements")
          .select("id, item_id, variation_id, type, quantity, reference_type, created_at")
          .in("type", branchId
            ? ["adjust_surplus", "adjust_missing", "transfer_b2b_in", "transfer_b2b_out"]
            : ["adjust_surplus", "adjust_missing"])
          .gte("created_at", since)
          .order("id", { ascending: true });
        if (branchId) q = q.eq("branch_id", branchId);
        return q;
      }),
  });

  const adjustmentsByItem = useMemo(() => {
    const m = new Map<string, Event[]>();
    for (const r of adjustmentRows) {
      // Open-roll corrections change the cut roll (in metres), not the stock count.
      if (!r.item_id || r.variation_id || !r.created_at || r.reference_type === "open_roll_adjustment") continue;
      const out = r.type === "adjust_missing" || r.type === "transfer_b2b_out";
      const units = Number(r.quantity || 0) * (out ? -1 : 1);
      const arr = m.get(r.item_id) || [];
      arr.push({ daysAgo: differenceInCalendarDays(today, parseISO(r.created_at)), units });
      m.set(r.item_id, arr);
    }
    return m;
  }, [adjustmentRows, today]);

  const receiptsByItem = useMemo(() => {
    const m = new Map<string, Event[]>();
    for (const po of orders) {
      for (const l of po.lines) {
        if (!l.itemId || !l.receivedDate || l.received <= 0) continue;
        const daysAgo = differenceInCalendarDays(today, parseISO(l.receivedDate));
        if (daysAgo < 0 || daysAgo > HISTORY_DAYS + 1) continue;
        const arr = m.get(l.itemId) || [];
        arr.push({ daysAgo, units: l.received });
        m.set(l.itemId, arr);
      }
    }
    return m;
  }, [orders, today]);

  const [includeIds, setIncludeIds] = useState<Set<string>>(loadIncluded);
  const toggleInclude = useCallback((id: string) => {
    setIncludeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(INCLUDE_KEY, JSON.stringify(Array.from(next))); } catch { /* per-browser nicety only */ }
      return next;
    });
  }, []);

  return { adjustmentsByItem, receiptsByItem, includeIds, toggleInclude };
}
