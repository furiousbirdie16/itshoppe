import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowLeftRight, Check, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { fetchAllRows } from "@/lib/paginate";
import { searchMatches } from "@/lib/search";
import { transferWithinBranch } from "@/lib/stock-transfer";
import type { Item } from "@/types/database";

/**
 * Warehouse → store for many products at once.
 *
 * Opened two ways, to see which staff use more: with products already ticked
 * in Inventory (straight to quantities), or from the Transfer button (pick
 * products first). Either way: quantities, then Approve.
 */

type Step = "pick" | "qty";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every product, to pick from. */
  items: Item[];
  /** Products ticked before opening; opens on quantities when there are any. */
  initialIds?: string[];
  /** Called once something was moved, e.g. to clear the page's selection. */
  onDone?: () => void;
}

export function BatchTransferDialog({ open, onOpenChange, items, initialIds = [], onDone }: Props) {
  const qc = useQueryClient();
  const { activeBranchId, branches } = useBranch();
  const [pickedBranchId, setPickedBranchId] = useState("");
  const branchId = activeBranchId || pickedBranchId;
  const [step, setStep] = useState<Step>("pick");
  const [chosen, setChosen] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setPickedBranchId("");
    setChosen(initialIds);
    setQty({});
    setSearch("");
    setFailed({});
    setStep(initialIds.length > 0 ? "qty" : "pick");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** This branch's own warehouse and store figures for every product. */
  const { data: stock = new Map<string, { wh: number; st: number }>(), isLoading: stockLoading } = useQuery({
    queryKey: ["item_branch_stock", "batch-transfer", branchId],
    enabled: open && !!branchId,
    queryFn: async () => {
      const rows = await fetchAllRows<any>(() =>
        (supabase as any)
          .from("item_branch_stock")
          .select("item_id, warehouse_quantity, store_quantity")
          .eq("branch_id", branchId)
          .order("item_id"),
      );
      return new Map(rows.map((r) => [r.item_id as string, { wh: Number(r.warehouse_quantity || 0), st: Number(r.store_quantity || 0) }]));
    },
  });
  const stockOf = (id: string) => stock.get(id) ?? { wh: 0, st: 0 };

  // What the store is short, ready to approve; anything else waits for a number.
  useEffect(() => {
    if (!open || stock.size === 0) return;
    setQty((q) => {
      const next = { ...q };
      for (const id of chosen) {
        if (next[id] !== undefined) continue;
        const { wh, st } = stockOf(id);
        next[id] = st < 0 && wh > 0 ? String(Math.min(-st, wh)) : "";
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stock, chosen]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const pickList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => (i.status ?? "active") !== "archived")
      .filter((i) => !q || searchMatches(q, i.name, i.sku, (i as any).barcode, (i as any).brand))
      // Only what the warehouse has, unless already chosen.
      .filter((i) => chosen.includes(i.id) || stockOf(i.id).wh > 0)
      .slice(0, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search, stock, chosen]);

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const lines = chosen.map((id) => {
    const { wh, st } = stockOf(id);
    const text = qty[id] ?? "";
    const n = text === "" ? 0 : Number(text);
    const error =
      text === "" ? null
      : !Number.isInteger(n) || n < 0 ? "Whole number"
      : n > wh ? `Only ${wh} in warehouse`
      : null;
    return { id, item: byId.get(id), wh, st, n, error };
  });
  const toMove = lines.filter((l) => l.n > 0 && !l.error);
  const hasErrors = lines.some((l) => l.error);
  const totalPcs = toMove.reduce((s, l) => s + l.n, 0);

  const approve = async () => {
    if (!branchId || toMove.length === 0 || hasErrors) return;
    setSaving(true);
    const bad: Record<string, string> = {};
    let ok = 0;
    // One after another: each checks the warehouse as it stands right then.
    for (const l of toMove) {
      try {
        await transferWithinBranch({
          itemId: l.id, branchId, direction: "w2s", qty: l.n,
          unit: l.item?.base_unit, notes: "Warehouse → Store (batch)",
        });
        ok += 1;
      } catch (e: any) {
        bad[l.id] = e?.message || "Failed";
      }
    }
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["items"] });
    qc.invalidateQueries({ queryKey: ["item_branch_stock"] });
    if (ok > 0) onDone?.();
    if (Object.keys(bad).length === 0) {
      toast.success(`Transferred ${ok} product${ok === 1 ? "" : "s"} to the store`);
      onOpenChange(false);
    } else {
      // Keep only what failed, with why, so it can be fixed and approved again.
      toast.error(`${Object.keys(bad).length} could not be transferred${ok ? `; ${ok} done` : ""}`);
      setFailed(bad);
      setChosen(Object.keys(bad));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ArrowLeftRight className="h-4 w-4" /> Transfer to store
          </DialogTitle>
          <DialogDescription className="text-xs">
            {step === "pick" ? "Step 1 of 2 · tick the products to bring from the warehouse" : "Step 2 of 2 · how many of each, then approve"}
          </DialogDescription>
        </DialogHeader>

        {!activeBranchId && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Branch</Label>
            <Select value={pickedBranchId} onValueChange={(v) => { setPickedBranchId(v); setQty({}); }}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Whose warehouse and store?" /></SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.branch_name} ({b.branch_code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!branchId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Choose a branch first.</p>
        ) : step === "pick" ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, SKU, barcode…" className="h-9 pl-9" autoFocus />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border divide-y">
              {stockLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading stock…</p>
              ) : pickList.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Nothing in the warehouse matches.</p>
              ) : pickList.map((i) => {
                const { wh, st } = stockOf(i.id);
                const on = chosen.includes(i.id);
                return (
                  <label key={i.id} className={`flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40 ${on ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}>
                    <Checkbox checked={on} onCheckedChange={() => toggle(i.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{i.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{i.sku}</div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                      <div>Warehouse <span className="font-medium text-foreground">{wh}</span></div>
                      <div>Store <span className={`font-medium ${st < 0 ? "text-destructive" : "text-foreground"}`}>{st}</span></div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{chosen.length} selected</span>
              <Button className="bg-blue-600 text-white hover:bg-blue-700" disabled={chosen.length === 0} onClick={() => setStep("qty")}>
                Next: quantities
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
              <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_88px_28px] items-center gap-2 border-b px-3 py-1.5 text-[11px] text-muted-foreground">
                <span>Product</span>
                <span className="text-right">Warehouse</span>
                <span className="text-right">Store</span>
                <span className="text-right">Move</span>
                <span />
              </div>
              {stockLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading stock…</p>
              ) : lines.map((l) => (
                <div key={l.id} className="border-b px-3 py-2 last:border-b-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_88px_28px] items-center gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{l.item?.name ?? "—"}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{l.item?.sku}</div>
                    </div>
                    <span className="text-right text-sm tabular-nums">{l.wh}</span>
                    <span className={`text-right text-sm tabular-nums ${l.st < 0 ? "font-semibold text-destructive" : ""}`}>{l.st}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={l.wh}
                      value={qty[l.id] ?? ""}
                      onChange={(e) => { setQty((q) => ({ ...q, [l.id]: e.target.value })); setFailed((f) => { const n = { ...f }; delete n[l.id]; return n; }); }}
                      className={`h-8 text-right tabular-nums ${l.error ? "border-destructive" : ""}`}
                      placeholder="0"
                      aria-label={`Quantity of ${l.item?.name ?? "product"}`}
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Remove" onClick={() => toggle(l.id)}>
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                  {(l.error || failed[l.id]) && (
                    <p className="mt-1 text-right text-[11px] text-destructive">{l.error || failed[l.id]}</p>
                  )}
                  {!l.error && l.n > 0 && (
                    <p className="mt-0.5 text-right text-[11px] text-muted-foreground">
                      Store {l.st} → {l.st + l.n} · warehouse {l.wh} → {l.wh - l.n}
                    </p>
                  )}
                </div>
              ))}
              {lines.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No products selected.</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("pick")} disabled={saving}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Add or remove products
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {toMove.length} product{toMove.length === 1 ? "" : "s"} · {totalPcs} pcs
                </span>
                <Button
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  disabled={saving || toMove.length === 0 || hasErrors}
                  onClick={approve}
                >
                  <Check className="mr-1.5 h-4 w-4" /> {saving ? "Transferring…" : "Approve transfer"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default BatchTransferDialog;
