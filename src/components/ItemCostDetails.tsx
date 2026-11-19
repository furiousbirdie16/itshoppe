import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { updateItem } from "@/lib/api";
import { peso } from "@/lib/currency";
import type { Item } from "@/types/database";

/**
 * What a product cost to bring in, shown under its row in Inventory:
 * RMB cost, peso cost, the rate, cargo per piece, its size and how many come
 * in a box. Applying a shipment's cargo costs fills most of it; an admin can
 * also type it in.
 */

type FieldKey = "rmb" | "php" | "rate" | "cargo" | "cbm" | "box";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fromItem = (item: Item): Record<FieldKey, string> => {
  const s = (v: unknown) => (num(v) === null ? "" : String(num(v)));
  return {
    rmb: num(item.cost_price_rmb) ? s(item.cost_price_rmb) : "",
    php: s(item.cost_price),
    rate: s(item.rmb_rate),
    cargo: s(item.cargo_cost_per_unit),
    cbm: s(item.cbm_per_unit),
    box: s(item.qty_per_box),
  };
};

interface Props {
  item: Item;
  isAdmin: boolean;
  /** Branch the peso cost is for; null sets every branch. */
  branchId: string | null;
  branchLabel: string;
}

export function ItemCostDetails({ item, isAdmin, branchId, branchLabel }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => fromItem(item));

  const rmb = num(item.cost_price_rmb) || null;
  const rate = num(item.rmb_rate);
  const cargo = num(item.cargo_cost_per_unit);
  const cbm = num(item.cbm_per_unit);
  const box = num(item.qty_per_box);
  const landed = rmb !== null && rate !== null ? rmb * rate + (cargo ?? 0) : null;

  const saveMut = useMutation({
    mutationFn: async () => {
      const decimal = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v)));
      for (const [k, v] of Object.entries(form)) {
        if (v.trim() !== "" && !Number.isFinite(Number(v))) throw new Error(`"${v}" is not a number`);
        if (k === "box" && v.trim() !== "" && !Number.isInteger(Number(v))) throw new Error("Quantity per box must be a whole number");
      }
      await updateItem(item.id, {
        cost_price_rmb: decimal(form.rmb) ?? 0,
        rmb_rate: decimal(form.rate),
        cargo_cost_per_unit: decimal(form.cargo),
        cbm_per_unit: decimal(form.cbm),
        qty_per_box: decimal(form.box),
      } as Partial<Item>);
      // The peso cost goes through cost history, like every other cost change.
      const php = decimal(form.php);
      if (php !== null && Math.abs(php - Number(item.cost_price || 0)) >= 0.005) {
        const { error } = await (supabase as any).rpc("set_item_cost", {
          _item_id: item.id,
          _new_cost: php,
          _reason: "Inventory cost details",
          _branch_id: branchId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["item_branch_stock"] });
      setEditing(false);
      toast.success("Cost details saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = () => { setForm(fromItem(item)); setEditing(true); };

  const fields: { key: FieldKey; label: string; show: React.ReactNode; suffix?: string; hint?: string; adminOnly?: boolean }[] = [
    { key: "rmb", label: "RMB cost", show: rmb !== null ? `¥${rmb.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "—", adminOnly: true },
    {
      key: "php", label: "PHP cost", show: peso(Number(item.cost_price || 0)), adminOnly: true,
      hint: editing ? (branchId ? `For ${branchLabel}` : "Sets every branch") : landed !== null ? `Last landed ${peso(landed)}` : undefined,
    },
    { key: "rate", label: "Conversion rate", show: rate !== null ? `₱${rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} per ¥1` : "—", adminOnly: true },
    { key: "cargo", label: "Cargo cost", show: cargo !== null ? `${peso(cargo)} / pc` : "—", adminOnly: true },
    { key: "cbm", label: "Cargo size", show: cbm !== null ? `${cbm.toLocaleString(undefined, { maximumFractionDigits: 6 })} CBM / pc` : "—", suffix: "CBM" },
    { key: "box", label: "Qty per box", show: box !== null ? `${box} pcs` : "—", suffix: "pcs" },
  ];
  const shown = fields.filter((f) => isAdmin || !f.adminOnly);

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 px-2 py-2.5">
      <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {shown.map((f) => (
          <div key={f.key} className="min-w-0">
            <div className="text-[11px] text-muted-foreground">{f.label}</div>
            {editing ? (
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="mt-0.5 h-8 text-sm"
                placeholder={f.suffix ?? "0.00"}
                aria-label={f.label}
              />
            ) : (
              <div className="truncate text-sm font-medium tabular-nums">{f.show}</div>
            )}
            {f.hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{f.hint}</div>}
          </div>
        ))}
      </div>
      {isAdmin && (
        <div className="flex shrink-0 gap-1.5">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditing(false)} disabled={saveMut.isPending}>Cancel</Button>
              <Button size="sm" className="h-8" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" className="h-8" onClick={startEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default ItemCostDetails;
