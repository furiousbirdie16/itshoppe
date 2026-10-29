import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ItemSearch } from "@/components/ItemSearch";
import { bundleProblems, saveSkuBundle, type SkuBundle, type SkuBundleLine } from "@/lib/sku-bundles";
import type { Item } from "@/types/database";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bundle being edited, or null for a new one. */
  bundle?: SkuBundle | null;
  /** A new bundle's SKU, when opened from an upload line that did not match. */
  initialSku?: string;
  items: Item[];
  onSaved?: (id: string) => void;
}

const blankLine = (getsPrice: boolean): SkuBundleLine => ({ item_id: "", variation_id: null, quantity: 1, gets_price: getsPrice });

/**
 * What a marketplace SKU is made of. One line is a plain rename; several make
 * a kit, of which the line marked "gets the price" carries the whole price.
 */
export function SkuBundleDialog({ open, onOpenChange, bundle, initialSku, items, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [sku, setSku] = useState("");
  const [lines, setLines] = useState<SkuBundleLine[]>([blankLine(true)]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSku(bundle?.sku ?? initialSku ?? "");
    setLines(bundle?.lines.length ? bundle.lines.map((l) => ({ ...l })) : [blankLine(true)]);
  }, [open, bundle, initialSku]);

  const setLine = (i: number, patch: Partial<SkuBundleLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    const draft = { id: bundle?.id, sku, lines };
    const problems = bundleProblems(draft);
    if (problems.length) { toast.error(problems[0]); return; }
    setSaving(true);
    try {
      const id = await saveSkuBundle(draft);
      await queryClient.invalidateQueries({ queryKey: ["sku-bundles"] });
      toast.success(`"${sku.trim()}" set up`);
      onSaved?.(id);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{bundle?.id ? "Edit bundle SKU" : "Set up a SKU"}</DialogTitle>
          <DialogDescription className="text-xs">
            What this SKU is made of. Uploads turn it into these items: the one that gets the price carries the whole
            price, the rest go in at ₱0. One item on its own is just a name match.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">SKU (as it appears in the upload)</Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} className="h-9" placeholder="e.g. CAT6 Pure Copper Indoor 100m w/ crimp" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Made of</Label>
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setLines((ls) => [...ls, blankLine(false)])}>
                <Plus className="mr-1 h-3 w-3" /> Add item
              </Button>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_84px_auto_auto] sm:items-center sm:border-0 sm:p-0">
                <ItemSearch
                  items={items}
                  value={line.item_id}
                  variationId={line.variation_id}
                  onChange={(itemId, item, _custom, variation) => {
                    if (variation && item) setLine(i, { item_id: item.id, variation_id: variation.id });
                    else setLine(i, { item_id: itemId || "", variation_id: null });
                  }}
                  placeholder="Search item or variation..."
                />
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={line.quantity || ""}
                  onChange={(e) => setLine(i, { quantity: Number(e.target.value) || 0 })}
                  className="h-9 text-sm numeric-field"
                  placeholder="Qty"
                />
                <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs">
                  <input
                    type="radio"
                    name="gets-price"
                    checked={line.gets_price}
                    onChange={() => setLines((ls) => ls.map((l, j) => ({ ...l, gets_price: j === i })))}
                  />
                  Gets the price
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-8"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => {
                    const next = ls.filter((_, j) => j !== i);
                    // Never leave a bundle with nobody carrying the price.
                    if (!next.some((l) => l.gets_price) && next[0]) next[0] = { ...next[0], gets_price: true };
                    return next;
                  })}
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
