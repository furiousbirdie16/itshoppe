import { useCallback, useRef, useState } from "react";
import type React from "react";

/**
 * Drag a list's rows into a new order by a handle.
 *
 * Pointer events rather than HTML5 drag and drop: the latter does nothing on
 * a phone's touch screen, and these forms are filled in on phones. The handle
 * captures the pointer, so the drag keeps going as it crosses other rows, and
 * the row under the finger is found by its data-drag-row index. Near the top
 * or bottom of a scrolling dialog the dialog scrolls, so a long list can be
 * dragged end to end.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const current = useRef(drag);
  current.current = drag;
  const scroller = useRef<HTMLElement | null>(null);

  const findScroller = (el: HTMLElement | null): HTMLElement | null => {
    for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (/(auto|scroll)/.test(style.overflowY) && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  };

  const handleProps = useCallback(
    (index: number) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        // Main button or touch only; right-click is left to the browser.
        if (e.button > 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        scroller.current = findScroller(e.currentTarget);
        setDrag({ from: index, over: index });
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const d = current.current;
        if (!d) return;
        const box = scroller.current?.getBoundingClientRect();
        if (box && scroller.current) {
          if (e.clientY < box.top + 48) scroller.current.scrollBy(0, -12);
          else if (e.clientY > box.bottom - 48) scroller.current.scrollBy(0, 12);
        }
        const row = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-drag-row]");
        if (!row) return;
        const over = Number(row.getAttribute("data-drag-row"));
        if (Number.isFinite(over) && over !== d.over) setDrag({ ...d, over });
      },
      onPointerUp: () => {
        const d = current.current;
        setDrag(null);
        if (d && d.from !== d.over) onMove(d.from, d.over);
      },
      onPointerCancel: () => setDrag(null),
    }),
    [onMove],
  );

  /** Spread on each row's outer element. */
  const rowProps = (index: number) => ({ "data-drag-row": index });

  /** Classes for a row: faded while it is the one dragged, a line where it will land. */
  const rowClass = (index: number) => {
    if (!drag) return "";
    if (index === drag.from) return "opacity-50";
    if (index !== drag.over) return "";
    // The line goes on the side the row will be dropped: below when moving down.
    return drag.over > drag.from ? "shadow-[0_2px_0_0_hsl(var(--primary))]" : "shadow-[0_-2px_0_0_hsl(var(--primary))]";
  };

  return { handleProps, rowProps, rowClass, dragging: drag !== null };
}
