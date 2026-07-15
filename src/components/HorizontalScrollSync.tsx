import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Wraps a horizontally-scrolling area and mounts an additional
 * "phantom" scrollbar at the top that mirrors the actual scroll
 * container inside `children` (e.g. shadcn <Table> renders its own
 * overflow-auto wrapper). The top bar is sticky so users can scroll
 * horizontally without jumping to the bottom of a long table.
 */
export function HorizontalScrollSync({ children, className }: { children: ReactNode; className?: string }) {
  const topRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  const [innerWidth, setInnerWidth] = useState(0);

  // Find the actual horizontally-scrollable element inside children.
  const findScrollEl = (): HTMLElement | null => {
    const root = containerRef.current;
    if (!root) return null;
    // Prefer a descendant that actually overflows horizontally.
    const candidates = root.querySelectorAll<HTMLElement>("*");
    for (const el of Array.from(candidates)) {
      const style = getComputedStyle(el);
      const canScroll = style.overflowX === "auto" || style.overflowX === "scroll";
      if (canScroll && el.scrollWidth > el.clientWidth + 1) return el;
    }
    // Fallback: first element with overflow-x auto/scroll even if not overflowing yet.
    for (const el of Array.from(candidates)) {
      const style = getComputedStyle(el);
      if (style.overflowX === "auto" || style.overflowX === "scroll") return el;
    }
    return root;
  };

  useLayoutEffect(() => {
    const measure = () => {
      const el = scrollElRef.current || findScrollEl();
      scrollElRef.current = el;
      if (!el) return;
      // scrollWidth reflects the full content width including hidden overflow.
      setInnerWidth(el.scrollWidth);
    };

    scrollElRef.current = findScrollEl();
    measure();

    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    if (scrollElRef.current) {
      ro.observe(scrollElRef.current);
      // Observe first child (table) too since its width drives scrollWidth.
      const child = scrollElRef.current.firstElementChild as HTMLElement | null;
      if (child) ro.observe(child);
    }
    // MutationObserver in case columns are toggled / rows swap in.
    const mo = new MutationObserver(() => {
      const next = findScrollEl();
      if (next !== scrollElRef.current) {
        scrollElRef.current = next;
      }
      measure();
    });
    if (containerRef.current) {
      mo.observe(containerRef.current, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
    }
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const top = topRef.current;
    const bot = scrollElRef.current;
    if (!top || !bot) return;
    let syncing = false;
    const onTop = () => {
      if (syncing) return;
      syncing = true;
      bot.scrollLeft = top.scrollLeft;
      requestAnimationFrame(() => { syncing = false; });
    };
    const onBot = () => {
      if (syncing) return;
      syncing = true;
      top.scrollLeft = bot.scrollLeft;
      requestAnimationFrame(() => { syncing = false; });
    };
    top.addEventListener("scroll", onTop, { passive: true });
    bot.addEventListener("scroll", onBot, { passive: true });
    return () => {
      top.removeEventListener("scroll", onTop);
      bot.removeEventListener("scroll", onBot);
    };
  }, [innerWidth]);

  return (
    <div ref={containerRef} className={className}>
      <div
        ref={topRef}
        className="sticky top-0 z-20 overflow-x-auto overflow-y-hidden bg-background/95 backdrop-blur border-b"
        style={{ height: 14 }}
      >
        <div style={{ width: innerWidth, height: 1 }} />
      </div>
      {children}
    </div>
  );
}
