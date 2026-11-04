import type { SoldUnit } from "@/types/database";
import { docNo } from "@/lib/doc-number";
import { onlineOrderLabel } from "@/lib/online-serials";

/** Where a serial already is, for the "already sold" warning. */
export function describeHolder(u: SoldUnit): string {
  if (u.online_sales) {
    return `${onlineOrderLabel(u.online_sales)}${u.online_sales.order_date ? ` on ${u.online_sales.order_date}` : ""}`;
  }
  const inv = u.invoices;
  if (!inv) return "another sale";
  return [
    `invoice ${docNo(inv.invoice_number) || ""}`.trim(),
    inv.customers?.name ? `for ${inv.customers.name}` : "",
    inv.invoice_date ? `on ${inv.invoice_date}` : "",
  ].filter(Boolean).join(" ");
}
