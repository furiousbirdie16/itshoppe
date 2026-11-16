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
        // Only as wide as the grip and number: on a phone the grid row is the
        // card's full width, and a full-width grip caught scrolls meant for the page.
        "flex w-fit select-none items-center justify-end gap-0.5 justify-self-end rounded px-1.5 py-1 -my-1 text-[11px] tabular-nums text-muted-foreground",
        // pan-y: a scroll may start on the grip; a held grip still drags (see useDragReorder).
        "cursor-grab touch-pan-y [-webkit-touch-callout:none] active:cursor-grabbing hover:text-foreground",
        className,
      )}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0" />
      {index + 1}
    </span>
  );
}
