import * as React from "react";
import { format, parse, isValid, subDays } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateFieldProps {
  /** ISO date string (yyyy-MM-dd) or empty */
  value: string;
  /** Returns ISO date string (yyyy-MM-dd) or empty */
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Offer a way to empty the field. On by default for optional fields. */
  clearable?: boolean;
  /** Earliest / latest day that can be picked, ISO yyyy-MM-dd. */
  min?: string;
  max?: string;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const fromIso = (v?: string) => {
  if (!v) return undefined;
  const d = parse(v, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : undefined;
};

/**
 * The app's single-date picker, matching DateRangeFilter: a button showing
 * the date as "Oct 4, 2026", opening a calendar with Today / Yesterday.
 * Stores value as an ISO yyyy-MM-dd string for compatibility with backend.
 */
export function DateField({ value, onChange, placeholder = "Pick a date", className, disabled, clearable, min, max }: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const date = React.useMemo(() => fromIso(value), [value]);
  const minDate = fromIso(min);
  const maxDate = fromIso(max);
  const canClear = clearable ?? /optional/i.test(placeholder);
  const pick = (d: Date) => { onChange(iso(d)); setOpen(false); };
  const outOfRange = (d: Date) => (!!minDate && d < minDate) || (!!maxDate && d > maxDate);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative w-full", className)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-9 w-full justify-start gap-2 text-left font-normal",
              canClear && date && "pr-8",
              !date && "text-muted-foreground",
              disabled && "bg-muted/40",
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-60" />
            <span className="truncate">{date ? format(date, "MMM d, yyyy") : placeholder}</span>
          </Button>
        </PopoverTrigger>
        {canClear && date && !disabled && (
          <button
            type="button"
            aria-label="Clear date"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto p-0 z-50" align="start">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          onSelect={(d) => d && pick(d)}
          disabled={minDate || maxDate ? outOfRange : undefined}
          initialFocus
          className="p-3 pointer-events-auto"
        />
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <div className="flex gap-1">
            {[{ label: "Today", d: new Date() }, { label: "Yesterday", d: subDays(new Date(), 1) }]
              .filter((o) => !outOfRange(o.d))
              .map((o) => (
                <Button key={o.label} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => pick(o.d)}>
                  {o.label}
                </Button>
              ))}
          </div>
          {canClear && date && (
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { onChange(""); setOpen(false); }}>
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
