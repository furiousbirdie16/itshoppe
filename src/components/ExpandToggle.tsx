import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** The arrow at the start of a list row that opens its details underneath. */
export function ExpandToggle({ open, onToggle, label = "details" }: { open: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-expanded={open}
      aria-label={open ? `Hide ${label}` : `Show ${label}`}
      title={open ? `Hide ${label}` : `Show ${label}`}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
    </button>
  );
}

/** Which rows are open. Kept per page, so opening one does not close another. */
export function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
