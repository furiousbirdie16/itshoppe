import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { getItemVariations } from "@/lib/api";
import type { Item, ItemVariation } from "@/types/database";

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
  const items = sourceFilter ? itemsRaw.filter(i => (i.source ?? 'local') === sourceFilter) : itemsRaw;
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

  const q = query.trim().toLowerCase();
  // Build a flat result list: each parent + (optionally) its matching variations.
  type Row =
    | { kind: 'item'; item: Item }
    | { kind: 'variation'; item: Item; variation: ItemVariation };

  const matches = (text: string) => !q || text.toLowerCase().includes(q);

  const filtered: Row[] = [];
  for (const item of items) {
    const itemMatches = matches(item.sku) || matches(item.name);
    const itemVars = showVariations ? allVariations.filter(v => v.item_id === item.id) : [];
    const matchingVars = itemVars.filter(v => matches(v.name) || (v.sku && matches(v.sku)));
    const showItem = itemMatches || matchingVars.length > 0 || (!q && itemVars.length > 0);
    if (showItem) {
      filtered.push({ kind: 'item', item });
      // If user typed something matching variations OR no query and item has variations, list them.
      const varsToShow = q ? matchingVars : itemVars;
      for (const v of varsToShow) filtered.push({ kind: 'variation', item, variation: v });
    }
    if (filtered.length >= 30) break;
  }

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
          onFocus={() => { setOpen(true); setQuery(""); }}
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
                    <span className="font-mono text-xs text-primary font-medium">{row.item.sku}</span>
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
