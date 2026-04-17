import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import type { Supplier } from "@/types/database";

interface SupplierSearchProps {
  suppliers: Supplier[];
  value: string;
  onChange: (supplierId: string) => void;
  placeholder?: string;
  className?: string;
}

export function SupplierSearch({ suppliers, value, onChange, placeholder = "Search supplier by name...", className }: SupplierSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = suppliers.find(s => s.id === value);

  const displayValue = () => {
    if (open) return query;
    return selected ? selected.name : "";
  };

  const filtered = query.trim()
    ? suppliers.filter(s =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        (s.contact_person || "").toLowerCase().includes(query.toLowerCase()) ||
        (s.email || "").toLowerCase().includes(query.toLowerCase())
      ).slice(0, 20)
    : suppliers.slice(0, 20);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={displayValue()}
          onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(""); }}
          placeholder={placeholder}
          className="h-9 pl-7 text-sm"
        />
      </div>
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 border rounded-md bg-popover shadow-md max-h-60 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground text-center">No suppliers found</div>
          ) : (
            filtered.map(s => (
              <button
                key={s.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex flex-col"
                onClick={() => { onChange(s.id); setQuery(""); setOpen(false); }}
              >
                <span className="font-medium">{s.name}</span>
                {(s.contact_person || s.email) && (
                  <span className="text-xs text-muted-foreground">
                    {[s.contact_person, s.email].filter(Boolean).join(" • ")}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
