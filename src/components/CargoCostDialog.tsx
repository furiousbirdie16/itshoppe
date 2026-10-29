import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOverseasPOItems } from "@/lib/api";
import { applyLandedCosts, getMarginTarget, getPoCargo, getStockAndCost, savePoCargo } from "@/lib/landed-cost-api";
import { allocateCargo, buildCostReview, type CargoBox } from "@/lib/landed-cost";
import { peso } from "@/lib/currency";
import { docNo } from "@/lib/doc-number";
import { cn } from "@/lib/utils";

interface Props {
  po: { id: string; po_number: string; currency: string; exchange_rate: number; branch_id?: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const n = (v: string | number | undefined | null) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const fmtQty = (v: number) => v.toLocaleString("en-PH", { maximumFractionDigits: 3 });
const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * Enter a shipment's cargo bill, split it by CBM, and review the costs it
 * gives before applying them. Admin only — it shows what everything costs.
 */
export function CargoCostDialog({ po, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const poId = po?.id ?? "";

  const { data: lines = [] } = useQuery({
    queryKey: ["overseas_po_items", poId],
    queryFn: () => getOverseasPOItems(poId),
    enabled: open && !!poId,
  });
  const { data: saved, isFetched: cargoLoaded } = useQuery({
    queryKey: ["overseas_po_cargo", poId],
    queryFn: () => getPoCargo(poId),
    enabled: open && !!poId,
  });
  const itemIds = useMemo(() => [...new Set(lines.map((l: any) => l.item_id).filter(Boolean))] as string[], [lines]);
  // The shipment's own branch: its stock is what the new cost averages with,
  // and its cost is the one that changes.
  const poBranch = po?.branch_id ?? null;
  const { data: stock = {} } = useQuery({
    queryKey: ["stock-and-cost", itemIds, poBranch],
    queryFn: () => getStockAndCost(itemIds, poBranch),
    enabled: open && itemIds.length > 0,
  });
  const { data: marginTarget = 20 } = useQuery({ queryKey: ["margin-target"], queryFn: getMarginTarget, enabled: open });

  const [step, setStep] = useState<"cargo" | "review">("cargo");
  const [cargoAmount, setCargoAmount] = useState("");
  const [otherCharges, setOtherCharges] = useState("");
  const [lineCbm, setLineCbm] = useState<Record<string, string>>({});
  const [boxes, setBoxes] = useState<CargoBox[]>([]);
  /**
   * What is typed in each box's CBM field. Kept as text: storing the number
   * straight away turned "0." into 0 and then into an empty field, so a value
   * like .081 could not be typed.
   */
  const [boxCbmText, setBoxCbmText] = useState<Record<string, string>>({});
  /** Non-item lines the admin has said are not a cost of these goods. */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  /** Non-item lines that are a cost of some items only; absent = all items. */
  const [feeTargets, setFeeTargets] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initFor, setInitFor] = useState<string | null>(null);

  // Fill the form once per PO: from what was saved, else from each item's
  // remembered CBM per unit.
  useEffect(() => {
    if (!open) { setInitFor(null); setStep("cargo"); return; }
    if (!poId || !cargoLoaded || lines.length === 0 || initFor === poId) return;
    if (saved) {
      setCargoAmount(saved.cargo_amount ? String(saved.cargo_amount) : "");
      setOtherCharges(saved.other_charges ? String(saved.other_charges) : "");
      setLineCbm(Object.fromEntries(Object.entries(saved.line_cbm).map(([k, v]) => [k, String(v)])));
      setBoxes(saved.boxes);
      setExcluded(new Set(saved.excluded_lines));
      setFeeTargets(saved.fee_targets || {});
    } else {
      const prefill: Record<string, string> = {};
      for (const l of lines as any[]) {
        const per = Number(l.items?.cbm_per_unit || 0);
        if (per > 0) prefill[l.id] = String(Number((per * Number(l.quantity || 0)).toFixed(4)));
      }
      setCargoAmount("");
      setOtherCharges("");
      setLineCbm(prefill);
      setBoxes([]);
      setExcluded(new Set());
      setFeeTargets({});
    }
    setBoxCbmText({});
    setInitFor(poId);
  }, [open, poId, cargoLoaded, saved, lines, initFor]);

  /**
   * Lines that are stock, and lines that are not (a delivery fee, packing).
   * The second kind is what it cost to get the first here, so its value joins
   * the charges and is spread over the items — left as a line of its own it
   * was simply dropped, and never reached any item's cost.
   */
  const itemLines = useMemo(() => (lines as any[]).filter((l) => l.item_id), [lines]);
  const feeLines = useMemo(() => (lines as any[]).filter((l) => !l.item_id), [lines]);
  const feeValue = (l: any) => Number(l.quantity || 0) * Number(l.unit_cost || 0) * Number(po?.exchange_rate || 1);
  /** Lines chosen for a fee that are still on the PO; empty means all items. */
  const targetsOf = (feeId: string) => (feeTargets[feeId] || []).filter((id) => itemLines.some((l) => l.id === id));
  const poFees = useMemo(
    () => feeLines.filter((l) => !excluded.has(l.id) && targetsOf(l.id).length === 0).reduce((s, l) => s + feeValue(l), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feeLines, excluded, feeTargets, itemLines, po?.exchange_rate],
  );
  const targetedCharges = useMemo(
    () => feeLines
      .filter((l) => !excluded.has(l.id) && targetsOf(l.id).length > 0)
      .map((l) => ({ amount: feeValue(l), lineIds: targetsOf(l.id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feeLines, excluded, feeTargets, itemLines, po?.exchange_rate],
  );

  const cargoLines = useMemo(
    () => itemLines.map((l) => ({ id: l.id as string, qty: Number(l.quantity || 0), unitCost: Number(l.unit_cost || 0) })),
    [itemLines],
  );
  const allocation = useMemo(
    () => allocateCargo(cargoLines, {
      cargoAmount: n(cargoAmount),
      otherCharges: n(otherCharges) + poFees,
      targetedCharges,
      lineCbm: Object.fromEntries(Object.entries(lineCbm).map(([k, v]) => [k, n(v)])),
      boxes,
      exchangeRate: Number(po?.exchange_rate || 1),
    }),
    [cargoLines, cargoAmount, otherCharges, poFees, targetedCharges, lineCbm, boxes, po?.exchange_rate],
  );

  const review = useMemo(() => {
    const items: Record<string, any> = {};
    for (const l of lines as any[]) {
      if (!l.item_id || !l.items) continue;
      items[l.item_id] = {
        itemId: l.item_id,
        currentCost: Number((stock as any)[l.item_id]?.cost ?? l.items.cost_price ?? 0),
        sellingPrice: Number(l.items.selling_price || 0),
        stockNow: Number((stock as any)[l.item_id]?.qty || 0),
      };
    }
    return buildCostReview(
      (lines as any[]).map((l) => ({
        lineId: l.id,
        itemId: l.item_id,
        itemName: l.items?.name || l.item_name,
        qty: Number(l.quantity || 0),
        received: Number(l.received_quantity || 0),
        unitCost: Number(l.unit_cost || 0),
        ownCbm: n(lineCbm[l.id]),
      })),
      allocation,
      items,
      marginTarget,
    );
  }, [lines, stock, lineCbm, allocation, marginTarget]);

  const persist = () => savePoCargo(poId, {
    cargo_amount: n(cargoAmount),
    other_charges: n(otherCharges),
    line_cbm: Object.fromEntries(Object.entries(lineCbm).filter(([, v]) => n(v) > 0).map(([k, v]) => [k, n(v)])),
    boxes: boxes.filter((b) => n(b.cbm) > 0 && b.lineIds.length > 0),
    excluded_lines: [...excluded].filter((id) => feeLines.some((l) => l.id === id)),
    fee_targets: Object.fromEntries(
      Object.entries(feeTargets)
        .filter(([fee]) => feeLines.some((l) => l.id === fee))
        .map(([fee, ids]) => [fee, ids.filter((id) => itemLines.some((l) => l.id === id))])
        .filter(([, ids]) => (ids as string[]).length > 0),
    ),
    notes: "",
  }, (saved?.excluded_lines.length ?? 0) > 0, Object.keys(saved?.fee_targets ?? {}).length > 0);

  const saveMut = useMutation({
    mutationFn: persist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overseas_po_cargo", poId] });
      toast.success("Cargo saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const applyMut = useMutation({
    mutationFn: async () => {
      await persist();
      const rows = review
        .filter((r) => selected.has(r.itemId))
        .map((r) => ({
          item_id: r.itemId,
          new_cost: r.newCost,
          landed_cost: r.landed,
          rmb_cost: po?.currency === "RMB" ? r.foreignCost : null,
          cbm_per_unit: r.cbmPerUnit,
        }));
      return applyLandedCosts(poId, rows);
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["overseas_po_cargo", poId] });
      queryClient.invalidateQueries({ queryKey: ["overseas_po_items", poId] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["items-with-stock"] });
      queryClient.invalidateQueries({ queryKey: ["item_branch_stock"] });
      queryClient.invalidateQueries({ queryKey: ["item_cost_history"] });
      toast.success(`Costs updated for ${count} item${count === 1 ? "" : "s"}`);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const goReview = () => {
    // Everything ticked to start with, except items whose cost does not move.
    setSelected(new Set(review.filter((r) => Math.abs(r.newCost - r.currentCost) >= 0.005).map((r) => r.itemId)));
    setStep("review");
  };

  const lineName = (id: string) => {
    const l = (lines as any[]).find((x) => x.id === id);
    return l?.items?.name || l?.item_name || "—";
  };

  const totalCharges = n(cargoAmount) + n(otherCharges) + poFees + targetedCharges.reduce((s, t) => s + t.amount, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">
            {step === "cargo" ? "Cargo cost" : "Review costs"} · {docNo(po?.po_number)}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {step === "cargo"
              ? "Enter the cargo bill and the CBM each item took. The bill is split by CBM."
              : `New cost averages the stock ${poBranch ? "this PO's branch" : "you"} already hold${poBranch ? "s" : ""} with this shipment, and changes that branch's cost only. Margin is flagged below ${marginTarget}%.`}
          </DialogDescription>
        </DialogHeader>

        {saved?.applied_at && step === "cargo" && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            Costs from this shipment were already applied on {new Date(saved.applied_at).toLocaleDateString()}
            {saved.applied_by_email ? ` by ${saved.applied_by_email}` : ""}. Applying again averages them in a second time.
          </p>
        )}

        {step === "cargo" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Cargo bill (₱)</Label>
                <Input type="number" min={0} step="0.01" value={cargoAmount} onChange={(e) => setCargoAmount(e.target.value)} className="h-9" placeholder="50000" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Other charges (₱)</Label>
                <Input type="number" min={0} step="0.01" value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} className="h-9" placeholder="Customs, delivery…" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Total CBM</Label>
                <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm tabular-nums">{fmtQty(allocation.totalCbm)}</div>
              </div>
            </div>

            {feeLines.length > 0 && (
              <div className="space-y-1.5 rounded-lg border p-3">
                <p className="text-sm font-medium">Other lines on this PO</p>
                <p className="text-[11px] text-muted-foreground">
                  Ticked lines are a cost of getting these goods here (a delivery fee) and are spread over the items
                  with the cargo bill — over all of them, or only the ones picked under it. Untick anything that is not
                  — office supplies, a sample. Don't also add a ticked line to Other charges.
                </p>
                {feeLines.map((l) => (
                  <div key={l.id} className="space-y-1.5">
                  <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Checkbox
                        checked={!excluded.has(l.id)}
                        onCheckedChange={(v) => setExcluded((s) => {
                          const next = new Set(s);
                          if (v) next.delete(l.id); else next.add(l.id);
                          return next;
                        })}
                      />
                      {l.item_name || "Line"} <span className="text-xs text-muted-foreground">· spread over items</span>
                    </span>
                    <span className={cn("tabular-nums", excluded.has(l.id) && "text-muted-foreground line-through")}>
                      {peso(feeValue(l))}
                    </span>
                  </label>
                  {!excluded.has(l.id) && (
                    <div className="flex flex-wrap items-center gap-1.5 pl-7">
                      <span className="text-[11px] text-muted-foreground">Applies to:</span>
                      <button
                        type="button"
                        onClick={() => setFeeTargets((m) => { const next = { ...m }; delete next[l.id]; return next; })}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px]",
                          targetsOf(l.id).length === 0 ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        All items
                      </button>
                      {itemLines.map((it) => {
                        const on = targetsOf(l.id).includes(it.id);
                        return (
                          <button
                            key={it.id}
                            type="button"
                            onClick={() => setFeeTargets((m) => {
                              const cur = (m[l.id] || []).filter((id) => itemLines.some((x) => x.id === id));
                              const next = on ? cur.filter((id) => id !== it.id) : [...cur, it.id];
                              const out = { ...m, [l.id]: next };
                              if (next.length === 0) delete out[l.id];
                              return out;
                            })}
                            className={cn(
                              "rounded-full border px-2.5 py-0.5 text-[11px]",
                              on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {it.items?.name || it.item_name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  </div>
                ))}
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs text-right">Qty</TableHead>
                  <TableHead className="text-xs text-right w-28">Own CBM</TableHead>
                  <TableHead className="text-xs text-right">Cargo share</TableHead>
                  <TableHead className="text-xs text-right">Cargo / pc</TableHead>
                  <TableHead className="text-xs text-right">Landed / pc</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemLines.map((l) => {
                  const a = allocation.lines[l.id];
                  const inBoxes = boxes.filter((b) => b.lineIds.includes(l.id));
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-sm">
                        {l.items?.name || l.item_name}
                        {inBoxes.length > 0 && (
                          <span className="block text-[11px] text-muted-foreground">
                            also in {inBoxes.map((b) => b.label).join(", ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{fmtQty(Number(l.quantity || 0))}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          value={lineCbm[l.id] ?? ""}
                          onChange={(e) => setLineCbm((m) => ({ ...m, [l.id]: e.target.value }))}
                          className="h-8 text-right tabular-nums"
                          placeholder="0"
                        />
                      </TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{peso(a?.cargo ?? 0)}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums">{peso(a?.cargoPerUnit ?? 0)}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums font-medium">{peso(a?.landedPerUnit ?? 0)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Mixed boxes</p>
                  <p className="text-[11px] text-muted-foreground">
                    A box holding several items: enter its CBM once and tick what is in it. Its CBM is shared among them by value.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  onClick={() => setBoxes((bs) => [...bs, { id: newId(), label: `Box ${bs.length + 1}`, cbm: 0, lineIds: [] }])}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add box
                </Button>
              </div>
              {boxes.map((b) => (
                <div key={b.id} className="space-y-2 rounded-md bg-muted/30 p-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={b.label}
                      onChange={(e) => setBoxes((bs) => bs.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x)))}
                      className="h-8 w-32 text-sm"
                    />
                    <Input
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={boxCbmText[b.id] ?? (b.cbm ? String(b.cbm) : "")}
                      onChange={(e) => {
                        const text = e.target.value;
                        setBoxCbmText((m) => ({ ...m, [b.id]: text }));
                        setBoxes((bs) => bs.map((x) => (x.id === b.id ? { ...x, cbm: n(text) } : x)));
                      }}
                      className="h-8 w-28 text-right tabular-nums"
                      placeholder="CBM"
                    />
                    <span className="text-xs text-muted-foreground">CBM</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-8 w-8"
                      onClick={() => setBoxes((bs) => bs.filter((x) => x.id !== b.id))}
                      title="Remove box"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {itemLines.map((l) => {
                      const on = b.lineIds.includes(l.id);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => setBoxes((bs) => bs.map((x) => (x.id !== b.id ? x : {
                            ...x,
                            lineIds: on ? x.lineIds.filter((id) => id !== l.id) : [...x.lineIds, l.id],
                          })))}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs",
                            on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {lineName(l.id)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {totalCharges > 0 && allocation.basis === "value" && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                No CBM entered, so the bill is being split by value for now. Enter CBM to split it by space.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
                Save
              </Button>
              <Button size="sm" disabled={review.length === 0} onClick={goReview}>
                Review costs
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs text-right">Stock</TableHead>
                  <TableHead className="text-xs text-right">Current cost</TableHead>
                  <TableHead className="text-xs text-right">New cost</TableHead>
                  <TableHead className="text-xs text-right">Change</TableHead>
                  <TableHead className="text-xs text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {review.map((r) => (
                  <TableRow key={r.itemId}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(r.itemId)}
                        onCheckedChange={() => setSelected((s) => {
                          const next = new Set(s);
                          if (next.has(r.itemId)) next.delete(r.itemId); else next.add(r.itemId);
                          return next;
                        })}
                      />
                    </TableCell>
                    <TableCell className="text-sm">{r.itemName}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {fmtQty(r.oldUnits)} old + {fmtQty(r.newUnits)} new
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{peso(r.currentCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-sm font-semibold">{peso(r.newCost)}</span>
                      {/* Quiet on purpose: the averaged cost is the one that counts. */}
                      <span className="block text-[10px] text-muted-foreground">latest landed {peso(r.landed)}</span>
                    </TableCell>
                    <TableCell className={cn("text-right text-sm tabular-nums", r.change && r.change > 0 ? "text-destructive" : r.change && r.change < 0 ? "text-success" : "text-muted-foreground")}>
                      {pct(r.change)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {r.margin === null ? (
                        <span className="text-xs text-muted-foreground">no price</span>
                      ) : (
                        <span className={cn("inline-flex items-center gap-1", r.belowTarget && "font-medium text-destructive")}>
                          {r.belowTarget && <AlertTriangle className="h-3 w-3" />}
                          {(r.margin * 100).toFixed(1)}%
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("cargo")}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button size="sm" disabled={selected.size === 0 || applyMut.isPending} onClick={() => applyMut.mutate()}>
                {applyMut.isPending ? "Applying…" : `Apply ${selected.size} cost${selected.size === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
