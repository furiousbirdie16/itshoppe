import type React from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props extends React.HTMLAttributes<HTMLSpanElement> {
  /** Row number shown beside the grip, so "line 3" can still be talked about. */
  index: number;
}

/** The grip a line is dragged by, with its line number. */
export function DragHandle({ index, className, ...props }: Props) {
  return (
    <span
      {...props}
      role="button"
      aria-label={`Drag line ${index + 1} to reorder`}
      title="Drag to reorder"
      className={cn(
        "flex select-none items-center justify-end gap-0.5 text-[11px] tabular-nums text-muted-foreground",
        "cursor-grab touch-none active:cursor-grabbing hover:text-foreground",
        className,
      )}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0" />
      {index + 1}
    </span>
  );
}
