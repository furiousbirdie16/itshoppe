import * as React from "react";
import { cn } from "@/lib/utils";

/** A small caption above a filter control. */
export function FilterLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-medium text-muted-foreground">{children}</div>;
}

interface SegmentedProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}

/** A row of joined buttons, one chosen: for short lists such as channels. */
export function SegmentedFilter({ value, onChange, options, className }: SegmentedProps) {
  return (
    <div role="radiogroup" className={cn("inline-flex h-9 items-center rounded-lg border bg-muted/50 p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-full whitespace-nowrap rounded-md px-3 text-sm transition-colors",
              active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface RangeProps {
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  /** Shown before each number, e.g. "₱". */
  prefix?: string;
  className?: string;
}

const numberBox =
  "w-full min-w-0 bg-transparent text-sm tabular-nums outline-none placeholder:text-muted-foreground/70 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/** A min–max pair drawn as one field. Empty means no limit. */
export function RangeFilter({ min, max, onMin, onMax, prefix, className }: RangeProps) {
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-1 rounded-md border bg-background px-2.5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1",
        className,
      )}
    >
      {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
      <input type="number" inputMode="decimal" value={min} onChange={(e) => onMin(e.target.value)} placeholder="Min" aria-label="Minimum" className={numberBox} />
      <span className="px-0.5 text-muted-foreground">–</span>
      {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
      <input type="number" inputMode="decimal" value={max} onChange={(e) => onMax(e.target.value)} placeholder="Max" aria-label="Maximum" className={numberBox} />
    </div>
  );
}
