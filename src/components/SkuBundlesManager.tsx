import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkuBundleDialog } from "@/components/SkuBundleDialog";
import { deleteSkuBundle, getSkuBundles, type SkuBundle } from "@/lib/sku-bundles";
import type { Item } from "@/types/database";
import { searchMatches } from "@/lib/search";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Item[];
}

/** Every bundle SKU, to add, change or remove ahead of an upload. */
export function SkuBundlesManager({ open, onOpenChange, items }: Props) {
  const queryClient = useQueryClient();
  const { data: bundles = [], isLoading } = useQuery({ queryKey: ["sku-bundles"], queryFn: getSkuBundles, enabled: open });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SkuBundle | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bundles;
    return bundles.filter((b) =>
      searchMatches(q, b.sku, ...b.lines.map((l) => `${l.item_name ?? ""} ${l.variation_name ?? ""}`)),
    );
  }, [bundles, search]);

  const remove = async (b: SkuBundle) => {
    if (!b.id || !confirm(`Remove "${b.sku}"? Uploads will stop recognising it.`)) return;
    try {
      await deleteSkuBundle(b.id);
      await queryClient.invalidateQueries({ queryKey: ["sku-bundles"] });
      toast.success("Removed");
    } catch (e: any) {
      toast.error(e?.message || "Could not remove");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">Bundle SKUs</DialogTitle>
            <DialogDescription className="text-xs">
              Marketplace SKUs that are kits, or named differently from your items. Uploads turn them into your items.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-sm" placeholder="Search SKU or item…" />
            </div>
            <Button size="sm" className="h-9" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          </div>
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {bundles.length === 0 ? "None yet. Add one here, or from an upload line it does not recognise." : "No matches."}
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {shown.map((b) => (
                <div key={b.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{b.sku}</div>
                    <div className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
                      {b.lines.map((l, i) => (
                        <div key={i}>
                          {l.quantity} × {l.item_name}{l.variation_name ? ` · ${l.variation_name}` : ""}
                          {b.lines.length > 1 && (l.gets_price ? " — gets the price" : " — ₱0")}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => { setEditing(b); setFormOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" title="Remove" onClick={() => remove(b)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <SkuBundleDialog open={formOpen} onOpenChange={setFormOpen} bundle={editing} items={items} />
    </>
  );
}
