import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import type { Item } from "@/types/database";

interface ItemSearchProps {
  items: Item[];
  value: string; // item_id or ""
  customName?: string; // for custom (non-inventory) items
  onChange: (itemId: string, item: Item | null, customName?: string) => void;
  placeholder?: string;
  className?: string;
  allowCustom?: boolean;
  /** Optional source filter — when set, only items with matching source are shown */
  sourceFilter?: 'local' | 'import';
}

export function ItemSearch({ items: itemsRaw, value, customName, onChange, placeholder = "Search by SKU or name...", className, allowCustom = false, sourceFilter }: ItemSearchProps) {
  const items = sourceFilter ? itemsRaw.filter(i => (i.source ?? 'local') === sourceFilter) : itemsRaw;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedItem = items.find(i => i.id === value);

  const displayValue = () => {
    if (open) return query;
    if (selectedItem) return `${selectedItem.sku} - ${selectedItem.name}`;
    if (customName) return customName;
    return query;
  };

  const filtered = query.trim()
    ? items.filter(i =>
        i.sku.toLowerCase().includes(query.toLowerCase()) ||
        i.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10)
    : items.slice(0, 10);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (open && allowCustom && query.trim() && !selectedItem) {
          // User typed a custom name and clicked away
          onChange("", null, query.trim());
        }
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, query, allowCustom, selectedItem]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && allowCustom && query.trim() && filtered.length === 0) {
      onChange("", null, query.trim());
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
        <div className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-md bg-popover shadow-md max-h-48 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-2 text-xs text-muted-foreground text-center">
              {allowCustom && query.trim() ? (
                <button
                  type="button"
                  className="w-full text-left px-1 py-0.5 hover:bg-accent rounded"
                  onClick={() => { onChange("", null, query.trim()); setOpen(false); }}
                >
                  Use custom: "<span className="font-medium">{query.trim()}</span>"
                </button>
              ) : "No items found"}
            </div>
          ) : (
            <>
              {filtered.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center justify-between gap-2"
                  onClick={() => { onChange(item.id, item); setQuery(""); setOpen(false); }}
                >
                  <span>
                    <span className="font-mono text-xs text-primary font-medium">{item.sku}</span>
                    <span className="text-muted-foreground mx-1">—</span>
                    <span>{item.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">Stock: {item.quantity}</span>
                </button>
              ))}
              {allowCustom && query.trim() && (
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent border-t text-muted-foreground"
                  onClick={() => { onChange("", null, query.trim()); setOpen(false); }}
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
