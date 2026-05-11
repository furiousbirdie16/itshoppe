import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  allLabel: string;
  placeholder?: string;
  className?: string;
  emptyText?: string;
}

/**
 * Searchable filter combobox. Only renders options passed in (already
 * narrowed to those that exist in current dataset). Includes an "All" entry
 * that resets to the value "all".
 */
export function FilterCombobox({ value, onChange, options, allLabel, placeholder = "Search...", className, emptyText = "No matches" }: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const display = value === "all" ? `${allLabel} (${options.length})` : (selected?.label || "Select");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={cn("justify-between font-normal", className)}>
          <span className="truncate">{display}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} className="h-9" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem value={`__all__ ${allLabel}`} onSelect={() => { onChange("all"); setOpen(false); }}>
                <Check className={cn("mr-2 h-4 w-4", value === "all" ? "opacity-100" : "opacity-0")} />
                {allLabel} ({options.length})
              </CommandItem>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => { onChange(o.value); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
