import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Columns3, ArrowUp, ArrowDown, Lock } from "lucide-react";

export interface ColumnDef {
  key: string;
  label: string;
  /** Always visible AND fixed position (cannot be toggled or moved). */
  required?: boolean;
  /** Default visibility (when no saved preference). */
  defaultVisible?: boolean;
}

interface StoredPrefs {
  visible?: Record<string, boolean>;
  order?: string[];
}

function loadPrefs(storageKey: string, columns: ColumnDef[]): { visible: Record<string, boolean>; order: string[] } {
  const baseVisible: Record<string, boolean> = {};
  columns.forEach((c) => {
    baseVisible[c.key] = c.required ? true : c.defaultVisible !== false;
  });
  const baseOrder = columns.map((c) => c.key);
  if (typeof window === "undefined") return { visible: baseVisible, order: baseOrder };
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { visible: baseVisible, order: baseOrder };
    const parsed = JSON.parse(raw);
    // Back-compat: old format was just Record<string, boolean>
    const prefs: StoredPrefs =
      parsed && typeof parsed === "object" && ("visible" in parsed || "order" in parsed)
        ? parsed
        : { visible: parsed as Record<string, boolean> };
    if (prefs.visible) {
      columns.forEach((c) => {
        if (c.required) baseVisible[c.key] = true;
        else if (typeof prefs.visible![c.key] === "boolean") baseVisible[c.key] = prefs.visible![c.key];
      });
    }
    let order = baseOrder;
    if (Array.isArray(prefs.order)) {
      const known = new Set(baseOrder);
      const filtered = prefs.order.filter((k) => known.has(k));
      const missing = baseOrder.filter((k) => !filtered.includes(k));
      order = [...filtered, ...missing];
    }
    return { visible: baseVisible, order };
  } catch {
    return { visible: baseVisible, order: baseOrder };
  }
}

/**
 * Full column-preferences hook: visibility + ordering.
 */
export function useColumnPrefs(storageKey: string, columns: ColumnDef[]) {
  const [state, setState] = useState(() => loadPrefs(storageKey, columns));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [storageKey, state]);

  const columnMap = useMemo(() => {
    const m = new Map<string, ColumnDef>();
    columns.forEach((c) => m.set(c.key, c));
    return m;
  }, [columns]);

  const orderedColumns = useMemo(
    () => state.order.map((k) => columnMap.get(k)).filter((c): c is ColumnDef => !!c),
    [state.order, columnMap],
  );

  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => c.required || state.visible[c.key] !== false),
    [orderedColumns, state.visible],
  );

  const isVisible = (key: string) => {
    const col = columnMap.get(key);
    if (col?.required) return true;
    return state.visible[key] !== false;
  };

  const toggle = (key: string, v: boolean) => {
    const col = columnMap.get(key);
    if (col?.required) return;
    setState((s) => ({ ...s, visible: { ...s.visible, [key]: v } }));
  };

  const move = (key: string, dir: -1 | 1) => {
    setState((s) => {
      const order = [...s.order];
      const i = order.indexOf(key);
      if (i < 0) return s;
      // Skip past required columns (they are pinned in place)
      let j = i + dir;
      while (j >= 0 && j < order.length && columnMap.get(order[j])?.required) j += dir;
      if (j < 0 || j >= order.length) return s;
      if (columnMap.get(key)?.required) return s;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...s, order };
    });
  };

  const reset = () => setState(loadPrefs("__reset__" + storageKey, columns));

  return { state, orderedColumns, visibleColumns, isVisible, toggle, move, reset };
}

/**
 * Back-compat wrapper: returns just visibility API.
 */
export function useColumnVisibility(storageKey: string, columns: ColumnDef[]) {
  const { state, isVisible, toggle, reset } = useColumnPrefs(storageKey, columns);
  return { visible: state.visible, isVisible, toggle, reset };
}

interface MenuProps {
  columns: ColumnDef[]; // ordered list (usually orderedColumns from hook)
  visible: Record<string, boolean>;
  onToggle: (key: string, v: boolean) => void;
  onMove?: (key: string, dir: -1 | 1) => void;
  onReset: () => void;
}

export function ColumnVisibilityMenu({ columns, visible, onToggle, onMove, onReset }: MenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          <Columns3 className="h-3.5 w-3.5 mr-1.5" /> Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-h-[70vh] overflow-y-auto">
        <DropdownMenuLabel className="text-xs">Show &amp; reorder columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((c, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === columns.length - 1;
          const checked = c.required ? true : visible[c.key] !== false;
          return (
            <div
              key={c.key}
              className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent/50 rounded-sm"
            >
              <Checkbox
                checked={checked}
                disabled={c.required}
                onCheckedChange={(v) => onToggle(c.key, !!v)}
              />
              <span className="flex-1 truncate">{c.label}</span>
              {c.required ? (
                <Lock className="h-3 w-3 text-muted-foreground" />
              ) : onMove ? (
                <>
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={isFirst}
                    onClick={() => onMove(c.key, -1)}
                    className="p-0.5 rounded hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={isLast}
                    onClick={() => onMove(c.key, 1)}
                    className="p-0.5 rounded hover:bg-accent disabled:opacity-30"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </>
              ) : null}
            </div>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); onReset(); }} className="text-xs">
          Reset to default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
