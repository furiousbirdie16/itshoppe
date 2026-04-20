import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortState } from "@/hooks/use-sort";

interface Props {
  sortKey: string;
  label: string;
  sort: SortState;
  onToggle: (key: string) => void;
  align?: "left" | "right" | "center";
  className?: string;
}

export function SortableHeader({ sortKey, label, sort, onToggle, align = "left", className }: Props) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={cn("text-xs select-none", align === "right" && "text-right", align === "center" && "text-center", className)}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          align === "right" && "ml-auto flex-row-reverse",
          active ? "text-foreground font-semibold" : "text-muted-foreground",
        )}
      >
        <span>{label}</span>
        <Icon className={cn("h-3 w-3", active ? "opacity-100" : "opacity-50")} />
      </button>
    </TableHead>
  );
}
