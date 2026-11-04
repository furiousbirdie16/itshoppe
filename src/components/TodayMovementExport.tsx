import { useState } from "react";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import { format, startOfDay } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/paginate";
import { useBranch } from "@/contexts/BranchContext";
import { buildTodayRows, type MovementLike } from "@/lib/today-movement";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * One click: a sheet of every product whose stock moved today, for the
 * branch being viewed (or each branch, on "All branches") — what sold, what
 * is left, and a blank column to fill in by hand.
 */
export function TodayMovementExport() {
  const { activeBranchId, activeBranch, branches } = useBranch();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const since = startOfDay(new Date()).toISOString();
      const movements = await fetchAllRows<MovementLike & { id: string }>(() => {
        let q = db
          .from("inventory_movements")
          .select("id, item_id, branch_id, type, quantity, unit, reference_type")
          .gte("created_at", since)
          .order("id");
        if (activeBranchId) q = q.eq("branch_id", activeBranchId);
        return q;
      });
      const itemIds = [...new Set(movements.map((m) => m.item_id).filter(Boolean) as string[])];
      if (itemIds.length === 0) {
        toast.info("No stock has moved today" + (activeBranch ? ` at ${activeBranch.branch_name}` : ""));
        return;
      }

      const names = new Map<string, { name: string; unit: string }>();
      const stock = new Map<string, { qty: number; open: number }>();
      for (let i = 0; i < itemIds.length; i += 150) {
        const chunk = itemIds.slice(i, i + 150);
        const [{ data: items }, { data: rows }] = await Promise.all([
          db.from("items").select("id, name, base_unit").in("id", chunk),
          (() => {
            let q = db.from("item_branch_stock").select("item_id, branch_id, quantity, open_roll_remaining").in("item_id", chunk);
            if (activeBranchId) q = q.eq("branch_id", activeBranchId);
            return q;
          })(),
        ]);
        for (const it of items || []) names.set(it.id, { name: it.name, unit: it.base_unit || "m" });
        for (const r of rows || []) stock.set(`${r.branch_id}|${r.item_id}`, { qty: Number(r.quantity || 0), open: Number(r.open_roll_remaining || 0) });
      }

      const code = new Map(branches.map((b) => [b.id, b.branch_code]));
      const rows = buildTodayRows(movements, {
        itemName: (id) => names.get(id)?.name || "(deleted item)",
        branchCode: (id) => (id ? code.get(id) || "?" : "—"),
        left: (id, b) => {
          const s = stock.get(`${b}|${id}`);
          if (!s) return 0;
          return s.open > 0 ? `${s.qty} + ${s.open}${names.get(id)?.unit || "m"} open` : s.qty;
        },
      });

      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [{ wch: 8 }, { wch: 44 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Today");
      const day = format(new Date(), "yyyy-MM-dd");
      XLSX.writeFile(wb, `Movement ${day} ${activeBranch?.branch_code || "All branches"}.xlsx`);
      toast.success(`${rows.length} product${rows.length === 1 ? "" : "s"} exported`);
    } catch (e: any) {
      toast.error(e?.message || "Could not export");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 shrink-0 px-3 text-xs"
      onClick={run}
      disabled={busy}
      title={`Products that moved today${activeBranch ? ` at ${activeBranch.branch_name}` : ", every branch"}`}
    >
      <Download className="h-4 w-4 md:mr-1.5" />
      <span className="hidden md:inline">{busy ? "Exporting…" : "Today's movement"}</span>
    </Button>
  );
}
