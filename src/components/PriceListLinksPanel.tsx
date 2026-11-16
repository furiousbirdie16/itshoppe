import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ItemSearch } from "@/components/ItemSearch";
import { usePriceListData } from "@/components/PriceListSearch";
import { getItems } from "@/lib/api";
import { confidence, makeMatcher } from "@/lib/price-match";
import {
  getItemLinks,
  getPriceListProducts,
  linkLookup,
  setItemLinks,
  ITEM_LINKS_KEY,
} from "@/lib/price-list-api";
import { cn } from "@/lib/utils";

const sameBrand = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
type Show = "all" | "unlinked" | "linked";

/**
 * Links each price list product to the inventory item it is, so quoting it
 * adds the real item (and invoicing it takes it out of stock). The names
 * differ between your price list and Inventory, so a best guess is offered
 * for each; you confirm it, pick another, or leave it unlinked.
 */
export function PriceListLinksPanel() {
  const qc = useQueryClient();
  const { lists } = usePriceListData();
  const brands = useMemo(() => [...new Set(lists.map((l) => l.brand.trim()))], [lists]);
  const [brand, setBrand] = useState("");
  useEffect(() => {
    if (!brand && brands.length > 0) setBrand(brands.find((b) => /shoppe/i.test(b)) ?? brands[0]);
  }, [brands, brand]);
  const latest = lists.find((l) => sameBrand(l.brand, brand) && l.is_active) ?? lists.find((l) => sameBrand(l.brand, brand));

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["price-list-products", latest?.id],
    queryFn: () => getPriceListProducts(latest!.id),
    enabled: !!latest,
  });
  const { data: items = [], isLoading: loadingItems } = useQuery({ queryKey: ["items"], queryFn: getItems, staleTime: 5 * 60_000 });
  const { data: links = [] } = useQuery({ queryKey: ITEM_LINKS_KEY, queryFn: getItemLinks });
  const linkOf = useMemo(() => linkLookup(links), [links]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // The best guess per product, worked out once per list and inventory.
  const matcher = useMemo(() => makeMatcher(items), [items]);
  const suggestions = useMemo(() => {
    const m = new Map<string, { itemId: string; score: number; runnerUp: number }>();
    for (const p of products) {
      const [best, next] = matcher(p.model, 2);
      if (best) m.set(p.model, { itemId: best.item.id, score: best.score, runnerUp: next?.score ?? 0 });
    }
    return m;
  }, [products, matcher]);

  const [show, setShow] = useState<Show>("unlinked");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Your own pick for a product before saving it.
  const [picked, setPicked] = useState<Record<string, string>>({});
  useEffect(() => {
    setSelected(new Set());
    setPicked({});
  }, [brand]);

  const saveMut = useMutation({
    mutationFn: (pairs: { product: string; itemId: string | null }[]) => setItemLinks(brand, pairs),
    onSuccess: (_d, pairs) => {
      qc.invalidateQueries({ queryKey: ITEM_LINKS_KEY });
      setSelected(new Set());
      setPicked((p) => {
        const n = { ...p };
        for (const x of pairs) delete n[x.product];
        return n;
      });
      const linked = pairs.filter((x) => x.itemId).length;
      toast.success(linked ? `Linked ${linked} product${linked === 1 ? "" : "s"} to inventory` : "Unlinked");
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't save the links"),
  });

  if (brands.length === 0) {
    return <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">Upload a price list first.</p>;
  }

  const rows = products.map((p) => {
    const linkedId = linkOf(brand, p.model);
    const sug = suggestions.get(p.model);
    const choice = picked[p.model] ?? (linkedId ? undefined : sug?.itemId);
    return { ...p, linkedId, sug, choice };
  });
  const linkedCount = rows.filter((r) => r.linkedId).length;
  const highReady = rows.filter((r) => !r.linkedId && r.sug && confidence(r.sug.score, r.sug.runnerUp) === "high" && !picked[r.model]);
  const visible = rows.filter((r) => (show === "all" ? true : show === "linked" ? !!r.linkedId : !r.linkedId));
  const busy = saveMut.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {brands.length > 1 && (
          <Select value={brand} onValueChange={setBrand}>
            <SelectTrigger className="h-9 w-56 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Select value={show} onValueChange={(v) => setShow(v as Show)}>
          <SelectTrigger className="h-9 w-44 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unlinked">Not linked yet</SelectItem>
            <SelectItem value="linked">Linked</SelectItem>
            <SelectItem value="all">All products</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {linkedCount} of {rows.length} linked to inventory
        </span>
        <div className="ml-auto flex gap-2">
          {highReady.length > 0 && (
            <Button
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => saveMut.mutate(highReady.map((r) => ({ product: r.model, itemId: r.sug!.itemId })))}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" /> Link {highReady.length} close matches
            </Button>
          )}
          {selected.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-9"
              disabled={busy}
              onClick={() => saveMut.mutate(rows.filter((r) => selected.has(r.model) && r.choice).map((r) => ({ product: r.model, itemId: r.choice! })))}
            >
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> Link {selected.size} selected
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        A linked product is quoted as the real inventory item, so invoicing it takes it out of stock. Suggestions compare the names, sizes counting most:
        check each one, pick another with the search box, or leave it unlinked. Links are kept by product name, so next month's upload keeps them.
      </p>

      {(loadingProducts || loadingItems) ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          <div className="hidden grid-cols-[28px_minmax(0,1.2fr)_minmax(0,1.6fr)_70px_120px] gap-3 px-3 py-2 text-[11px] font-medium text-muted-foreground md:grid">
            <span /><span>Price list product</span><span>Inventory item</span><span>Match</span><span />
          </div>
          {visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p>}
          {visible.map((r) => {
            const conf = r.sug ? confidence(r.sug.score, r.sug.runnerUp) : null;
            const current = r.linkedId ?? r.choice ?? "";
            const isSuggestion = !r.linkedId && !picked[r.model] && !!r.sug;
            return (
              <div key={r.id} className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-3 py-2 md:grid-cols-[28px_minmax(0,1.2fr)_minmax(0,1.6fr)_70px_120px]">
                <Checkbox
                  checked={selected.has(r.model)}
                  disabled={!!r.linkedId || !r.choice}
                  onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(r.model); else n.delete(r.model); return n; })}
                  aria-label={`Select ${r.model}`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">{r.model}</p>
                  <p className="text-[11px] text-muted-foreground">{r.category}{r.tags?.includes("no_stock") ? " · No stock" : ""}</p>
                </div>
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <ItemSearch
                    items={items}
                    value={current}
                    onChange={(itemId) => {
                      if (!itemId) return;
                      if (r.linkedId) saveMut.mutate([{ product: r.model, itemId }]);
                      else setPicked((p) => ({ ...p, [r.model]: itemId }));
                    }}
                    placeholder="Search inventory…"
                  />
                  {current && itemById.get(current) && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      SKU {itemById.get(current)!.sku} · in stock {itemById.get(current)!.quantity}
                    </p>
                  )}
                </div>
                <div className="col-span-2 md:col-span-1">
                  {r.linkedId ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Linked</span>
                  ) : isSuggestion && conf ? (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium",
                        conf === "high" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
                        conf === "medium" && "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
                        conf === "low" && "bg-muted text-muted-foreground",
                      )}
                      title={`Name match ${Math.round(r.sug!.score * 100)}%`}
                    >
                      {conf === "high" ? "Close" : conf === "medium" ? "Check" : "Weak"} {Math.round(r.sug!.score * 100)}%
                    </span>
                  ) : picked[r.model] ? (
                    <span className="text-[11px] text-muted-foreground">Your pick</span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">No match</span>
                  )}
                </div>
                <div className="col-span-2 flex justify-end gap-1 md:col-span-1">
                  {r.linkedId ? (
                    <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => saveMut.mutate([{ product: r.model, itemId: null }])}>
                      <Unlink className="mr-1 h-3.5 w-3.5" /> Unlink
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy || !r.choice} onClick={() => saveMut.mutate([{ product: r.model, itemId: r.choice! }])}>
                      <Link2 className="mr-1 h-3.5 w-3.5" /> Link
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
