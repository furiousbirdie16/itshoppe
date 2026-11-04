import * as React from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface MonthFieldProps {
  /** yyyy-MM */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The app's month picker, in the same style as DateField. */
export function MonthField({ value, onChange, className, disabled }: MonthFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [y, m] = (value || "").split("-").map(Number);
  const hasValue = Number.isFinite(y) && m >= 1 && m <= 12;
  const now = new Date();
  const [year, setYear] = React.useState(hasValue ? y : now.getFullYear());
  React.useEffect(() => { if (open && hasValue) setYear(y); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (yy: number, mm: number) => { onChange(`${yy}-${pad(mm)}`); setOpen(false); };
  const step = (delta: number) => {
    if (!hasValue) return;
    const d = new Date(y, m - 1 + delta, 1);
    onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  };

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => step(-1)} disabled={disabled || !hasValue} aria-label="Previous month">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" disabled={disabled} className={cn("h-9 min-w-[10rem] flex-1 justify-start gap-2 font-normal", !hasValue && "text-muted-foreground")}>
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-60" />
            {hasValue ? `${LONG[m - 1]} ${y}` : "Pick a month"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <div className="mb-2 flex items-center justify-between">
            <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setYear(year - 1)} aria-label="Previous year">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">{year}</span>
            <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setYear(year + 1)} aria-label="Next year">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((label, i) => {
              const selected = hasValue && y === year && m === i + 1;
              const current = now.getFullYear() === year && now.getMonth() === i;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => pick(year, i + 1)}
                  className={cn(
                    "h-9 rounded-md text-sm transition-colors hover:bg-muted",
                    current && !selected && "bg-accent text-accent-foreground",
                    selected && "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-end border-t pt-2">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => pick(now.getFullYear(), now.getMonth() + 1)}>
              This month
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => step(1)} disabled={disabled || !hasValue} aria-label="Next month">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
