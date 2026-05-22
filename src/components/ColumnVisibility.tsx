import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Columns3 } from "lucide-react";

export interface ColumnDef {
  key: string;
  label: string;
  /** Always visible (cannot be toggled). */
  required?: boolean;
  /** Default visibility (when no saved preference). */
  defaultVisible?: boolean;
}

export function useColumnVisibility(storageKey: string, columns: ColumnDef[]) {
  const initial = (): Record<string, boolean> => {
    const base: Record<string, boolean> = {};
    columns.forEach((c) => {
      base[c.key] = c.required ? true : c.defaultVisible !== false;
    });
    if (typeof window === "undefined") return base;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, boolean>;
        columns.forEach((c) => {
          if (c.required) base[c.key] = true;
          else if (typeof parsed[c.key] === "boolean") base[c.key] = parsed[c.key];
        });
      }
    } catch {
      /* ignore */
    }
    return base;
  };

  const [visible, setVisible] = useState<Record<string, boolean>>(initial);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(visible));
    } catch {
      /* ignore */
    }
  }, [storageKey, visible]);

  const isVisible = (key: string) => visible[key] !== false;
  const toggle = (key: string, v: boolean) =>
    setVisible((prev) => ({ ...prev, [key]: v }));
  const reset = () => {
    const base: Record<string, boolean> = {};
    columns.forEach((c) => {
      base[c.key] = c.required ? true : c.defaultVisible !== false;
    });
    setVisible(base);
  };

  return { visible, isVisible, toggle, reset };
}

export function ColumnVisibilityMenu({
  columns,
  visible,
  onToggle,
  onReset,
}: {
  columns: ColumnDef[];
  visible: Record<string, boolean>;
  onToggle: (key: string, v: boolean) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          <Columns3 className="h-3.5 w-3.5 mr-1.5" /> Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-[70vh] overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.key}
            checked={visible[c.key] !== false}
            disabled={c.required}
            onCheckedChange={(v) => onToggle(c.key, !!v)}
            onSelect={(e) => e.preventDefault()}
            className="text-xs"
          >
            {c.label}
            {c.required && <span className="ml-auto text-[10px] text-muted-foreground">required</span>}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onReset(); }} className="text-xs">
          Reset to default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
