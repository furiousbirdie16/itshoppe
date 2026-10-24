// Display helpers shared by the Business Insights table and its mobile cards.
import type { ProductAction } from "@/types/insights";

export const ACTION_CLASS: Record<ProductAction, string> = {
  Buy: "bg-red-500/10 text-red-600 border-red-500/30",
  Maintain: "bg-green-500/10 text-green-600 border-green-500/30",
  Reduce: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  Overstock: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  Dead: "bg-muted text-muted-foreground border-border",
};

export const fmtDays = (d: number) => (d === Infinity ? "∞" : d > 999 ? ">999" : Math.round(d).toString());
