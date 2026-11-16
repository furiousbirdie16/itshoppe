import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * On a touch screen the grip has to be held still for a moment before the row
 * lifts. A finger that lands on it and moves straight away is a scroll, and is
 * left to scroll: a drag that started on contact used to reorder lines (or
 * send one off screen) whenever a scroll happened to begin on a grip.
 */
/** How long a finger must rest on the grip before the row lifts. */
export const TOUCH_HOLD_MS = 250;
/** How far a resting finger may wander before it counts as a scroll. */
const TOUCH_SLOP_PX = 8;
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const current = useRef(drag);
  current.current = drag;
  const scroller = useRef<HTMLElement | null>(null);
  // A touch waiting out the hold: where it landed, and the timer that lifts it.
  const pending = useRef<{ x: number; y: number; timer: number } | null>(null);

  const clearPending = () => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
  };

  // While a touch drag runs, the page must not scroll under the finger. The
  // grip allows vertical panning (so a scroll can start on it), so the scroll
  // is stopped here instead, once the drag has started.
  const blockScroll = useRef((e: TouchEvent) => { if (current.current) e.preventDefault(); });
  const stopBlocking = () => document.removeEventListener("touchmove", blockScroll.current);

  // A form closed mid-hold or mid-drag leaves no timer or listener behind.
  useEffect(() => () => { clearPending(); stopBlocking(); }, []);

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
        const el = e.currentTarget;
        const start = () => {
          pending.current = null;
          scroller.current = findScroller(el);
          setDrag({ from: index, over: index });
        };
        if (e.pointerType !== "touch") {
          e.preventDefault();
          el.setPointerCapture?.(e.pointerId);
          start();
          return;
        }
        // Touch: lift only after a still hold, so a scroll stays a scroll.
        clearPending();
        const pointerId = e.pointerId;
        pending.current = {
          x: e.clientX,
          y: e.clientY,
          timer: window.setTimeout(() => {
            try { el.setPointerCapture?.(pointerId); } catch { /* finger already gone */ }
            document.addEventListener("touchmove", blockScroll.current, { passive: false });
            navigator.vibrate?.(10);
            start();
          }, TOUCH_HOLD_MS),
        };
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const p = pending.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > TOUCH_SLOP_PX) clearPending();
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
        clearPending();
        stopBlocking();
        const d = current.current;
        setDrag(null);
        if (d && d.from !== d.over) onMove(d.from, d.over);
      },
      onPointerCancel: () => { clearPending(); stopBlocking(); setDrag(null); },
      // Long-pressing the grip must not open the phone's copy/select menu.
      onContextMenu: (e: React.MouseEvent<HTMLElement>) => e.preventDefault(),
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
