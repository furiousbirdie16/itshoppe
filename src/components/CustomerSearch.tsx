import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import type { Customer } from "@/types/database";

interface CustomerSearchProps {
  customers: Customer[];
  value: string;
  onChange: (customerId: string) => void;
  placeholder?: string;
  className?: string;
}

export function CustomerSearch({ customers, value, onChange, placeholder = "Search customer by name...", className }: CustomerSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = customers.find(c => c.id === value);

  const displayValue = () => {
    if (open) return query;
    return selected ? selected.name : "";
  };

  const filtered = query.trim()
    ? customers.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        (c.contact_person || "").toLowerCase().includes(query.toLowerCase()) ||
        (c.email || "").toLowerCase().includes(query.toLowerCase())
      ).slice(0, 20)
    : customers.slice(0, 20);

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
            <div className="p-3 text-xs text-muted-foreground text-center">No customers found</div>
          ) : (
            filtered.map(c => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex flex-col"
                onClick={() => { onChange(c.id); setQuery(""); setOpen(false); }}
              >
                <span className="font-medium">{c.name}</span>
                {(c.contact_person || c.email) && (
                  <span className="text-xs text-muted-foreground">
                    {[c.contact_person, c.email].filter(Boolean).join(" • ")}
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
