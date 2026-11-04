import * as React from "react";
import {
  endOfMonth, endOfYear, format, isSameDay, isValid, parse, startOfMonth, startOfYear, subDays, subMonths,
} from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateRangeFilterProps {
  /** ISO yyyy-MM-dd, or "" for open-ended. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  className?: string;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
const fromIso = (v: string) => {
  if (!v) return undefined;
  const d = parse(v, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : undefined;
};

type Preset = { label: string; range: () => [Date, Date] };
const PRESETS: Preset[] = [
  { label: "Today", range: () => [new Date(), new Date()] },
  { label: "Yesterday", range: () => [subDays(new Date(), 1), subDays(new Date(), 1)] },
  { label: "Last 7 days", range: () => [subDays(new Date(), 6), new Date()] },
  { label: "Last 30 days", range: () => [subDays(new Date(), 29), new Date()] },
  { label: "This month", range: () => [startOfMonth(new Date()), endOfMonth(new Date())] },
  { label: "Last month", range: () => { const m = subMonths(new Date(), 1); return [startOfMonth(m), endOfMonth(m)]; } },
  { label: "This year", range: () => [startOfYear(new Date()), endOfYear(new Date())] },
];

/** What the trigger shows: a preset's name when it matches, else the dates. */
function describe(from?: Date, to?: Date): string | null {
  if (!from && !to) return null;
  if (from && to) {
    const preset = PRESETS.find((p) => {
      const [a, b] = p.range();
      return isSameDay(a, from) && isSameDay(b, to);
    });
    if (preset) return preset.label;
    if (isSameDay(from, to)) return format(from, "MMM d, yyyy");
    const sameYear = from.getFullYear() === to.getFullYear();
    return `${format(from, sameYear ? "MMM d" : "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
  }
  if (from) return `From ${format(from, "MMM d, yyyy")}`;
  return `Until ${format(to!, "MMM d, yyyy")}`;
}

/** One button for a date range, with quick presets and a two-month calendar. */
export function DateRangeFilter({ from, to, onChange, placeholder = "Any date", className }: DateRangeFilterProps) {
  const [open, setOpen] = React.useState(false);
  const fromDate = fromIso(from);
  const toDate = fromIso(to);
  const label = describe(fromDate, toDate);
  const selected: DateRange | undefined = fromDate || toDate ? { from: fromDate ?? toDate, to: toDate } : undefined;

  const activePreset = fromDate && toDate
    ? PRESETS.find((p) => { const [a, b] = p.range(); return isSameDay(a, fromDate) && isSameDay(b, toDate); })?.label
    : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn("h-9 w-full justify-start gap-2 pr-8 text-left font-normal", !label && "text-muted-foreground")}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-60" />
            <span className="truncate">{label ?? placeholder}</span>
          </Button>
        </PopoverTrigger>
        {label && (
          <button
            type="button"
            aria-label="Clear dates"
            onClick={() => onChange("", "")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b p-2 sm:w-36 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { const [a, b] = p.range(); onChange(iso(a), iso(b)); setOpen(false); }}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                  activePreset === p.label && "bg-primary/10 font-medium text-primary",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <Calendar
              mode="range"
              numberOfMonths={2}
              defaultMonth={fromDate ? fromDate : subMonths(new Date(), 1)}
              selected={selected}
              onSelect={(r) => onChange(r?.from ? iso(r.from) : "", r?.to ? iso(r.to) : "")}
              className="p-3"
              classNames={{ months: "flex flex-col md:flex-row gap-4", month: "space-y-4" }}
            />
            <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
              <span className="text-xs text-muted-foreground">{label ?? "Pick a start and end date"}</span>
              <div className="flex gap-1.5">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange("", "")}>Clear</Button>
                <Button type="button" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>Done</Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
