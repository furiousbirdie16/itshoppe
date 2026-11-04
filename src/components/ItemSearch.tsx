import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { getItemVariations } from "@/lib/api";
import type { Item, ItemVariation } from "@/types/database";
import { searchMatches, searchRank } from "@/lib/search";

interface ItemSearchProps {
  items: Item[];
  value: string; // item_id or ""
  customName?: string; // for custom (non-inventory) items
  /** Optional currently-selected variation id (used to render the chosen variation as the value). */
  variationId?: string | null;
  /**
   * Callback when selection changes. `variation` is non-null when the user picks a variation row.
   * For variation picks, `itemId` will be the parent item id.
   */
  onChange: (itemId: string, item: Item | null, customName?: string, variation?: ItemVariation | null) => void;
  placeholder?: string;
  className?: string;
  allowCustom?: boolean;
  /** Optional source filter — when set, only items with matching source are shown */
  sourceFilter?: 'local' | 'import';
  /** When true, also list this item's variations as selectable rows. Defaults to true. */
  showVariations?: boolean;
}

export function ItemSearch({ items: itemsRaw, value, customName, variationId, onChange, placeholder = "Search by SKU or name...", className, allowCustom = false, sourceFilter, showVariations = true }: ItemSearchProps) {
  // Memoised so a filtered list keeps the same identity between renders and
  // does not invalidate the result list below on every keystroke.
  const items = useMemo(
    () => (sourceFilter ? itemsRaw.filter(i => (i.source ?? 'local') === sourceFilter) : itemsRaw),
    [itemsRaw, sourceFilter],
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Load all variations once for inline display.
  const { data: allVariations = [] } = useQuery<ItemVariation[]>({
    queryKey: ["item_variations"],
    queryFn: () => getItemVariations(),
    enabled: showVariations,
    staleTime: 30_000,
  });

  const selectedItem = items.find(i => i.id === value);
  const selectedVariation = variationId ? allVariations.find(v => v.id === variationId) : null;

  const displayValue = () => {
    if (open) return query;
    if (selectedVariation) return selectedVariation.name;
    if (selectedItem) return `${selectedItem.sku} - ${selectedItem.name}`;
    if (customName) return customName;
    return query;
  };

  const q = query.trim();
  // Build a flat result list: each parent + (optionally) its matching variations.
  type Row =
    | { kind: 'item'; item: Item }
    | { kind: 'variation'; item: Item; variation: ItemVariation };

  // Every keystroke re-runs this over the whole catalogue and its variations,
  // and every line on an invoice holds one of these boxes. Without memoising,
  // typing in one line re-filters the catalogue once per line, per character.
  const varsByItem = useMemo(() => {
    const m = new Map<string, ItemVariation[]>();
    if (!showVariations) return m;
    for (const v of allVariations) {
      const arr = m.get(v.item_id) || [];
      arr.push(v);
      m.set(v.item_id, arr);
    }
    return m;
  }, [allVariations, showVariations]);

  // Word by word, in any order, across the item's fields (see lib/search):
  // "HDMI 1.5m" finds "HDMI cable 1.5m". A variation matches on its own
  // fields together with its item's, so "cat6 100m" finds the 100m cut of
  // CAT6. Best matches first.
  const filtered: Row[] = useMemo(() => {
    const ranked: { item: Item; vars: ItemVariation[]; rank: number }[] = [];
    for (const item of items) {
      const itemFields = [item.sku, item.name, (item as any).brand, (item as any).category, (item as any).barcode, (item as any).supplier_sku];
      const itemVars = varsByItem.get(item.id) || [];
      if (!q) {
        ranked.push({ item, vars: itemVars, rank: 0 });
        continue;
      }
      const itemMatches = searchMatches(q, ...itemFields);
      const matchingVars = itemVars.filter(v => searchMatches(q, v.name, v.sku, item.name, item.sku));
      if (!itemMatches && matchingVars.length === 0) continue;
      const rank = Math.min(
        itemMatches ? searchRank(q, item.name, item.sku) : Infinity,
        ...matchingVars.map(v => searchRank(q, `${item.name} ${v.name}`, v.sku)),
      );
      ranked.push({ item, vars: matchingVars, rank });
    }
    if (q) ranked.sort((a, b) => a.rank - b.rank);

    const rows: Row[] = [];
    for (const r of ranked) {
      rows.push({ kind: 'item', item: r.item });
      for (const v of r.vars) rows.push({ kind: 'variation', item: r.item, variation: v });
      if (rows.length >= 30) break;
    }
    return rows;
  }, [items, varsByItem, q]);

  // Hand the typed name up to the form. Called whenever focus or attention
  // leaves the box, rather than on every keystroke: committing per character
  // re-rendered every line on the invoice and made typing lag.
  const commitRef = useRef<() => void>(() => {});
  commitRef.current = () => {
    if (allowCustom && query.trim() && !selectedItem && !selectedVariation) {
      onChange("", null, query.trim(), null);
    }
  };

  // Switching tab or app fires no click, so those are listened for directly —
  // that is how a half-typed name used to be lost.
  useEffect(() => {
    const save = () => commitRef.current();
    const onHide = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    window.addEventListener("blur", save);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("blur", save);
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (open && allowCustom && query.trim() && !selectedItem) {
          onChange("", null, query.trim(), null);
        }
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, query, allowCustom, selectedItem]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && allowCustom && query.trim() && filtered.length === 0) {
      onChange("", null, query.trim(), null);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          value={displayValue()}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onBlur={e => {
            // Moving into this box's own dropdown is not leaving it; that click
            // is about to choose a real item.
            if (ref.current && e.relatedTarget && ref.current.contains(e.relatedTarget as Node)) return;
            commitRef.current();
          }}
          onFocus={() => {
            setOpen(true);
            // Clearing lets you search afresh over a chosen item, but a custom
            // name has nowhere else to live, so it stays put.
            setQuery(selectedItem || selectedVariation ? "" : (customName || ""));
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-8 pl-7 text-sm"
        />
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-md bg-popover shadow-md max-h-64 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-2 text-xs text-muted-foreground text-center">
              {allowCustom && query.trim() ? (
                <button
                  type="button"
                  className="w-full text-left px-1 py-0.5 hover:bg-accent rounded"
                  onClick={() => { onChange("", null, query.trim(), null); setOpen(false); }}
                >
                  Use custom: "<span className="font-medium">{query.trim()}</span>"
                </button>
              ) : "No items found"}
            </div>
          ) : (
            <>
              {filtered.map((row, idx) => row.kind === 'item' ? (
                <button
                  key={`i-${row.item.id}-${idx}`}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center justify-between gap-2"
                  onClick={() => { onChange(row.item.id, row.item, undefined, null); setQuery(""); setOpen(false); }}
                >
                  <span>
                    <span className="tabular-nums text-xs text-primary font-medium">{row.item.sku}</span>
                    <span className="text-muted-foreground mx-1">—</span>
                    <span>{row.item.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">Stock: {row.item.quantity}</span>
                </button>
              ) : (
                <button
                  key={`v-${row.variation.id}-${idx}`}
                  type="button"
                  className="w-full text-left pl-8 pr-3 py-1.5 text-sm hover:bg-accent flex items-center justify-between gap-2 border-l-2 border-primary/30 ml-2"
                  onClick={() => { onChange(row.item.id, row.item, undefined, row.variation); setQuery(""); setOpen(false); }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase px-1 py-0.5 rounded bg-secondary text-secondary-foreground">{row.variation.type}</span>
                    <span className="text-xs">{row.variation.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      ({row.variation.factor}{row.variation.type === 'cut' ? 'm' : (row.item.base_unit || 'pcs')})
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">₱{Number(row.variation.selling_price).toLocaleString()}</span>
                </button>
              ))}
              {allowCustom && query.trim() && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent border-t text-muted-foreground"
                  onClick={() => { onChange("", null, query.trim(), null); setOpen(false); }}
                >
                  + Use custom: "<span className="font-medium">{query.trim()}</span>"
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
