import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, Layers } from "lucide-react";
import { peso } from "@/lib/currency";
import { getItemVariations, createItemVariation, updateItemVariation, deleteItemVariation, updateItem } from "@/lib/api";
import type { Item, ItemVariation } from "@/types/database";
import { toast } from "sonner";

interface Props {
  item: Item;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VariationsManager({ item, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { data: variations = [] } = useQuery({
    queryKey: ["item_variations", item.id],
    queryFn: () => getItemVariations(item.id),
    enabled: open,
  });

  const [editing, setEditing] = useState<ItemVariation | null>(null);
  const [form, setForm] = useState({ name: "", sku: "", type: "pack" as "pack" | "cut", factor: "1", selling_price: "0", cost_price: "" });
  const [showForm, setShowForm] = useState(false);

  /** Proportional cost from parent: parent.cost_price × (factor / units_per_stock). */
  const autoCost = (factor: number) => {
    const parentCost = Number(item.cost_price);
    const ups = Number(item.units_per_stock ?? 1) || 1;
    if (!Number.isFinite(parentCost) || parentCost <= 0 || ups <= 0) return null;
    return parentCost * (factor / ups);
  };
  const formAutoCost = autoCost(parseFloat(form.factor) || 0);

  // Parent stock settings
  const [baseUnit, setBaseUnit] = useState(item.base_unit || "pcs");
  const [unitsPerStock, setUnitsPerStock] = useState(String(item.units_per_stock ?? 1));
  const [openRoll, setOpenRoll] = useState(String(item.open_roll_remaining ?? 0));

  const stockSettingsMut = useMutation({
    mutationFn: () => updateItem(item.id, {
      base_unit: baseUnit,
      units_per_stock: parseFloat(unitsPerStock) || 1,
      open_roll_remaining: parseFloat(openRoll) || 0,
    } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      toast.success("Stock settings updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => { setForm({ name: "", sku: "", type: "pack", factor: "1", selling_price: "0", cost_price: "" }); setEditing(null); setShowForm(false); };

  const saveMut = useMutation({
    mutationFn: async () => {
      const trimmedCost = form.cost_price.trim();
      const payload = {
        item_id: item.id,
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        type: form.type,
        factor: parseFloat(form.factor) || 1,
        selling_price: parseFloat(form.selling_price) || 0,
        // Blank cost = auto (proportional from parent). A typed value = manual override.
        cost_price: trimmedCost === "" ? null : parseFloat(trimmedCost),
        cost_is_manual: trimmedCost !== "",
      };
      if (editing) await updateItemVariation(editing.id, payload as any);
      else await createItemVariation(payload as any);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item_variations"] });
      qc.invalidateQueries({ queryKey: ["item_variations", item.id] });
      toast.success(editing ? "Variation updated" : "Variation added");
      resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteItemVariation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item_variations"] });
      qc.invalidateQueries({ queryKey: ["item_variations", item.id] });
      toast.success("Variation deleted");
    },
  });

  const startEdit = (v: ItemVariation) => {
    setEditing(v);
    setForm({ name: v.name, sku: v.sku || "", type: v.type, factor: String(v.factor), selling_price: String(v.selling_price), cost_price: v.cost_is_manual && v.cost_price != null ? String(v.cost_price) : "" });
    setShowForm(true);
  };

  const isCut = (item.units_per_stock ?? 1) > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <Layers className="h-4 w-4" /> Variations — {item.name}
          </DialogTitle>
        </DialogHeader>

        {/* Parent stock settings */}
        <div className="rounded-lg border p-3 bg-muted/30">
          <p className="text-xs font-semibold mb-2">Stock Settings</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase">Base Unit</Label>
              <Input value={baseUnit} onChange={e => setBaseUnit(e.target.value)} placeholder="pcs / m" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase">Units / Stock</Label>
              <Input type="number" value={unitsPerStock} onChange={e => setUnitsPerStock(e.target.value)} placeholder="1 (or 305 for rolls)" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase">Open Roll Remainder</Label>
              <Input type="number" value={openRoll} onChange={e => setOpenRoll(e.target.value)} className="h-8 text-sm" disabled={!isCut && parseFloat(unitsPerStock) <= 1} />
            </div>
          </div>
          <div className="flex justify-between items-center mt-2">
            <p className="text-[10px] text-muted-foreground">
              For rolls/bulk: set Units/Stock to e.g. 305 (m per roll). Open Roll = meters left on the currently-opened roll.
            </p>
            <Button size="sm" variant="outline" onClick={() => stockSettingsMut.mutate()} disabled={stockSettingsMut.isPending} className="h-7 text-xs">Save Settings</Button>
          </div>
          <p className="text-xs mt-2">
            Current stock: <span className="font-semibold">{item.quantity}</span>
            {(item.units_per_stock ?? 1) > 1 && (item.open_roll_remaining ?? 0) > 0 && (
              <span className="text-muted-foreground"> + {item.open_roll_remaining}{item.base_unit || 'm'} open</span>
            )}
          </p>
        </div>

        {/* Variations list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Variations ({variations.length})</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => autoCostAllMut.mutate()} disabled={autoCostAllMut.isPending || variations.length === 0} className="h-7 text-xs">
                <RefreshCw className="h-3 w-3 mr-1" /> Auto-cost all
              </Button>
              {!showForm && (
                <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add Variation
                </Button>
              )}
            </div>
          </div>


          {showForm && (
            <div className="rounded-lg border p-3 space-y-2 bg-card">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Name</Label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder='e.g. "DC male 5pcs" or "CAT6 50m cut"' className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">SKU (optional)</Label>
                  <Input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className="h-8 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Type</Label>
                  <Select value={form.type} onValueChange={(v: "pack" | "cut") => setForm({ ...form, type: v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pack">Pack (× pieces)</SelectItem>
                      <SelectItem value="cut">Cut (× meters)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">{form.type === "pack" ? "Pcs / Pack" : "Meters / Cut"}</Label>
                  <Input type="number" value={form.factor} onChange={e => setForm({ ...form, factor: e.target.value })} className="h-8 text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Selling Price</Label>
                  <Input type="number" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase">Cost Price</Label>
                  <Input type="number" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} placeholder={formAutoCost != null ? `Auto: ${formAutoCost.toFixed(2)}` : "Leave blank for auto"} className="h-8 text-sm" />
                  <p className="text-[10px] text-muted-foreground">
                    Blank = auto cost from parent ({peso(Number(item.cost_price || 0))} × {form.factor || 0} / {item.units_per_stock ?? 1}
                    {formAutoCost != null ? ` = ${peso(formAutoCost)}` : ""}). Type a value to override manually.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={resetForm} className="h-7 text-xs">Cancel</Button>
                <Button size="sm" onClick={() => saveMut.mutate()} disabled={!form.name.trim() || saveMut.isPending} className="h-7 text-xs">
                  {editing ? "Update" : "Add"}
                </Button>
              </div>
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs text-right">Factor</TableHead>
                  <TableHead className="text-xs text-right">Price</TableHead>
                  <TableHead className="text-xs text-right">Cost</TableHead>
                  <TableHead className="text-xs text-right w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variations.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">No variations yet</TableCell></TableRow>
                ) : variations.map(v => {
                  const hasCost = v.cost_price != null;
                  const margin = hasCost && Number(v.selling_price) > 0
                    ? ((Number(v.selling_price) - Number(v.cost_price)) / Number(v.selling_price)) * 100
                    : null;
                  return (
                  <TableRow key={v.id} className={!hasCost ? "bg-amber-50 dark:bg-amber-950/20" : undefined}>
                    <TableCell className="text-sm">
                      <div className="font-medium flex items-center gap-1.5">
                        {v.name}
                        {!hasCost && <Badge variant="outline" className="text-[9px] border-amber-500 text-amber-700 dark:text-amber-300">No cost</Badge>}
                      </div>
                      {v.sku && <div className="text-[10px] font-mono text-muted-foreground">{v.sku}</div>}
                    </TableCell>
                    <TableCell><Badge variant={v.type === 'pack' ? 'outline' : 'secondary'} className="text-[10px] uppercase">{v.type}</Badge></TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {v.factor} {v.type === 'pack' ? (item.base_unit || 'pcs') : 'm'}
                    </TableCell>
                    <TableCell className="text-right text-sm">{peso(Number(v.selling_price))}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {hasCost ? (
                        <div>
                          <div>{peso(Number(v.cost_price))}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {v.cost_is_manual ? "manual" : "auto"}
                            {margin != null ? ` · ${margin.toFixed(1)}% margin` : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 text-xs">— set parent cost</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(v)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMut.mutate(v.id)}><Trash2 className="h-3 w-3 text-destructive/70" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
