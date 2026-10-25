import { cn } from "@/lib/utils";
import type { BranchQty } from "@/hooks/use-stock-split";

const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2));

/**
 * "MNL 10 · GSN 10" under a combined stock figure, so a count at one branch
 * can be checked against the screen without switching branches. Branches
 * with none of the item are left out; nothing shows when only one has stock
 * and it equals the total.
 */
export function BranchStockSplit({ split, className }: { split: BranchQty[] | undefined; className?: string }) {
  const held = (split || []).filter((s) => s.qty !== 0);
  if (held.length < 2) {
    if (held.length === 1) return <div className={cn("text-[10px] font-normal text-muted-foreground", className)}>all in {held[0].code}</div>;
    return null;
  }
  return (
    <div className={cn("text-[10px] font-normal text-muted-foreground tabular-nums whitespace-nowrap", className)}>
      {held.map((s, i) => (
        <span key={s.code}>
          {i > 0 && " · "}
          {s.code} {fmt(s.qty)}
        </span>
      ))}
    </div>
  );
}

export default BranchStockSplit;
