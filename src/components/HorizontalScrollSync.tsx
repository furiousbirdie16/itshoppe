import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Wraps a horizontally-scrolling area and mounts an additional
 * "phantom" scrollbar at the top that mirrors the bottom one.
 * The top bar is sticky so users can scroll horizontally without
 * having to jump to the bottom of a long table.
 */
export function HorizontalScrollSync({ children, className }: { children: ReactNode; className?: string }) {
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [innerWidth, setInnerWidth] = useState(0);

  // Track content width so the top scrollbar has an inner element of matching width
  useLayoutEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const measure = () => {
      const first = el.firstElementChild as HTMLElement | null;
      const w = first?.scrollWidth ?? el.scrollWidth;
      setInnerWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild as Element);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const top = topRef.current;
    const bot = bottomRef.current;
    if (!top || !bot) return;
    let syncing = false;
    const onTop = () => { if (syncing) return; syncing = true; bot.scrollLeft = top.scrollLeft; syncing = false; };
    const onBot = () => { if (syncing) return; syncing = true; top.scrollLeft = bot.scrollLeft; syncing = false; };
    top.addEventListener("scroll", onTop, { passive: true });
    bot.addEventListener("scroll", onBot, { passive: true });
    return () => { top.removeEventListener("scroll", onTop); bot.removeEventListener("scroll", onBot); };
  }, []);

  return (
    <div className={className}>
      <div
        ref={topRef}
        className="sticky top-0 z-20 overflow-x-auto overflow-y-hidden bg-background/95 backdrop-blur border-b"
        style={{ height: 14 }}
        aria-hidden
      >
        <div style={{ width: innerWidth, height: 1 }} />
      </div>
      <div ref={bottomRef} className="overflow-x-auto">
        {children}
      </div>
    </div>
  );
}
