import { priceLabel } from "@/lib/price-list";

/**
 * Where a quotation or invoice line's price came from, shown under the line.
 * `list:<key>` is a price list price, e.g. `list:bottom` or `list:srp`.
 */
export type PriceSource = "saved" | "fixed" | "last" | "standard" | "manual" | `list:${string}`;

const LABELS: Record<string, string> = {
  saved: "Saved price",
  fixed: "Customer's fixed price",
  last: "Customer's last price",
  standard: "Standard selling price",
  manual: "Entered by hand",
};

export function priceSourceLabel(source: PriceSource): string {
  return source.startsWith("list:") ? `Price list: ${priceLabel(source.slice(5))}` : LABELS[source] ?? source;
}
