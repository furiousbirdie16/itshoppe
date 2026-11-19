import { priceLabel } from "@/lib/price-list";

/**
 * Where a quotation or invoice line's price came from, shown under the line.
 * `list:<key>` is a price list price, e.g. `list:bottom`, `list:srp`, `list:sdp`.
 */
export type PriceSource = "previous" | "standard" | "manual" | "saved" | `list:${string}`;

const LABELS: Record<string, string> = {
  previous: "Previous price",
  standard: "Standard selling price",
  manual: "Entered by hand",
  saved: "Saved price",
};

export function priceSourceLabel(source: PriceSource): string {
  return source.startsWith("list:") ? `Price list: ${priceLabel(source.slice(5))}` : LABELS[source] ?? source;
}

/** One color per source, so a glance at the lines shows where prices came from. */
const COLORS: Record<string, string> = {
  previous: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  "list:bottom": "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  "list:srp": "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200",
  "list:sdp": "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200",
  standard: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200",
  manual: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  saved: "border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-300",
};
const OTHER_LIST = "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200";

export function priceSourceClass(source: PriceSource): string {
  return COLORS[source] ?? (source.startsWith("list:") ? OTHER_LIST : COLORS.standard);
}
